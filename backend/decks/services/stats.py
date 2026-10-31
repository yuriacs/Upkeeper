"""
Estatísticas das partidas, em dois rankings separados:

- sorteios ("draws"): só contam sorteios em que alguém marcou quem ganhou. "Partida" = um sorteio
  com resultado; cada jogador soma uma partida, e quem estava na posição vencedora, uma vitória.
- mesas ("tables"): partidas encerradas com vencedor em mesas que não vieram de um sorteio
  (tables.TableResult), com o deck que cada um usou.

Cada um também separado pelo tamanho da partida (`players`): 2, 3 ou 4 jogadores (4 = 4 ou mais,
como numa liga com 5 na mesa). Sem o filtro, todas as partidas juntas.

As somas ficam prontas em RankingRow, refeitas a cada resultado só para quem jogou (touch): a
página do ranking não soma todas as partidas de novo quando o cache vence.
"""

from django.core.cache import cache
from django.db.models import Count, F, Q

from ..models import Deck, Draw, DrawEntry, RankingRow

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
SIZES = (2, 3, 4)  # rankings por quantidade de jogadores na partida (4 = 4 ou mais)


def parse_size(value) -> int | None:
    """?players=2|3|4; qualquer outra coisa = todas as partidas."""
    try:
        size = int(value)
    except (TypeError, ValueError):
        return None
    return size if size in SIZES else None


def _bucket(n: int) -> int | None:
    """O ranking por tamanho em que entra uma partida de `n` jogadores (4 = 4 ou mais)."""
    if n >= max(SIZES):
        return max(SIZES)
    return n if n in SIZES else None


def _entry_model(source: str):
    if source == "tables":
        from tables.models import TableResultEntry

        return TableResultEntry
    return DrawEntry


def _games(source: str):
    """(partidas terminadas, entradas delas, campo da partida na entrada) de cada ranking."""
    if source == "tables":
        from tables.models import TableResult

        return TableResult.objects.all(), _entry_model(source).objects.all(), "result"
    return Draw.objects.filter(winner_position__isnull=False), finished_entries(), "draw"


# Linhas do ranking (RankingRow) de cada deck e jogador: campo da entrada para cada tipo
_KINDS = ((RankingRow.KIND_PRECON, "deck_id"), (RankingRow.KIND_USER_DECK, "user_deck_id"),
          (RankingRow.KIND_PLAYER, "player_id"))
_SOURCE_IDS = {"draws": RankingRow.SOURCE_DRAWS, "tables": RankingRow.SOURCE_TABLES}


def refs_of(source: str, game_ids) -> dict[int, set[int]]:
    """Decks e contas que jogaram estas partidas (com ou sem resultado), para touch."""
    game_ids = [g for g in game_ids if g]
    refs: dict[int, set[int]] = {kind: set() for kind, _ in _KINDS}
    if not game_ids:
        return refs
    field = "result" if source == "tables" else "draw"
    for row in _entry_model(source).objects.filter(**{f"{field}__in": game_ids}).values(*(f for _, f in _KINDS)):
        for kind, f in _KINDS:
            if row[f]:
                refs[kind].add(row[f])
    return refs


def _totals(source: str) -> dict[int, int]:
    """Partidas terminadas de cada tamanho (0 = todas), contadas no banco sem trazer uma a uma."""
    from django.db.models import OuterRef, Subquery

    games, _, field = _games(source)
    per_game = (_entry_model(source).objects.filter(**{field: OuterRef("pk")}).values(field)
                .annotate(c=Count("id")).values("c"))
    totals = dict.fromkeys((0, *SIZES), 0)
    for row in games.annotate(n=Subquery(per_game)).values("n").annotate(c=Count("pk")).order_by():
        totals[0] += row["c"]
        bucket = _bucket(row["n"] or 0)
        if bucket is not None:
            totals[bucket] += row["c"]
    return totals


def _refresh(source: str, refs: dict[int, set[int]] | None) -> None:
    """
    Refaz as linhas do ranking `source`: só as dos decks e contas em `refs` ({tipo: ids}), depois
    de um resultado, ou todas (None). As entradas são somadas em Python, por tamanho de partida,
    numa leitura só.
    """
    from django.db import transaction

    sid = _SOURCE_IDS[source]
    games, entries, field = _games(source)
    if refs is not None:
        refs = {k: v for k, v in refs.items() if v}
        if not refs:
            return
        any_ref = Q()
        for kind, f in _KINDS:
            if refs.get(kind):
                any_ref |= Q(**{f"{f}__in": refs[kind]})
        entries = entries.filter(any_ref)
    columns = [f"{field}_id", *(f for _, f in _KINDS)]
    if source == "tables":
        rows = list(entries.values_list(*columns, "won"))
    else:
        rows = [(*r[:-2], r[-2] == r[-1]) for r in entries.values_list(*columns, "position", "draw__winner_position")]
    counted = _entry_model(source).objects.all()
    if refs is not None:
        counted = counted.filter(**{f"{field}_id__in": {r[0] for r in rows}})
    sizes = dict(counted.values_list(f"{field}_id").annotate(n=Count("id")).order_by())
    tally: dict[tuple[int, int, int], list[int]] = {}
    for game, *ids, won in rows:
        buckets = [0]
        bucket = _bucket(sizes.get(game, 0))
        if bucket is not None:
            buckets.append(bucket)
        for (kind, _), ref in zip(_KINDS, ids):
            if not ref or (refs is not None and ref not in refs.get(kind, ())):
                continue
            for b in buckets:
                t = tally.setdefault((b, kind, ref), [0, 0])
                t[0] += 1
                t[1] += bool(won)
    found = [RankingRow(source=sid, size=b, kind=kind, ref=ref, games=g, wins=w)
             for (b, kind, ref), (g, w) in tally.items()]
    found += [RankingRow(source=sid, size=b, kind=RankingRow.KIND_TOTAL, ref=0, games=n)
              for b, n in _totals(source).items()]
    with transaction.atomic():
        stale = RankingRow.objects.filter(source=sid)
        if refs is not None:
            mine = Q(kind=RankingRow.KIND_TOTAL)
            for kind, ids in refs.items():
                mine |= Q(kind=kind, ref__in=ids)
            stale = stale.filter(mine)
        stale.delete()  # quem perdeu a última partida de um tamanho some daquele quadro
        RankingRow.objects.bulk_create(found, batch_size=1000)


def touch(source: str, *refs: dict[int, set[int]]) -> None:
    """Uma partida mudou: refaz as linhas de quem jogou (refs_of, antes e depois) e limpa o cache."""
    merged: dict[int, set[int]] = {}
    for r in refs:
        for kind, ids in r.items():
            merged.setdefault(kind, set()).update(ids)
    from . import ratings, seasons

    _refresh(source, merged)
    ratings.rebuild(source)
    seasons.invalidate()
    invalidate()


def rebuild() -> None:
    """Refaz o ranking inteiro (manage.py rebuild_ranking: no deploy e uma vez por dia)."""
    from . import ratings, seasons

    for source in SOURCES:
        _refresh(source, None)
        ratings.rebuild(source)
    seasons.close_past()
    seasons.invalidate()
    invalidate()


def _key(source: str, size: int | None) -> str:
    return f"stats:global:{source}:{size or 'all'}"


def global_stats(source: str = "draws", size: int | None = None) -> dict:
    """Os quadros do ranking, lidos das linhas já somadas (RankingRow)."""
    from django.contrib.auth import get_user_model
    from django.db.models import ExpressionWrapper, FloatField, Sum

    source = source if source in SOURCES else "draws"
    size = size if size in SIZES else None
    cached = cache.get(_key(source, size))
    if cached is not None:
        return cached

    from pools.models import UserDeck
    from pools.serializers import UserDeckSummarySerializer

    from ..serializers import DeckListSerializer

    table = RankingRow.objects.filter(source=_SOURCE_IDS[source], size=size or 0)
    decks = table.filter(kind__in=(RankingRow.KIND_PRECON, RankingRow.KIND_USER_DECK)).annotate(
        rate=ExpressionWrapper(F("wins") * 1.0 / F("games"), output_field=FloatField())
    )
    qualified = decks.filter(games__gte=MIN_GAMES)
    # Azarado = abaixo da média da mesa (numa mesa de 4, a média é ganhar 25% das vezes)
    agg = decks.aggregate(games=Sum("games"), wins=Sum("wins"))
    average = (agg["wins"] or 0) / agg["games"] if agg["games"] else 0
    # Com folga, para os decks apagados depois da última partida (ficam de fora ao montar)
    boards = {
        "most_wins": list(decks.filter(wins__gt=0).order_by("-wins", "games", "ref")[:TOP * 2]),
        "best_rate": list(qualified.order_by("-rate", "-games", "ref")[:TOP * 2]),
        "unlucky": list(qualified.filter(rate__lt=average).order_by("rate", "-games", "ref")[:TOP * 2]),
    }
    picked = [r for rows in boards.values() for r in rows]
    precons = Deck.objects.select_related("edition", "face_commander").in_bulk(
        [r.ref for r in picked if r.kind == RankingRow.KIND_PRECON]
    )
    own = UserDeck.objects.select_related("owner", "face_commander").in_bulk(
        [r.ref for r in picked if r.kind == RankingRow.KIND_USER_DECK]
    )

    def serialize(r):
        if r.kind == RankingRow.KIND_PRECON:
            return DeckListSerializer(precons[r.ref]).data if r.ref in precons else None
        return UserDeckSummarySerializer(own[r.ref]).data if r.ref in own else None

    def with_deck(rows):
        out = []
        for r in rows:
            deck = serialize(r)
            if deck is not None:
                out.append({"deck": deck, "games": r.games, "wins": r.wins, "win_rate": _rate(r.wins, r.games)})
        return out[:TOP]

    # Jogadores: só quem tem conta. Ordem por quantidade de vitórias; no empate, quem precisou de
    # menos partidas fica na frente, e depois o nome (por isso vêm todos os empatados com o décimo)
    people = table.filter(kind=RankingRow.KIND_PLAYER, wins__gt=0).order_by("-wins", "games")
    head = list(people[:TOP * 2])
    if len(head) == TOP * 2:
        last = head[TOP - 1]
        head = list(people.filter(Q(wins__gt=last.wins) | Q(wins=last.wins, games__lte=last.games)))
    users = get_user_model().objects.in_bulk([r.ref for r in head])
    players = sorted(
        (
            {"id": r.ref, "username": users[r.ref].username, "games": r.games, "wins": r.wins,
             "win_rate": _rate(r.wins, r.games)}
            for r in head
            if r.ref in users
        ),
        key=lambda r: (-r["wins"], r["games"], r["username"].casefold()),
    )[:TOP]
    # Selo de apoiador ao lado do nome (accounts/supporter.py); o id não sai na resposta
    from accounts.supporter import active_ids

    # Rating (decks/services/ratings.py): contra quem ganhou, não só quantas vezes
    from . import ratings

    rated = ratings.top(source, size, TOP)
    backers = active_ids([r["id"] for r in players] + [r["id"] for r in rated])
    for r in [*players, *rated]:
        r["supporter"] = r.pop("id") in backers

    data = {
        "source": source,
        "players_per_game": size,
        "min_games": MIN_GAMES,
        "games": table.filter(kind=RankingRow.KIND_TOTAL).values_list("games", flat=True).first() or 0,
        "draws": Draw.objects.count(),
        "most_wins": with_deck(boards["most_wins"]),
        "best_rate": with_deck(boards["best_rate"]),
        "unlucky": with_deck(boards["unlucky"]),
        "players": players,
        "rated": rated,
        "rated_min": ratings.RATED_MIN,
    }
    cache.set(_key(source, size), data, CACHE_SECONDS)
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
    cache.delete_many([_key(s, n) for s in SOURCES for n in (None, *SIZES)])
