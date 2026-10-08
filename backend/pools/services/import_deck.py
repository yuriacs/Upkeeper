"""Transforma uma lista colada em um UserDeck, resolvendo as cartas no banco ou no Scryfall."""

from django.db import transaction

from decks.models import Card, normalize_colors
from decks.services.scryfall import fetch_cards

from ..models import UserDeck, UserDeckCard
from .decklist import DecklistError, ParsedLine, parse_decklist


def _clean_name(value: str) -> str:
    """'1 Trostani, Selesnya's Voice' / '1x Nome (SET) 12' → só o nome."""
    parsed = parse_decklist(value)[0]
    return parsed.name.casefold()


def _find_local(line: ParsedLine) -> Card | None:
    if line.set_code and line.collector_number:
        card = Card.objects.filter(
            set_code__iexact=line.set_code, collector_number=line.collector_number
        ).first()
        # A lista pediu uma impressão específica que ainda não temos: busca no Scryfall
        return card
    # Nome exato primeiro; só depois cartas de duas faces ("Frente // Verso")
    with_image = Card.objects.exclude(image_normal="")
    return (
        with_image.filter(name__iexact=line.name).first()
        or with_image.filter(name__istartswith=f"{line.name} // ").exclude(layout="reversible_card").first()
    )


def resolve_cards(lines: list[ParsedLine], *, fetch=fetch_cards) -> list[tuple[ParsedLine, Card]]:
    resolved: dict[int, Card] = {}
    pending: list[int] = []
    for idx, line in enumerate(lines):
        card = _find_local(line)
        if card:
            resolved[idx] = card
        else:
            pending.append(idx)

    if pending:
        requests = []
        for idx in pending:
            line = lines[idx]
            if line.set_code and line.collector_number:
                requests.append({"set": line.set_code.lower(), "collector_number": line.collector_number})
            else:
                requests.append({"name": line.name})
        found = fetch(requests)
        # Se o set/número não bateu, tenta de novo só pelo nome
        retry = [i for i in range(len(pending)) if i not in found and "set" in requests[i]]
        if retry:
            by_name = fetch([{"name": lines[pending[i]].name} for i in retry])
            for j, i in enumerate(retry):
                if j in by_name:
                    found[i] = by_name[j]
        for i, idx in enumerate(pending):
            if i in found:
                resolved[idx] = found[i]

    missing = [f"Linha {lines[i].line_no}: {lines[i].name}" for i in range(len(lines)) if i not in resolved]
    if missing:
        raise DecklistError("Algumas cartas não foram encontradas no Scryfall.", missing)
    return [(lines[i], resolved[i]) for i in range(len(lines))]


@transaction.atomic
def save_user_deck(
    owner, name: str, text: str, *, commanders: list[str] | None = None, deck: UserDeck | None = None, fetch=fetch_cards
) -> tuple[UserDeck, list[str]]:
    """Cria ou atualiza o deck. Retorna (deck, avisos). Levanta DecklistError se a lista for inválida."""
    lines = parse_decklist(text)

    # Comandante indicado à parte (quando a lista não marca nenhum)
    # Comandante indicado no campo à parte tem prioridade sobre o que foi deduzido da lista
    if commanders:
        wanted = {_clean_name(c) for c in commanders if c.strip()}
        if any(line.name.casefold() in wanted for line in lines):
            for line in lines:
                line.is_commander = line.name.casefold() in wanted

    if not any(line.is_commander for line in lines):
        raise DecklistError(
            "Indique o comandante: coloque-o numa seção \"Commander\", marque com [Commander] "
            "ou escolha no campo de comandante."
        )

    pairs = resolve_cards(lines, fetch=fetch)

    commander_cards = [card for line, card in pairs if line.is_commander]
    if len(commander_cards) > 2:
        raise DecklistError("Um deck de Commander tem no máximo 2 comandantes.")

    if deck is None:
        deck = UserDeck(owner=owner)
    deck.name = name.strip()
    deck.decklist_text = text
    deck.face_commander = commander_cards[0]
    deck.color_identity = normalize_colors({c for card in commander_cards for c in card.color_identity})
    deck.save()

    deck.deck_cards.all().delete()
    rows: dict[tuple, UserDeckCard] = {}
    for line, card in pairs:
        key = (card.pk, line.is_commander)
        if key in rows:
            rows[key].quantity += line.quantity
        else:
            rows[key] = UserDeckCard(deck=deck, card=card, quantity=line.quantity, is_commander=line.is_commander)
    UserDeckCard.objects.bulk_create(rows.values())

    warnings = []
    total = sum(r.quantity for r in rows.values())
    if total != 100:
        warnings.append(f"O deck tem {total} cartas (o normal no Commander é 100).")
    return deck, warnings
