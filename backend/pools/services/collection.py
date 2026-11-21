"""
Coleção do jogador: as cartas que ele tem de verdade, importadas do ManaBox, Moxfield, Archidekt,
Deckbox ou de uma lista de texto. O navegador lê o arquivo, junta as linhas repetidas e manda em
lotes (MAX_ROWS por pedido) para não estourar o tempo de uma requisição; cada lote é resolvido aqui
como a importação de deck: primeiro no banco (pelo id do Scryfall, edição e número, ou nome) e o que
faltar no Scryfall, em lotes de 75. A coleção alimenta o "só com as suas cartas" do gerador e as
marcações de "você tem" no deckbuilder.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from django.db import transaction
from django.db.models import F, Q
from django.db.models.functions import Least, Lower

from decks.models import Card
from decks.services.scryfall import fetch_cards

from ..models import CollectionCard

MAX_ROWS = 400  # linhas por pedido de importação
MAX_ENTRIES = 25_000  # cartas diferentes (impressão + foil) numa coleção
MAX_QUANTITY = 9_999


@dataclass
class Row:
    quantity: int
    name: str = ""
    set_code: str = ""
    number: str = ""
    scryfall_id: str = ""
    foil: bool = False


def parse_rows(raw) -> list[Row]:
    """Valida as linhas que o navegador mandou. Linha sem nome, edição+número ou id fica de fora."""
    if not isinstance(raw, list):
        raise ValueError("bad_rows")
    rows = []
    for item in raw[:MAX_ROWS]:
        if not isinstance(item, dict):
            continue
        try:
            qty = int(item.get("quantity") or 1)
        except (TypeError, ValueError):
            continue
        qty = max(1, min(MAX_QUANTITY, qty))
        sid = str(item.get("scryfall_id") or "").strip().lower()
        try:
            sid = str(uuid.UUID(sid)) if sid else ""
        except ValueError:
            sid = ""
        row = Row(
            quantity=qty,
            name=" ".join(str(item.get("name") or "").split())[:200],
            set_code=str(item.get("set") or "").strip().lower()[:10],
            number=str(item.get("number") or "").strip()[:20],
            scryfall_id=sid,
            foil=bool(item.get("foil")),
        )
        if row.name or row.scryfall_id or (row.set_code and row.number):
            rows.append(row)
    return rows


def _local(rows: list[Row]) -> dict[int, Card]:
    """O que já está no banco, em poucas consultas: id do Scryfall, edição+número e, por fim, nome."""
    found: dict[int, Card] = {}
    ids = {r.scryfall_id for r in rows if r.scryfall_id}
    if ids:
        by_id = {str(c.scryfall_id): c for c in Card.objects.filter(scryfall_id__in=ids)}
        for i, r in enumerate(rows):
            if r.scryfall_id in by_id:
                found[i] = by_id[r.scryfall_id]
    printed = [(i, r) for i, r in enumerate(rows) if i not in found and r.set_code and r.number]
    if printed:
        match = Q()
        for _i, r in printed:
            match |= Q(set_code__iexact=r.set_code, collector_number=r.number)
        by_print: dict[tuple[str, str], Card] = {}
        for card in Card.objects.filter(match).order_by("pk"):
            by_print.setdefault((card.set_code.lower(), card.collector_number), card)
        for i, r in printed:
            card = by_print.get((r.set_code, r.number))
            if card:
                found[i] = card
    # Só pelo nome: só quando a linha não diz a impressão (senão o Scryfall acha a certa)
    named = [(i, r) for i, r in enumerate(rows) if i not in found and r.name and not r.scryfall_id and not (r.set_code and r.number)]
    if named:
        with_image = Card.objects.exclude(image_normal="").annotate(lname=Lower("name")).order_by("pk")
        wanted = {r.name.lower() for _i, r in named}
        exact: dict[str, Card] = {}
        for card in with_image.filter(lname__in=wanted):
            exact.setdefault(card.lname, card)
        rest = wanted - set(exact)
        faces: dict[str, Card] = {}
        if rest:
            match = Q()
            for name in rest:
                match |= Q(lname__startswith=f"{name} // ")
            for card in with_image.filter(match).exclude(layout="reversible_card"):
                faces.setdefault(card.lname.split(" // ")[0], card)
        for i, r in named:
            card = exact.get(r.name.lower()) or faces.get(r.name.lower())
            if card:
                found[i] = card
    return found


def resolve(rows: list[Row], *, fetch=None) -> tuple[list[tuple[Row, Card]], list[str]]:
    """[(linha, carta)] e os nomes não achados."""
    fetch = fetch or fetch_cards
    found = _local(rows)
    pending = [i for i in range(len(rows)) if i not in found]
    if pending:
        requests = []
        for i in pending:
            r = rows[i]
            if r.scryfall_id:
                requests.append({"id": r.scryfall_id})
            elif r.set_code and r.number:
                requests.append({"set": r.set_code, "collector_number": r.number})
            else:
                requests.append({"name": r.name})
        got = fetch(requests)
        # Impressão que não bateu (id ou edição/número errados): tenta só pelo nome
        retry = [j for j in range(len(pending)) if j not in got and "name" not in requests[j] and rows[pending[j]].name]
        if retry:
            by_name = fetch([{"name": rows[pending[j]].name} for j in retry])
            for k, j in enumerate(retry):
                if k in by_name:
                    got[j] = by_name[k]
        for j, i in enumerate(pending):
            if j in got:
                found[i] = got[j]
    missing = [rows[i].name or f"{rows[i].set_code.upper()} {rows[i].number}".strip() or rows[i].scryfall_id for i in range(len(rows)) if i not in found]
    return [(rows[i], found[i]) for i in sorted(found)], missing


@transaction.atomic
def add_to_collection(user, pairs: list[tuple[Row, Card]], *, replace: bool = False) -> int:
    """Soma as cartas na coleção (replace: apaga a coleção antes). Devolve quantas cópias entraram."""
    if replace:
        CollectionCard.objects.filter(user=user).delete()
    wanted: dict[tuple[int, bool], int] = {}
    for row, card in pairs:
        key = (card.pk, row.foil)
        wanted[key] = min(MAX_QUANTITY, wanted.get(key, 0) + row.quantity)
    if not wanted:
        return 0
    existing = {
        (c.card_id, c.foil): c
        for c in CollectionCard.objects.select_for_update().filter(user=user, card_id__in={k[0] for k in wanted})
    }
    room = MAX_ENTRIES - CollectionCard.objects.filter(user=user).count()
    new, added = [], 0
    for (card_id, foil), qty in wanted.items():
        row = existing.get((card_id, foil))
        if row is not None:
            CollectionCard.objects.filter(pk=row.pk).update(quantity=Least(F("quantity") + qty, MAX_QUANTITY))
            added += qty
        elif room > 0:
            new.append(CollectionCard(user=user, card_id=card_id, foil=foil, quantity=qty))
            room -= 1
            added += qty
    CollectionCard.objects.bulk_create(new)
    return added


def owned_names(user) -> list[str]:
    """Nomes (em minúsculas) das cartas da coleção: o deckbuilder marca o que você tem."""
    names = CollectionCard.objects.filter(user=user).values_list("card__name", flat=True).distinct()
    out = set()
    for name in names:
        out.add(name.casefold())
        out.add(name.split(" // ")[0].casefold())  # cartas de duas faces: pelo nome da frente também
    return sorted(out)
