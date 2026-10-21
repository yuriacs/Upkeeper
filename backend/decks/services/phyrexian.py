"""
Edições em phyrexiano (Jace, the Perfected Mind de ONE, por exemplo): o texto da carta é escrito
no alfabeto phyrexiano e não dá para ler. Elas às vezes são as mais baratas, então a busca "pela
edição mais barata" do deckbuilder as escolhia. A busca agora as deixa de fora; aqui os decks
montados que já tinham uma passam a usar a edição inglesa mais barata da mesma carta.
"""

import re
import urllib.parse

from django.db import transaction
from django.db.models import Q

from ..models import Card
from .http import fetch_json
from .prices import CHEAPEST_BATCH, _cheapest
from .scryfall import SCRYFALL_API, card_from_scryfall


def phyrexian_prints() -> set[tuple[str, str]]:
    """(edição, número) de todas as impressões em phyrexiano no Scryfall (umas 50)."""
    url = f"{SCRYFALL_API}/cards/search?{urllib.parse.urlencode({'q': 'lang:ph', 'unique': 'prints'})}"
    out = set()
    while url:
        page = fetch_json(url)
        out |= {(c["set"].upper(), c["collector_number"]) for c in page.get("data", [])}
        url = page.get("next_page") if page.get("has_more") else None
    return out


def _swap_in_text(text: str, name: str, old: Card, new: Card) -> str:
    """Troca "(ONE) 325" por "(ONE) 57" nas linhas da carta na lista em texto do deck."""
    pattern = re.compile(rf"\({re.escape(old.set_code)}\)\s+{re.escape(old.collector_number)}\b", re.IGNORECASE)
    lines = [
        pattern.sub(f"({new.set_code}) {new.collector_number}", line) if name.casefold() in line.casefold() else line
        for line in text.split("\n")
    ]
    return "\n".join(lines)


def replace_phyrexian_prints(log=print) -> int:
    """Decks montados com edição em phyrexiano passam para a inglesa mais barata. Devolve quantas linhas mudaram."""
    from pools.models import UserDeckCard

    prints = phyrexian_prints()
    if not prints:
        return 0
    match = Q()
    for set_code, number in prints:
        match |= Q(set_code=set_code, collector_number=number)
    bad = list(Card.objects.filter(match, user_deck_cards__isnull=False).distinct())
    oracle_ids = sorted({str(c.oracle_id) for c in bad if c.oracle_id})
    found: dict[str, dict] = {}
    for i in range(0, len(oracle_ids), CHEAPEST_BATCH):
        found.update(_cheapest(oracle_ids[i : i + CHEAPEST_BATCH], "usd-low", 30))

    changed = 0
    for card in bad:
        data = found.get(str(card.oracle_id))
        if not data or data.get("lang") == "ph":
            log(f"  {card.name} ({card.set_code} {card.collector_number}): sem edição em inglês")
            continue
        good = card_from_scryfall(data)
        for row in UserDeckCard.objects.filter(card=card).select_related("deck"):
            with transaction.atomic():
                same = UserDeckCard.objects.filter(deck=row.deck, card=good, is_commander=row.is_commander).first()
                if same:  # o deck já tinha a edição boa na mesma zona: junta as quantidades
                    same.quantity += row.quantity
                    same.save(update_fields=["quantity"])
                    row.delete()
                else:
                    row.card = good
                    row.save(update_fields=["card"])
                deck = row.deck
                deck.decklist_text = _swap_in_text(deck.decklist_text, card.name, card, good)
                deck.save(update_fields=["decklist_text"])
            changed += 1
            log(f"  {deck.name}: {card.name} {card.set_code} {card.collector_number} -> {good.set_code} {good.collector_number}")
    return changed
