"""
Integração com a Scryfall API: nomes/ícones das edições e imagens das cartas.

Regras da API (https://scryfall.com/docs/api): User-Agent e Accept obrigatórios,
50–100 ms entre requisições. Usamos /cards/collection, que resolve até 75
cartas por chamada.
"""

import time
import urllib.error
import urllib.parse

from django.utils import timezone

from ..models import Card, Edition
from .http import fetch_json

SCRYFALL_API = "https://api.scryfall.com"
BATCH_SIZE = 75


def sync_editions(codes: set[str] | None = None) -> int:
    """Preenche nome, data e ícone das edições usando /sets do Scryfall."""
    sets = {s["code"].upper(): s for s in fetch_json(f"{SCRYFALL_API}/sets")["data"]}
    qs = Edition.objects.all()
    if codes:
        qs = qs.filter(code__in=codes)
    updated = 0
    for edition in qs:
        s = sets.get(edition.code.upper())
        if not s:
            continue
        edition.name = s["name"]
        edition.icon_svg_uri = s.get("icon_svg_uri", "")
        if s.get("released_at"):
            edition.release_date = s["released_at"]
        edition.save()
        updated += 1
    return updated


def apply_scryfall_data(card: Card, data: dict) -> None:
    faces = data.get("card_faces") or []
    front = data.get("image_uris") or (faces[0].get("image_uris") if faces else None) or {}
    back = faces[1].get("image_uris", {}) if len(faces) > 1 and not data.get("image_uris") else {}

    card.image_normal = front.get("normal", "")
    card.image_small = front.get("small", "")
    card.image_art_crop = front.get("art_crop", "")
    card.image_back = back.get("normal", "")
    card.oracle_id = data.get("oracle_id") or card.oracle_id
    card.type_line = data.get("type_line") or card.type_line
    # Cartas de duas faces: o MTGJSON traz só o texto da frente; o Scryfall traz ambos
    if faces and not data.get("oracle_text"):
        card.oracle_text = "\n//\n".join(f.get("oracle_text", "") for f in faces)
    # Força/resistência e lealdade da face da frente (usadas na mesa virtual)
    first = faces[0] if faces else {}
    card.power = data.get("power") or first.get("power") or ""
    card.toughness = data.get("toughness") or first.get("toughness") or ""
    card.loyalty = data.get("loyalty") or first.get("loyalty") or ""
    card.scryfall_synced_at = timezone.now()


FIELDS = [
    "image_normal", "image_small", "image_art_crop", "image_back",
    "oracle_id", "type_line", "oracle_text", "power", "toughness", "loyalty", "scryfall_synced_at",
]


def sync_cards(queryset=None, *, delay: float = 0.1, log=print) -> tuple[int, list[str]]:
    """Busca imagens das cartas em lotes de 75. Retorna (atualizadas, ids não encontrados)."""
    qs = queryset if queryset is not None else Card.objects.filter(image_normal="")
    cards = {str(c.scryfall_id): c for c in qs}
    ids = list(cards)
    total, not_found = 0, []

    for start in range(0, len(ids), BATCH_SIZE):
        batch = ids[start : start + BATCH_SIZE]
        res = fetch_json(
            f"{SCRYFALL_API}/cards/collection",
            data={"identifiers": [{"id": i} for i in batch]},
        )
        changed = []
        for data in res.get("data", []):
            card = cards.get(data["id"])
            if card:
                apply_scryfall_data(card, data)
                changed.append(card)
        Card.objects.bulk_update(changed, FIELDS)
        total += len(changed)
        not_found += [nf.get("id", str(nf)) for nf in res.get("not_found", [])]
        log(f"  {min(start + BATCH_SIZE, len(ids))}/{len(ids)} cartas")
        time.sleep(delay)

    return total, not_found


# --- Cartas que ainda não existem no banco (decks importados pelos usuários) ---------------

def _types_from_type_line(type_line: str) -> list[str]:
    front = type_line.split(" // ")[0]
    return front.split("—")[0].split()


def card_from_scryfall(data: dict) -> Card:
    """Cria (ou devolve) a Card correspondente a um objeto de carta do Scryfall."""
    from ..models import normalize_colors
    from .mtgjson import categorize

    existing = Card.objects.filter(scryfall_id=data["id"]).first()
    if existing:
        return existing
    faces = data.get("card_faces") or []
    front = faces[0] if faces else {}
    card = Card(
        scryfall_id=data["id"],
        oracle_id=data.get("oracle_id") or front.get("oracle_id"),
        name=data["name"],
        mana_cost=data.get("mana_cost") or front.get("mana_cost", "") or "",
        cmc=data.get("cmc", 0) or 0,
        type_line=data.get("type_line", ""),
        oracle_text=data.get("oracle_text", ""),
        colors=normalize_colors(data.get("colors") or front.get("colors") or []),
        color_identity=normalize_colors(data.get("color_identity", [])),
        category=categorize(_types_from_type_line(data.get("type_line", ""))),
        layout=data.get("layout", ""),
        rarity=data.get("rarity", ""),
        set_code=data.get("set", "").upper(),
        collector_number=data.get("collector_number", ""),
    )
    apply_scryfall_data(card, data)
    card.save()
    return card


def _matches_name(data: dict, name: str) -> bool:
    name = name.casefold()
    names = [data.get("name", "")] + [f.get("name", "") for f in data.get("card_faces") or []]
    return any(n.casefold() == name for n in names)


def fetch_cards(requests: list[dict], *, delay: float = 0.1) -> dict[int, Card]:
    """
    Busca no Scryfall cartas pedidas como {"name": ...} ou {"set": ..., "collector_number": ...}.
    Retorna {índice do pedido: Card}. O que não for achado fica de fora.
    """
    found: dict[int, Card] = {}
    for start in range(0, len(requests), BATCH_SIZE):
        batch = list(enumerate(requests[start : start + BATCH_SIZE], start))
        res = fetch_json(f"{SCRYFALL_API}/cards/collection", data={"identifiers": [r for _, r in batch]})
        results = res.get("data", [])
        for i, req in batch:
            for data in results:
                if "collector_number" in req:
                    ok = data.get("set", "").lower() == req["set"].lower() and data.get(
                        "collector_number") == req["collector_number"]
                else:
                    ok = _matches_name(data, req["name"])
                if ok:
                    found[i] = card_from_scryfall(data)
                    break
        time.sleep(delay)

    # Último recurso: busca aproximada por nome, uma a uma (erros de digitação, acentos…)
    missing = [i for i in range(len(requests)) if i not in found and requests[i].get("name")]
    for i in missing[:15]:
        try:
            data = fetch_json(
                f"{SCRYFALL_API}/cards/named?fuzzy={urllib.parse.quote(requests[i]['name'])}"
            )
        except urllib.error.HTTPError:
            data = None
        if data and data.get("object") == "card":
            found[i] = card_from_scryfall(data)
        time.sleep(delay)
    return found
