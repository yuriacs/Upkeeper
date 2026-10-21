"""Transforma uma lista colada em um UserDeck, resolvendo as cartas no banco ou no Scryfall."""

from django.db import transaction
from django.db.models import Q
from django.db.models.functions import Lower

from decks.models import Card, normalize_colors
from decks.services.scryfall import fetch_cards

from ..models import UserDeck, UserDeckCard
from .decklist import DecklistError, ParsedLine, parse_decklist
from django.utils.translation import gettext as _


def _clean_name(value: str) -> str:
    """'1 Trostani, Selesnya's Voice' / '1x Nome (SET) 12' → só o nome."""
    parsed = parse_decklist(value)[0]
    return parsed.name.casefold()


def _find_local(lines: list[ParsedLine]) -> dict[int, Card]:
    """
    As cartas da lista que já estão no banco, em poucas consultas (antes era uma ou duas por
    linha: num deck de 100 cartas, até 200 idas ao banco). Pedido com edição e número: aquela
    impressão (se ainda não temos, fica para o Scryfall). Só o nome: nome exato primeiro; depois
    cartas de duas faces ("Frente // Verso").
    """
    found: dict[int, Card] = {}
    printed = [(i, line) for i, line in enumerate(lines) if line.set_code and line.collector_number]
    if printed:
        match = Q()
        for _i, line in printed:
            match |= Q(set_code__iexact=line.set_code, collector_number=line.collector_number)
        by_print: dict[tuple[str, str], Card] = {}
        for card in Card.objects.filter(match).order_by("pk"):
            by_print.setdefault((card.set_code.upper(), card.collector_number), card)
        for i, line in printed:
            card = by_print.get((line.set_code.upper(), line.collector_number))
            if card:
                found[i] = card

    named = [(i, line) for i, line in enumerate(lines) if not (line.set_code and line.collector_number)]
    if named:
        with_image = Card.objects.exclude(image_normal="").annotate(lname=Lower("name")).order_by("pk")
        wanted = {line.name.lower() for _i, line in named}
        exact: dict[str, Card] = {}
        for card in with_image.filter(lname__in=wanted):
            exact.setdefault(card.lname, card)
        faces: dict[str, Card] = {}
        rest = wanted - set(exact)
        if rest:
            match = Q()
            for name in rest:
                match |= Q(lname__startswith=f"{name} // ")
            for card in with_image.filter(match).exclude(layout="reversible_card"):
                faces.setdefault(card.lname.split(" // ")[0], card)
        for i, line in named:
            card = exact.get(line.name.lower()) or faces.get(line.name.lower())
            if card:
                found[i] = card
    return found


def resolve_cards(lines: list[ParsedLine], *, fetch=fetch_cards) -> list[tuple[ParsedLine, Card]]:
    resolved: dict[int, Card] = _find_local(lines)
    pending: list[int] = [idx for idx in range(len(lines)) if idx not in resolved]

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

    missing = [_("Line {n}: {text}").format(n=lines[i].line_no, text=lines[i].name) for i in range(len(lines)) if i not in resolved]
    if missing:
        raise DecklistError(_("Some cards were not found on Scryfall."), missing)
    return [(lines[i], resolved[i]) for i in range(len(lines))]


@transaction.atomic
def save_user_deck(
    owner, name: str, text: str, *, commanders: list[str] | None = None, deck: UserDeck | None = None, fetch=fetch_cards
) -> tuple[UserDeck, list[str]]:
    """
    Cria ou atualiza o deck. Retorna (deck, avisos). Levanta DecklistError se a lista for inválida.
    Só as linhas de carta que mudaram são trocadas; `deck.cards_changed` diz se a lista de cartas
    mudou (só nome ou categorias: o bracket e o preço continuam valendo) e `deck.added_cards`,
    quais cartas entraram (as únicas cujo preço precisa ser buscado).
    """
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
            _(
                'Tell us the commander: put it in a "Commander" section, mark it with [Commander] '
                "or pick it in the commander field."
            )
        )

    pairs = resolve_cards(lines, fetch=fetch)

    commander_cards = [card for line, card in pairs if line.is_commander]
    if len(commander_cards) > 2:
        raise DecklistError(_("A Commander deck has at most 2 commanders."))

    wanted: dict[tuple[int, bool], int] = {}
    for line, card in pairs:
        key = (card.pk, line.is_commander)
        wanted[key] = wanted.get(key, 0) + line.quantity
    current = {} if deck is None else {(r.card_id, r.is_commander): r for r in deck.deck_cards.all()}
    changed = deck is None or {k: r.quantity for k, r in current.items()} != wanted

    if deck is None:
        deck = UserDeck(owner=owner)
    deck.name = name.strip()
    deck.decklist_text = text
    deck.face_commander = commander_cards[0]
    deck.color_identity = normalize_colors({c for card in commander_cards for c in card.color_identity})
    if changed:
        # As cartas mudaram: o bracket antigo não vale mais (é recalculado logo depois de salvar)
        deck.bracket, deck.bracket_details, deck.bracket_checked_at = None, {}, None
    deck.save()

    # Só o que mudou: tira as linhas que saíram, acerta quantidades e cria as que entraram
    gone = [r.pk for k, r in current.items() if k not in wanted]
    if gone:
        UserDeckCard.objects.filter(pk__in=gone).delete()
    for key, qty in wanted.items():
        row = current.get(key)
        if row and row.quantity != qty:
            UserDeckCard.objects.filter(pk=row.pk).update(quantity=qty)
    UserDeckCard.objects.bulk_create(
        UserDeckCard(deck=deck, card_id=card_id, quantity=qty, is_commander=is_cmd)
        for (card_id, is_cmd), qty in wanted.items()
        if (card_id, is_cmd) not in current
    )
    deck.cards_changed = changed
    deck.added_cards = {card_id for (card_id, _c) in wanted} - {card_id for (card_id, _c) in current}

    warnings = []
    total = sum(wanted.values())
    if total != 100:
        warnings.append(_("The deck has {n} cards (Commander decks usually have 100).").format(n=total))
    return deck, warnings
