"""
Rating dos jogadores no estilo Elo, para partidas de 2 a N jogadores.

Cada partida vira confrontos de um contra um: quem ganhou vence cada um dos outros, e entre os que
perderam nada muda (a partida não diz quem foi melhor entre eles). Cada confronto vale K dividido
pelo número de adversários, para uma partida de 4 não mexer três vezes mais que um 1 contra 1.
Ganhar de quem tem rating alto vale mais; perder para quem tem rating baixo custa mais.

Só contas (nomes avulsos de sorteio não entram) e só partidas com pelo menos 2 contas. Refeito do
zero, na ordem em que as partidas terminaram, a cada resultado: um vencedor remarcado ou desmarcado
muda tudo o que veio depois. Leva uma leitura das entradas por ranking (decks.PlayerRating).
"""

from django.db import transaction
from django.db.models import Count
from django.db.models.functions import Coalesce

from ..models import PlayerRating

START = 1500.0
K = 32.0
RATED_MIN = 5  # partidas para entrar na lista do rating


def _games(source: str):
    """[(entradas [(conta, ganhou)], jogadores na mesa)] na ordem em que as partidas terminaram."""
    from tables.models import TableResultEntry

    from .stats import _bucket, finished_entries

    if source == "tables":
        rows = (TableResultEntry.objects.filter(player__isnull=False)
                .values_list("result_id", "player_id", "won").order_by("result__finished_at", "result_id"))
        sizes = dict(TableResultEntry.objects.values_list("result_id").annotate(n=Count("id")).order_by())
    else:
        entries = finished_entries()
        rows = (
            entries.filter(player__isnull=False)
            .annotate(at=Coalesce("draw__result_at", "draw__created_at"))
            .values_list("draw_id", "player_id", "position", "draw__winner_position")
            .order_by("at", "draw_id")
        )
        rows = [(g, p, pos == win) for g, p, pos, win in rows]
        sizes = dict(entries.values_list("draw_id").annotate(n=Count("id")).order_by())
    games, current, players = [], None, []
    for game, player, won in rows:
        if game != current:
            if players:
                games.append((players, _bucket(sizes.get(current, 0))))
            current, players = game, []
        players.append((player, bool(won)))
    if players:
        games.append((players, _bucket(sizes.get(current, 0))))
    return games


def _play(ratings: dict, counts: dict, players: list[tuple[int, bool]]) -> None:
    accounts = dict(players)  # a mesma conta duas vezes na partida conta uma
    winners = [p for p, won in accounts.items() if won]
    losers = [p for p, won in accounts.items() if not won]
    if len(accounts) < 2 or not winners or not losers:
        return
    weight = K / (len(accounts) - 1)
    delta = dict.fromkeys(accounts, 0.0)
    for w in winners:
        for loser in losers:
            rw, rl = ratings.get(w, START), ratings.get(loser, START)
            gain = weight * (1 - 1 / (1 + 10 ** ((rl - rw) / 400)))
            delta[w] += gain
            delta[loser] -= gain
    for p, d in delta.items():
        ratings[p] = ratings.get(p, START) + d
        counts[p] = counts.get(p, 0) + 1


def rebuild(source: str) -> None:
    """Refaz os ratings de um ranking ("draws" ou "tables"), todos os tamanhos de partida."""
    from .stats import _SOURCE_IDS

    sid = _SOURCE_IDS[source]
    buckets: dict[int, tuple[dict, dict]] = {}
    for players, size in _games(source):
        for b in (0, size) if size is not None else (0,):
            ratings, counts = buckets.setdefault(b, ({}, {}))
            _play(ratings, counts, players)
    rows = [
        PlayerRating(source=sid, size=b, user_id=uid, rating=round(r, 1), games=counts[uid])
        for b, (ratings, counts) in buckets.items()
        for uid, r in ratings.items()
    ]
    with transaction.atomic():
        PlayerRating.objects.filter(source=sid).delete()
        PlayerRating.objects.bulk_create(rows, batch_size=1000)


def top(source: str, size: int | None, limit: int) -> list[dict]:
    """Os melhores ratings (com RATED_MIN partidas ou mais), com o nome de usuário."""
    from .stats import _SOURCE_IDS

    rows = (PlayerRating.objects.filter(source=_SOURCE_IDS[source], size=size or 0, games__gte=RATED_MIN)
            .select_related("user").order_by("-rating", "-games", "user__username")[:limit])
    return [{"id": r.user_id, "username": r.user.username, "rating": round(r.rating), "games": r.games} for r in rows]

