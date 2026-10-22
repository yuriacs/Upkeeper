"""Leitura e gravação das mesas no banco, e as listas de cartas dos decks."""

import asyncio
import json
import time
from datetime import timedelta

from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.utils import timezone

from decks.models import Card, Deck, Draw
from pools.models import UserDeck

from .models import TableGame
from .state import IDLE_CLOSE, _mana_of


def _alive(row: TableGame) -> dict | None:
    """Dados da mesa salva, ou None se ela foi fechada ou ficou 10 minutos sem alteração."""
    data = row.data
    if data.get("closed"):
        return None
    # Mesas salvas antes de existir "changed_at": vale a hora da última gravação
    data.setdefault("changed_at", row.updated_at.timestamp())
    return data if time.time() - data["changed_at"] < IDLE_CLOSE else None


@database_sync_to_async
def load_table(code: str) -> dict | None:
    row = TableGame.objects.filter(code=code).first()
    if row is None:
        return None
    data = _alive(row)
    if data is None:
        row.delete()  # expirou enquanto o servidor estava parado: o código vira uma mesa nova
    else:
        _fill_mana(data)
    return data


def _fill_mana(data: dict) -> None:
    """
    Mesa com deck carregado antes do contador de mana (ou da mana por cor): completa a mana de
    cada carta pelo texto dela no banco. Sem isso, só os terrenos gerariam mana.
    """
    missing = [
        c for seat in data.get("seats", {}).values() for c in seat.get("cards", {}).values()
        if not c.get("token") and not isinstance(c.get("mana"), str)
    ]  # fmt: skip
    if not missing:
        return
    rows = {}
    for name, type_line, text in Card.objects.filter(name__in={c["name"] for c in missing}).values_list(
        "name", "type_line", "oracle_text"
    ):
        rows.setdefault(name, (type_line, text))
    for card in missing:
        if card["name"] in rows:
            card.pop("mana_back", None)
            card.update(_mana_of(*rows[card["name"]], card["name"]))


def delete_expired() -> None:
    """Apaga do banco as mesas paradas (a gravação é sempre depois da última alteração)."""
    TableGame.objects.filter(updated_at__lt=timezone.now() - timedelta(seconds=IDLE_CLOSE)).delete()


def active_rows_for(user_id: int) -> list[dict]:
    """Mesas salvas (ainda abertas) em que a conta tem lugar."""
    delete_expired()
    rows = TableGame.objects.filter(updated_at__gte=timezone.now() - timedelta(seconds=IDLE_CLOSE))
    found = []
    for row in rows.only("code", "data", "updated_at"):
        if str(user_id) in row.data.get("seats", {}) and (data := _alive(row)) is not None:
            found.append(data)
    return found


def recent_rows(limit: int = 30) -> list[dict]:
    """Mesas salvas ainda abertas (as alteradas mais recentemente primeiro), para a lista pública."""
    delete_expired()
    rows = TableGame.objects.filter(updated_at__gte=timezone.now() - timedelta(seconds=IDLE_CLOSE))
    found = []
    for row in rows.order_by("-updated_at").only("code", "data", "updated_at")[:limit]:
        if (data := _alive(row)) is not None:
            found.append(data)
    return found


@database_sync_to_async
def delete_table(code: str) -> None:
    TableGame.objects.filter(code=code).delete()


def cancel_save(code: str) -> None:
    task = _pending.pop(code, None)
    if task:
        task.cancel()


@database_sync_to_async
def save_table(code: str, data: dict) -> None:
    # Um UPDATE só (1 ida ao banco); o update_or_create fazia BEGIN, SELECT ... FOR UPDATE, UPDATE e
    # COMMIT, e a thread do banco (uma só para tudo) ficava presa 4x mais tempo em cada gravação
    if TableGame.objects.filter(code=code).update(data=data, updated_at=timezone.now()):
        return
    try:
        TableGame.objects.create(code=code, data=data)
    except IntegrityError:  # outra gravação criou a mesa no meio do caminho
        TableGame.objects.filter(code=code).update(data=data, updated_at=timezone.now())


# Gravação em segundo plano: a ação vai para todos na hora e o banco é atualizado logo depois,
# juntando várias ações seguidas numa gravação só (o Neon leva dezenas de ms por consulta).
# 3 s: no teste de carga (backend/stress) gravar a cada 0,8 s gastava ~30% da CPU do plano grátis;
# se o servidor cair, perde-se no máximo isso das últimas ações.
SAVE_DELAY = 3.0
_pending: dict[str, asyncio.Task] = {}


def schedule_save(code: str, table) -> None:
    if code in _pending:
        return  # a gravação já agendada vai pegar o estado mais novo

    async def run():
        await asyncio.sleep(SAVE_DELAY)
        _pending.pop(code, None)
        await save_table(code, _snapshot(table.data))

    _pending[code] = asyncio.ensure_future(run())


async def flush(code: str, table) -> None:
    """Grava já (ex.: último jogador saiu da mesa)."""
    task = _pending.pop(code, None)
    if task:
        task.cancel()
    await save_table(code, _snapshot(table.data))


def _snapshot(data: dict) -> dict:
    # Cópia feita no loop de eventos: a gravação roda em outra thread e a mesa pode mudar enquanto isso
    return json.loads(json.dumps(data))


@database_sync_to_async
def save_draw_result(code: str, position: int | None) -> None:
    """Vencedor da mesa vai para o sorteio de origem (ranking e histórico)."""
    from django.utils import timezone as tz

    from decks.services import stats

    draw = Draw.objects.filter(code__iexact=code).first()
    if draw is None or (position is not None and not draw.entries.filter(position=position).exists()):
        return
    draw.winner_position = position
    draw.result_at = tz.now() if position is not None else None
    draw.save(update_fields=["winner_position", "result_at"])
    stats.invalidate()


@database_sync_to_async
def save_table_result(data: dict, previous: int | None) -> int | None:
    """
    Resultado de uma mesa sem sorteio para o ranking das mesas. `previous`: o resultado já gravado
    desta partida (alguém remarcou o vencedor): é trocado, não duplicado. Sem vencedor, ou com
    menos de 2 jogadores com deck, não conta (e apaga o anterior). Devolve o id gravado ou None.
    """
    from django.db import transaction

    from decks.services import stats

    from .models import TableResult, TableResultEntry

    result = data.get("result") or {}
    winner = result.get("winner")
    seats = [s for s in data["seats"].values() if s.get("deck")]
    with transaction.atomic():
        if previous:
            TableResult.objects.filter(pk=previous).delete()
        if winner is None or len(seats) < 2 or not any(s["user_id"] == winner for s in seats):
            stats.invalidate()
            return None
        precons = Deck.objects.in_bulk([s["deck"]["ref"] for s in seats if s["deck"]["kind"] == "precon"], field_name="slug")
        own = UserDeck.objects.in_bulk(
            [int(s["deck"]["ref"]) for s in seats if s["deck"]["kind"] == "user" and str(s["deck"]["ref"]).isdigit()]
        )
        game = TableResult.objects.create(turns=result.get("turn") or 0)
        User = get_user_model()
        users = User.objects.in_bulk([s["user_id"] for s in seats])
        TableResultEntry.objects.bulk_create(
            TableResultEntry(
                result=game,
                player=users.get(s["user_id"]),
                deck=precons.get(s["deck"]["ref"]) if s["deck"]["kind"] == "precon" else None,
                user_deck=own.get(int(s["deck"]["ref"])) if s["deck"]["kind"] == "user" and str(s["deck"]["ref"]).isdigit() else None,
                won=s["user_id"] == winner,
            )
            for s in seats
        )
    stats.invalidate()
    return game.id


@database_sync_to_async
def deck_profile(kind: str, ref: str, need_bracket: bool = True) -> dict | None:
    """
    Bracket, tutores e valor (US$) do deck, para conferir as regras da mesa. Bracket que falta tenta
    calcular agora (Spellbook), só se a mesa limita o bracket; valor que falta sai dos preços das
    cartas que já estão no banco.
    """
    from decks.services.analysis import tags_for
    from decks.services.brackets import ensure_bracket
    from decks.services.prices import update_deck_price

    if kind == "precon":
        deck = Deck.objects.filter(slug=ref).first()
    elif kind == "user" and str(ref).isdigit():
        deck = UserDeck.objects.filter(pk=int(ref)).first()
    else:
        deck = None
    if deck is None:
        return None
    if need_bracket:
        ensure_bracket(deck)
    if deck.price_usd is None:
        update_deck_price(deck, refresh=False)
    rows = list(deck.deck_cards.select_related("card"))
    tags = tags_for(r.card.oracle_id for r in rows if r.card.oracle_id)
    tutors = sum(
        r.quantity for r in rows if r.card.category != "land" and "tutor" in tags.get(r.card.oracle_id, ())
    )
    return {"bracket": deck.bracket, "tutors": tutors, "price": float(deck.price_usd) if deck.price_usd is not None else None}


def _scryfall_image(name: str) -> str:
    from urllib.parse import quote

    return f"https://api.scryfall.com/cards/named?format=image&version=normal&exact={quote(name)}"


@database_sync_to_async
def deck_cards(kind: str, ref: str) -> tuple[dict, list[dict]] | None:
    """Deck (nome e referência) e as cartas, de um precon (slug) ou deck da pool (id). None se não existir."""
    if kind == "precon":
        deck = Deck.objects.filter(slug=ref).first()
    elif kind == "user" and str(ref).isdigit():
        deck = UserDeck.objects.filter(pk=int(ref)).first()
    else:
        deck = None
    if deck is None:
        return None
    # Deck montado: cartas com arte personalizada (enviada pelo dono) aparecem com ela na mesa
    arts = {}
    if kind == "user":
        from pools.services.card_art import deck_arts

        arts = deck_arts(deck)
    rows = [
        {
            "name": dc.card.name,
            "image": arts.get(str(dc.card.oracle_id)) or dc.card.image_normal or _scryfall_image(dc.card.name),
            "back": dc.card.image_back,
            "quantity": dc.quantity,
            "is_commander": dc.is_commander,
            "power": dc.card.power,
            "toughness": dc.card.toughness,
            "loyalty": dc.card.loyalty,
            "type_line": dc.card.type_line,
            "oracle_text": dc.card.oracle_text,
        }
        for dc in deck.deck_cards.select_related("card")
    ]
    meta = {"kind": kind, "ref": str(ref), "name": deck.name}
    return meta, rows


@database_sync_to_async
def dealt_for_code(code: str) -> list[dict]:
    """
    Decks de um sorteio cujo código é o da mesa ("Jogar agora" leva para /table/<código do sorteio>).
    Cada item: posição, nome do jogador, conta (salas online) e o deck.
    """
    draw = Draw.objects.filter(code__iexact=code).first()
    if draw is None:
        return []
    dealt = []
    for e in draw.entries.select_related("deck", "user_deck").order_by("position"):
        if e.deck_id:
            deck = {"kind": "precon", "ref": e.deck.slug, "name": e.deck.name}
        elif e.user_deck_id:
            deck = {"kind": "user", "ref": str(e.user_deck_id), "name": e.user_deck.name}
        else:
            continue
        dealt.append({"position": e.position, "player": e.player_name, "user_id": e.player_id, "deck": deck})
    return dealt


@database_sync_to_async
def save_play_time(times: dict[int, int]) -> None:
    """Soma o tempo da partida nas horas jogadas de cada jogador ({user_id: segundos})."""
    from django.core.cache import cache
    from django.db.models import F

    from .models import PlayTime

    User = get_user_model()
    for uid in User.objects.filter(pk__in=list(times)).values_list("pk", flat=True):
        PlayTime.objects.get_or_create(user_id=uid)
        PlayTime.objects.filter(user_id=uid).update(seconds=F("seconds") + times[uid], games=F("games") + 1)
        cache.delete(f"profile:{uid}")


REPLAY_DAYS = 180  # partidas para rever ficam guardadas esse tempo


@database_sync_to_async
def save_replay(replay: dict | None) -> int | None:
    """Guarda a partida para rever (compactada), ligada a quem jogou. Devolve o id ou None."""
    import zlib

    from .models import GameReplay, GameReplayPlayer

    if not replay:
        return None
    User = get_user_model()
    users = set(User.objects.filter(pk__in=[p["user"] for p in replay["players"]]).values_list("pk", flat=True))
    if len(users) < 2:
        return None
    blob = zlib.compress(json.dumps(replay, separators=(",", ":")).encode(), 6)
    row = GameReplay.objects.create(turns=len(replay["turns"]), data=blob)
    GameReplayPlayer.objects.bulk_create(GameReplayPlayer(replay=row, user_id=uid) for uid in users)
    GameReplay.objects.filter(finished_at__lt=timezone.now() - timedelta(days=REPLAY_DAYS)).delete()
    return row.pk
