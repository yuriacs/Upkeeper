"""
Estatísticas das partidas, em dois rankings separados:

- sorteios ("draws"): só contam sorteios em que alguém marcou quem ganhou. "Partida" = um sorteio
  com resultado; cada jogador soma uma partida, e quem estava na posição vencedora, uma vitória.
- mesas ("tables"): partidas encerradas com vencedor em mesas que não vieram de um sorteio
  (tables.TableResult), com o deck que cada um usou.
"""

from django.core.cache import cache
from django.db.models import Count, F, Q

from ..models import Deck, Draw, DrawEntry

MIN_GAMES = 3  # para entrar nos rankings de taxa de vitória dos decks
TOP = 10
CACHE_SECONDS = 120

WON = Q(position=F("draw__winner_position"))


def finished_entries():
    return DrawEntry.objects.filter(draw__winner_position__isnull=False)


def _rate(wins: int, games: int) -> float:
    return round(wins / games, 4) if games else 0.0


def _rows(qs, key: str):
    """Agrupa por `key` e devolve [{key, games, wins, win_rate}]."""
    rows = qs.values(key).annotate(games=Count("id"), wins=Count("id", filter=WON))
    return [{**r, "win_rate": _rate(r["wins"], r["games"])} for r in rows]


def record(entries) -> dict:
    agg = entries.aggregate(games=Count("id"), wins=Count("id", filter=WON))
    return {**agg, "win_rate": _rate(agg["wins"], agg["games"])}


def deck_record(deck: Deck) -> dict:
    return record(finished_entries().filter(deck=deck))


SOURCES = ("draws", "tables")


def _source(source: str):
    """(entradas de partidas terminadas, condição de vitória, total de partidas) de cada ranking."""
    if source == "tables":
        from tables.models import TableResult, TableResultEntry

        return TableResultEntry.objects.all(), Q(won=True), TableResult.objects.count()
    return finished_entries(), WON, Draw.objects.filter(winner_position__isnull=False).count()


def global_stats(source: str = "draws") -> dict:
    source = source if source in SOURCES else "draws"
    cached = cache.get(f"stats:global:{source}")
    if cached is not None:
        return cached

    from pools.models import UserDeck
    from pools.serializers import UserDeckSummarySerializer

    from ..serializers import DeckListSerializer

    entries, won, games = _source(source)
    # Precons e decks da pool (montados pelos jogadores) entram nos mesmos quadros
    deck_rows = []
    for field, kind in (("deck", "precon"), ("user_deck", "user")):
        for r in entries.filter(**{f"{field}__isnull": False}).values(field).annotate(
            games=Count("id"), wins=Count("id", filter=won)
        ):
            deck_rows.append({"kind": kind, "id": r[field], "games": r["games"], "wins": r["wins"],
                              "win_rate": _rate(r["wins"], r["games"])})
    precons = Deck.objects.select_related("edition", "face_commander").in_bulk(
        [r["id"] for r in deck_rows if r["kind"] == "precon"]
    )
    own = UserDeck.objects.select_related("owner", "face_commander").in_bulk(
        [r["id"] for r in deck_rows if r["kind"] == "user"]
    )

    def serialize(r):
        if r["kind"] == "precon":
            return DeckListSerializer(precons[r["id"]]).data if r["id"] in precons else None
        return UserDeckSummarySerializer(own[r["id"]]).data if r["id"] in own else None

    def with_deck(rows):
        out = []
        for r in rows:
            deck = serialize(r)
            if deck is not None:
                out.append({"deck": deck, **{k: r[k] for k in ("games", "wins", "win_rate")}})
        return out

    qualified = [r for r in deck_rows if r["games"] >= MIN_GAMES]
    most_wins = sorted((r for r in deck_rows if r["wins"]), key=lambda r: (-r["wins"], r["games"]))[:TOP]
    best_rate = sorted(qualified, key=lambda r: (-r["win_rate"], -r["games"]))[:TOP]
    # Azarado = abaixo da média da mesa (numa mesa de 4, a média é ganhar 25% das vezes)
    total_games = sum(r["games"] for r in deck_rows)
    average = sum(r["wins"] for r in deck_rows) / total_games if total_games else 0
    unlucky = sorted(
        (r for r in qualified if r["win_rate"] < average), key=lambda r: (r["win_rate"], -r["games"])
    )[:TOP]

    # Jogadores: só quem tem conta (nomes avulsos se repetem entre grupos diferentes)
    player_rows = (
        entries.filter(player__isnull=False)
        .values("player_id", "player__username")
        .annotate(games=Count("id"), wins=Count("id", filter=won))
    )
    # Ordem por quantidade de vitórias; no empate, quem precisou de menos partidas fica na frente
    players = sorted(
        (
            {"id": r["player_id"], "username": r["player__username"], "games": r["games"], "wins": r["wins"],
             "win_rate": _rate(r["wins"], r["games"])}
            for r in player_rows
            if r["wins"]
        ),
        key=lambda r: (-r["wins"], r["games"], r["username"].casefold()),
    )[:TOP]
    # Selo de apoiador ao lado do nome (accounts/supporter.py); o id não sai na resposta
    from accounts.supporter import active_ids

    backers = active_ids([r["id"] for r in players])
    for r in players:
        r["supporter"] = r.pop("id") in backers

    data = {
        "source": source,
        "min_games": MIN_GAMES,
        "games": games,
        "draws": Draw.objects.count(),
        "most_wins": with_deck(most_wins),
        "best_rate": with_deck(best_rate),
        "unlucky": with_deck(unlucky),
        "players": players,
    }
    cache.set(f"stats:global:{source}", data, CACHE_SECONDS)
    return data


def room_scoreboard(room) -> list[dict]:
    """Placar da sala: por nome de jogador, nos sorteios da sala com resultado."""
    rows = _rows(finished_entries().filter(draw__room=room), "player_name")
    merged: dict[str, dict] = {}
    for r in rows:  # junta "ana" e "Ana"
        key = r["player_name"].casefold()
        cur = merged.setdefault(key, {"name": r["player_name"], "games": 0, "wins": 0})
        cur["games"] += r["games"]
        cur["wins"] += r["wins"]
    board = [{**m, "win_rate": _rate(m["wins"], m["games"])} for m in merged.values()]
    return sorted(board, key=lambda r: (-r["wins"], -r["win_rate"], r["name"].casefold()))


def user_stats(user) -> dict:
    """
    Resumo para a página "Meu histórico": sorteios recebidos e partidas terminadas, somando as dos
    sorteios (com resultado marcado) e as das mesas abertas sem sorteio (tables.TableResult).
    """
    from pools.models import UserDeck
    from pools.serializers import UserDeckSummarySerializer
    from tables.models import TableResultEntry

    from ..serializers import DeckListSerializer

    entries = DrawEntry.objects.filter(player=user)
    finished = entries.filter(draw__winner_position__isnull=False)
    tables = TableResultEntry.objects.filter(player=user)

    received = (
        entries.filter(deck__isnull=False).values("deck").annotate(n=Count("id")).order_by("-n", "deck")[:3]
    )
    # Melhores decks: precons e decks montados, nas partidas de sorteio e de mesa
    totals: dict[tuple[str, int], list[int]] = {}
    for kind, field in (("precon", "deck"), ("user", "user_deck")):
        for r in _rows(finished.filter(**{f"{field}__isnull": False}), field):
            t = totals.setdefault((kind, r[field]), [0, 0])
            t[0], t[1] = t[0] + r["games"], t[1] + r["wins"]
        for r in tables.filter(**{f"{field}__isnull": False}).values(field).annotate(
            games=Count("id"), wins=Count("id", filter=Q(won=True))
        ):
            t = totals.setdefault((kind, r[field]), [0, 0])
            t[0], t[1] = t[0] + r["games"], t[1] + r["wins"]
    best = sorted(
        ((k, g, w) for k, (g, w) in totals.items() if w), key=lambda x: (-x[2], -(x[2] / x[1]))
    )[:3]
    decks = Deck.objects.select_related("edition", "face_commander").in_bulk(
        [r["deck"] for r in received] + [k[1] for k, _, _ in best if k[0] == "precon"]
    )
    own = UserDeck.objects.select_related("owner", "face_commander").in_bulk(
        [k[1] for k, _, _ in best if k[0] == "user"]
    )

    def serialize(key):
        kind, pk = key
        if kind == "precon":
            return DeckListSerializer(decks[pk]).data if pk in decks else None
        return UserDeckSummarySerializer(own[pk]).data if pk in own else None

    draw_rec = record(finished)
    table_games = tables.count()
    table_wins = tables.filter(won=True).count()
    games, wins = draw_rec["games"] + table_games, draw_rec["wins"] + table_wins

    return {
        "draws": entries.count(),
        "games": games,
        "wins": wins,
        "win_rate": _rate(wins, games),
        "table_games": table_games,
        "most_received": [
            {"deck": DeckListSerializer(decks[r["deck"]]).data, "times": r["n"]} for r in received
        ],
        "best_decks": [
            {"deck": deck, "games": g, "wins": w, "win_rate": _rate(w, g)}
            for key, g, w in best
            if (deck := serialize(key)) is not None
        ],
    }


def invalidate():
    cache.delete_many([f"stats:global:{s}" for s in SOURCES])
