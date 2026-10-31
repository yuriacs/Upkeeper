"""
Dados do site para os posts das redes: só o que já é público (decks, comandantes, resultados) e o
nome de usuário apenas de quem autorizou (PrivateProfile.social_opt_in).
"""

from collections import Counter, defaultdict
from datetime import timedelta

from django.utils import timezone

from decks.models import Deck
from decks.services.prices import deck_price
from decks.services.stats import WON, finished_entries

TOP = 5


def _games(since, until=None):
    """(entrada, venceu, id da partida) das partidas terminadas de `since` até `until`: sorteios e mesas."""
    from tables.models import TableResultEntry

    loaded = ("deck__face_commander", "user_deck__face_commander", "player__private")
    in_draws = {"draw__result_at__gte": since, **({"draw__result_at__lt": until} if until else {})}
    in_tables = {"result__finished_at__gte": since, **({"result__finished_at__lt": until} if until else {})}
    draws = finished_entries().filter(**in_draws).select_related(*loaded)
    won = set(finished_entries().filter(**in_draws).filter(WON).values_list("id", flat=True))
    tables = TableResultEntry.objects.filter(**in_tables).select_related(*loaded)
    return [(e, e.id in won, f"d{e.draw_id}") for e in draws] + [(e, e.won, f"t{e.result_id}") for e in tables]


def _art(card) -> str:
    return (card.image_art_crop or card.image_normal) if card else ""


def featured_precon(day=None) -> dict | None:
    """Um precon por dia (sempre o mesmo no mesmo dia), dos que têm comandante, bracket e valor."""
    day = day or timezone.localdate()
    qs = Deck.objects.filter(is_active=True, face_commander__isnull=False, price_usd__isnull=False).order_by("pk")
    count = qs.count()
    if not count:
        return None
    deck = qs.select_related("edition", "face_commander")[day.toordinal() % count]
    price = deck_price(deck.deck_cards.select_related("card"))
    return {
        "slug": deck.slug,
        "name": deck.name,
        "commander": deck.face_commander.name,
        "art": _art(deck.face_commander),
        "colors": deck.color_identity,
        "bracket": deck.bracket,
        "power": deck.power,
        "price_usd": str(deck.price_usd),
        "edition": deck.edition.name,
        "year": deck.edition.release_date.year if deck.edition.release_date else None,
        "top_cards": [
            {"name": c["name"], "image": c["image"], "usd": str(c["usd"]) if c["usd"] is not None else None}
            for c in price["top"][:3]
        ],
    }


def week_feed(days: int = 7) -> dict:
    """Resumo dos últimos `days` dias para os posts (ranking, números) e o precon do dia."""
    since = timezone.now() - timedelta(days=days)
    rows = _games(since)
    games = {gid for _, _, gid in rows}
    players = {e.player_id for e, _, _ in rows if e.player_id}
    played, won_with = Counter(), Counter()
    arts = {}
    decks = defaultdict(lambda: [0, 0])
    per_player = defaultdict(lambda: [0, 0])
    for e, won, _ in rows:
        deck = e.deck or e.user_deck
        card = deck.face_commander if deck else None
        if card:
            played[card.name] += 1
            won_with[card.name] += int(won)
            arts[card.name] = _art(card)
        if deck:
            d = decks[(deck.name, card.name if card else "")]
            d[0], d[1] = d[0] + 1, d[1] + int(won)
        # Jogadores só aparecem se autorizaram
        profile = getattr(e.player, "private", None) if e.player_id else None
        if profile and profile.social_opt_in:
            p = per_player[e.player.username]
            p[0], p[1] = p[0] + 1, p[1] + int(won)
    commanders = sorted(played, key=lambda n: (-won_with[n], -played[n], n))
    return {
        "days": days,
        "since": since.isoformat(),
        "numbers": {
            "games": len(games),
            "players": len(players),
            "commanders": len(played),
            "most_played": played.most_common(1)[0][0] if played else None,
        },
        "top_commanders": [
            {"name": n, "art": arts.get(n, ""), "games": played[n], "wins": won_with[n]} for n in commanders[:TOP]
        ],
        "top_decks": [
            {"name": name, "commander": cmd, "games": g, "wins": w}
            for (name, cmd), (g, w) in sorted(decks.items(), key=lambda x: (-x[1][1], -x[1][0], x[0][0]))[:TOP]
        ],
        "top_players": [
            {"username": u, "games": g, "wins": w}
            for u, (g, w) in sorted(per_player.items(), key=lambda x: (-x[1][1], -x[1][0], x[0]))[:TOP]
        ],
        "featured_precon": featured_precon(),
    }


def month_champion(month=None) -> dict | None:
    """
    O campeão de um mês que acabou (decks/services/seasons.py; sem `month`, o mês passado) para o post:
    nome, vitórias, partidas e a arte do comandante com que mais jogou no mês, e os primeiros do mês
    que autorizaram o nome. None se não houve campeão ou se ele não autorizou aparecer nos posts.
    """
    from decks.models import SeasonChampion
    from decks.services import seasons

    seasons.close_past()
    month = month or seasons.previous_month(seasons.month_of(timezone.localdate()))
    row = SeasonChampion.objects.filter(month=month, user__isnull=False).first()
    if row is None:
        return None
    played: dict[int, Counter] = defaultdict(Counter)
    arts, allowed = {}, set()
    for e, _, _ in _games(seasons._start(month), seasons._start(seasons.next_month(month))):
        if not e.player_id:
            continue
        profile = getattr(e.player, "private", None)
        if profile and profile.social_opt_in:
            allowed.add(e.player_id)
        deck = e.deck or e.user_deck
        card = deck.face_commander if deck else None
        if card:
            played[e.player_id][card.name] += 1
            arts[card.name] = _art(card)
    if row.user_id not in allowed:
        return None

    def favorite(uid):
        name = played[uid].most_common(1)[0][0] if played[uid] else None
        return {"commander": name, "art": arts.get(name, "")}

    top = [r for r in seasons._ordered(seasons._rows(month)) if r["id"] in allowed][:TOP]
    return {
        "month": month.isoformat(),
        "next": seasons.next_month(month).isoformat(),
        "champion": {"username": row.user.username, "wins": row.wins, "games": row.games, **favorite(row.user_id)},
        "top": [{"username": r["username"], "wins": r["wins"], "games": r["games"], **favorite(r["id"])} for r in top],
    }

