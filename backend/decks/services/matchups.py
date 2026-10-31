"""
Confrontos: o histórico de uma conta contra outra (no perfil de quem você abre) e os decks que um
deck mais enfrentou (na página do deck). Partidas terminadas dos dois rankings: sorteios com
resultado e mesas sem sorteio.
"""

from django.core.cache import cache
from django.db.models import Q

from .stats import finished_entries

RECENT = 10
MATCHUPS = 8
CACHE_SECONDS = 120


def _played(source: str, filters: Q):
    """Entradas (sorteio ou mesa) que passam em `filters`, com o que é preciso para os confrontos."""
    from tables.models import TableResultEntry

    if source == "tables":
        return TableResultEntry.objects.filter(filters).select_related("result", "deck", "user_deck")
    return finished_entries().filter(filters).select_related("draw", "deck", "user_deck")


def _game(source: str, e) -> tuple[str, int]:
    return source, (e.result_id if source == "tables" else e.draw_id)


def _won(source: str, e) -> bool:
    return e.won if source == "tables" else e.position == e.draw.winner_position


def _when(source: str, e):
    return e.result.finished_at if source == "tables" else (e.draw.result_at or e.draw.created_at)


def _deck_name(e) -> str | None:
    deck = e.deck or e.user_deck
    return deck.name if deck else None


def head_to_head(me, other) -> dict:
    """As partidas em que as duas contas jogaram juntas: quantas cada uma ganhou e as últimas."""
    games: dict[tuple[str, int], dict] = {}
    for source in ("draws", "tables"):
        field = "result_id" if source == "tables" else "draw_id"
        mine = set(_played(source, Q(player=me)).values_list(field, flat=True))
        both = _played(source, Q(player=other, **{f"{field}__in": mine})).values_list(field, flat=True)
        for e in _played(source, Q(**{f"{field}__in": set(both)})):
            g = games.setdefault(_game(source, e), {"source": source, "at": _when(source, e), "winner": "other"})
            if e.player_id == me.id:
                g["mine"] = _deck_name(e)
            elif e.player_id == other.id:
                g["theirs"] = _deck_name(e)
            if _won(source, e):
                g["winner"] = "me" if e.player_id == me.id else "them" if e.player_id == other.id else "other"
    ordered = sorted(games.values(), key=lambda g: g["at"], reverse=True)
    return {
        "games": len(ordered),
        "my_wins": sum(g["winner"] == "me" for g in ordered),
        "their_wins": sum(g["winner"] == "them" for g in ordered),
        "recent": [
            {"date": g["at"].isoformat(), "source": g["source"], "winner": g["winner"],
             "my_deck": g.get("mine"), "their_deck": g.get("theirs")}
            for g in ordered[:RECENT]
        ],
    }


def deck_matchups(kind: str, pk: int) -> list[dict]:
    """
    Os decks que este deck mais enfrentou: em quantas partidas, quantas este ganhou e quantas o
    outro ganhou. Precon e deck da pool, nas partidas dos dois rankings.
    """
    from pools.models import UserDeck
    from pools.serializers import UserDeckSummarySerializer

    from ..models import Deck
    from ..serializers import DeckListSerializer

    key = f"stats:matchups:{kind}:{pk}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    field = "deck" if kind == "precon" else "user_deck"
    faced: dict[tuple[str, int], list[int]] = {}
    for source in ("draws", "tables"):
        game_field = "result_id" if source == "tables" else "draw_id"
        own = {getattr(e, game_field): _won(source, e) for e in _played(source, Q(**{field: pk}))}
        for e in _played(source, Q(**{f"{game_field}__in": own})):
            if getattr(e, f"{field}_id") == pk:
                continue
            opp = ("precon", e.deck_id) if e.deck_id else ("user", e.user_deck_id) if e.user_deck_id else None
            if opp is None:
                continue
            t = faced.setdefault(opp, [0, 0, 0])
            t[0] += 1
            t[1] += own[getattr(e, game_field)]
            t[2] += _won(source, e)
    best = sorted(faced.items(), key=lambda x: (-x[1][0], -x[1][1]))[:MATCHUPS]
    precons = Deck.objects.select_related("edition", "face_commander").in_bulk([i for (k, i), _ in best if k == "precon"])
    own_decks = UserDeck.objects.select_related("owner", "face_commander").in_bulk([i for (k, i), _ in best if k == "user"])
    out = []
    for (k, i), (games, wins, losses) in best:
        found = precons.get(i) if k == "precon" else own_decks.get(i)
        if found is None:
            continue
        deck = DeckListSerializer(found).data if k == "precon" else UserDeckSummarySerializer(found).data
        out.append({"deck": deck, "games": games, "wins": wins, "losses": losses})
    cache.set(key, out, CACHE_SECONDS)
    return out
