"""
Valor estimado dos decks (precons e decks montados): soma dos preços das cartas no Scryfall, na
edição que está no deck (USD vem do TCGplayer, EUR do Cardmarket). É uma estimativa: o preço muda
todo dia e varia por loja, idioma e estado da carta.

Os preços das cartas são atualizados no deploy (sync_prices) e, quando alguém abre um deck com o
valor calculado há mais de PRICE_TTL, só as cartas daquele deck (no máximo 2 chamadas ao Scryfall).
"""

import logging
import time
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from ..models import Card
from .http import fetch_json
from .scryfall import BATCH_SIZE, PRICE_FIELDS, SCRYFALL_API, apply_prices

log = logging.getLogger(__name__)
PRICE_TTL = timedelta(days=7)
TOP = 5  # cartas mais caras mostradas na página do deck


def stale_cards(qs, max_age: timedelta = PRICE_TTL):
    return qs.filter(Q(price_at__isnull=True) | Q(price_at__lt=timezone.now() - max_age))


def refresh_card_prices(cards, *, timeout: int = 60, delay: float = 0.1) -> int:
    """Busca o preço atual das cartas no Scryfall, em lotes de 75. Devolve quantas mudaram."""
    by_id = {str(c.scryfall_id): c for c in cards}
    ids = list(by_id)
    done = 0
    for start in range(0, len(ids), BATCH_SIZE):
        batch = ids[start : start + BATCH_SIZE]
        res = fetch_json(f"{SCRYFALL_API}/cards/collection", data={"identifiers": [{"id": i} for i in batch]}, timeout=timeout)
        changed = []
        for data in res.get("data", []):
            card = by_id.get(data["id"])
            if card:
                apply_prices(card, data)
                changed.append(card)
        Card.objects.bulk_update(changed, PRICE_FIELDS)
        done += len(changed)
        if start + BATCH_SIZE < len(ids):
            time.sleep(delay)
    return done


def deck_price(deck_cards) -> dict:
    """
    Valor de uma lista de cartas (objetos com .card e .quantity). `missing`: cópias sem preço no
    Scryfall (o total fica um pouco abaixo do real); `top`: as mais caras.
    """
    usd = eur = Decimal("0")
    missing = 0
    rows = []
    for dc in deck_cards:
        card, qty = dc.card, dc.quantity
        if card.price_usd is None and card.price_eur is None:
            if "Basic Land" not in card.type_line:  # básicos quase sempre vêm sem preço: não conta como falta
                missing += qty
            continue
        usd += (card.price_usd or 0) * qty
        eur += (card.price_eur or 0) * qty
        rows.append((card, qty))
    rows.sort(key=lambda r: r[0].price_usd or 0, reverse=True)
    return {
        "usd": usd.quantize(Decimal("0.01")),
        "eur": eur.quantize(Decimal("0.01")),
        "missing": missing,
        "top": [
            {"name": c.name, "quantity": q, "usd": c.price_usd, "eur": c.price_eur, "image": c.image_small or c.image_normal}
            for c, q in rows[:TOP]
            if c.price_usd or c.price_eur
        ],
    }


def update_deck_price(deck, *, refresh: bool = True, timeout: int = 8) -> None:
    """
    Recalcula e guarda o valor do deck (precon ou montado). Com `refresh`, antes atualiza no
    Scryfall as cartas dele com preço velho; se o Scryfall falhar, usa os preços que já tem.
    """
    deck_cards = list(deck.deck_cards.select_related("card"))
    if refresh and settings.PRICES_REFRESH_ENABLED:
        old = [dc.card for dc in deck_cards if dc.card.price_at is None or dc.card.price_at < timezone.now() - PRICE_TTL]
        if old:
            try:
                refresh_card_prices(old, timeout=timeout)
            except Exception as err:  # noqa: BLE001 — sem o Scryfall o deck mostra o último valor conhecido
                log.warning("preços do deck %s: Scryfall falhou (%s)", deck.pk, err)
    price = deck_price(deck_cards)
    deck.price_usd, deck.price_eur, deck.price_at = price["usd"], price["eur"], timezone.now()
    type(deck).objects.filter(pk=deck.pk).update(price_usd=deck.price_usd, price_eur=deck.price_eur, price_at=deck.price_at)


def price_is_stale(deck) -> bool:
    return deck.price_at is None or deck.price_at < timezone.now() - PRICE_TTL


def ensure_price(deck) -> bool:
    """Valor velho (ou nunca calculado): atualiza agora. True se mudou (recarregue as cartas do deck)."""
    if not price_is_stale(deck):
        return False
    update_deck_price(deck)
    return True
