"""Leitura e gravação das mesas no banco, e as listas de cartas dos decks."""

import asyncio
import json
import time
from datetime import timedelta

from channels.db import database_sync_to_async
from django.utils import timezone

from decks.models import Deck, Draw
from pools.models import UserDeck

from .models import TableGame
from .state import IDLE_CLOSE


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
    return data


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


@database_sync_to_async
def delete_table(code: str) -> None:
    TableGame.objects.filter(code=code).delete()


def cancel_save(code: str) -> None:
    task = _pending.pop(code, None)
    if task:
        task.cancel()


@database_sync_to_async
def save_table(code: str, data: dict) -> None:
    TableGame.objects.update_or_create(code=code, defaults={"data": data})


# Gravação em segundo plano: a ação vai para todos na hora e o banco é atualizado logo depois,
# juntando várias ações seguidas numa gravação só (o Neon leva dezenas de ms por consulta).
SAVE_DELAY = 0.8
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
    rows = [
        {
            "name": dc.card.name,
            "image": dc.card.image_normal or _scryfall_image(dc.card.name),
            "back": dc.card.image_back,
            "quantity": dc.quantity,
            "is_commander": dc.is_commander,
            "power": dc.card.power,
            "toughness": dc.card.toughness,
            "loyalty": dc.card.loyalty,
        }
        for dc in deck.deck_cards.select_related("card")
    ]
    meta = {"kind": kind, "ref": str(ref), "name": deck.name}
    return meta, rows


@database_sync_to_async
def dealt_for_code(code: str) -> list[dict]:
    """
    Decks de um sorteio cujo código é o da mesa ("Jogar agora" leva para /mesa/<código do sorteio>).
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
