"""Leitura e gravação das mesas no banco, e as listas de cartas dos decks."""

from datetime import timedelta

from channels.db import database_sync_to_async
from django.utils import timezone

from decks.models import Deck
from pools.models import UserDeck

from .models import TableGame

STALE_AFTER = timedelta(days=7)  # mesa parada há mais de uma semana recomeça do zero


@database_sync_to_async
def load_table(code: str) -> dict | None:
    row = TableGame.objects.filter(code=code, updated_at__gte=timezone.now() - STALE_AFTER).first()
    return row.data if row else None


@database_sync_to_async
def save_table(code: str, data: dict) -> None:
    TableGame.objects.update_or_create(code=code, defaults={"data": data})


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
        }
        for dc in deck.deck_cards.select_related("card")
    ]
    meta = {"kind": kind, "ref": str(ref), "name": deck.name}
    return meta, rows
