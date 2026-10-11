"""
Importação dos precons de Commander a partir do MTGJSON.

Fluxo: DeckList.json (índice) → filtra type == "Commander Deck" → baixa cada
arquivo de deck → cria Edition, Card, Deck e DeckCard.

O MTGJSON já traz nome, tipo, custo, texto e scryfallId de cada carta, então as
cartas nascem completas; o sync_scryfall só adiciona as imagens.
"""

import json
import time
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from django.db import transaction
from django.utils.text import slugify

from ..models import Card, Deck, DeckCard, Edition, normalize_colors
from .http import fetch_json

MTGJSON_BASE = "https://mtgjson.com/api/v5"
COMMANDER_TYPE = "Commander Deck"

# Ordem de prioridade: a primeira que aparecer nos tipos da carta vence.
# Ex.: "Artifact Creature" → Criaturas; "Artifact Land" → Terrenos.
CATEGORY_PRIORITY = [
    ("Land", Card.Category.LAND),
    ("Creature", Card.Category.CREATURE),
    ("Planeswalker", Card.Category.PLANESWALKER),
    ("Battle", Card.Category.BATTLE),
    ("Artifact", Card.Category.ARTIFACT),
    ("Enchantment", Card.Category.ENCHANTMENT),
    ("Instant", Card.Category.INSTANT),
    ("Sorcery", Card.Category.SORCERY),
]


def categorize(types: list[str]) -> str:
    for type_name, category in CATEGORY_PRIORITY:
        if type_name in types:
            return category
    return Card.Category.OTHER


def is_variant(name: str) -> bool:
    """Versões de colecionador repetem a lista do deck normal — ficam fora do sorteio."""
    return "collector" in name.lower()


def parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


@dataclass
class ImportResult:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    failed: list[tuple[str, str]] = field(default_factory=list)


class MtgjsonSource:
    """Lê do site do MTGJSON ou de uma pasta local (útil para testes e uso offline)."""

    def __init__(self, local_dir: Path | None = None, delay: float = 0.1):
        self.local_dir = local_dir
        self.delay = delay

    def deck_list(self) -> list[dict]:
        if self.local_dir:
            data = json.loads((self.local_dir / "DeckList.json").read_text(encoding="utf-8"))
        else:
            data = fetch_json(f"{MTGJSON_BASE}/DeckList.json")
        return data["data"]

    def deck(self, file_name: str) -> dict:
        if self.local_dir:
            path = self.local_dir / "decks" / f"{file_name}.json"
            return json.loads(path.read_text(encoding="utf-8"))["data"]
        time.sleep(self.delay)  # gentileza com o servidor do MTGJSON
        return fetch_json(f"{MTGJSON_BASE}/decks/{file_name}.json.gz")["data"]


def card_defaults(c: dict) -> dict:
    return {
        "oracle_id": c["identifiers"].get("scryfallOracleId"),
        "name": c["name"],
        "mana_cost": c.get("manaCost", ""),
        "cmc": c.get("manaValue", 0),
        "type_line": c.get("type", ""),
        "oracle_text": c.get("text", ""),
        "colors": normalize_colors(c.get("colors", [])),
        "color_identity": normalize_colors(c.get("colorIdentity", [])),
        "category": categorize(c.get("types", [])),
        "layout": c.get("layout", ""),
        "rarity": c.get("rarity", ""),
        "set_code": c.get("setCode", ""),
        "collector_number": c.get("number", ""),
        "power": c.get("power", "") or "",
        "toughness": c.get("toughness", "") or "",
        "loyalty": c.get("loyalty", "") or "",
    }


def get_or_create_card(c: dict, cache: dict) -> Card:
    scryfall_id = c["identifiers"]["scryfallId"]
    if scryfall_id not in cache:
        card, _ = Card.objects.get_or_create(scryfall_id=scryfall_id, defaults=card_defaults(c))
        cache[scryfall_id] = card
    return cache[scryfall_id]


def unique_slug(name: str, code: str, exclude_pk: int | None = None) -> str:
    base = slugify(f"{name}-{code}")[:200]
    slug, n = base, 2
    while Deck.objects.filter(slug=slug).exclude(pk=exclude_pk).exists():
        slug, n = f"{base}-{n}", n + 1
    return slug


@transaction.atomic
def import_deck(entry: dict, data: dict, editions: dict[str, Edition], card_cache: dict) -> tuple[Deck, bool]:
    """Cria ou recria um deck. Retorna (deck, criado?)."""
    code = entry["code"]
    edition = editions.get(code)
    if edition is None:
        edition, _ = Edition.objects.get_or_create(
            code=code, defaults={"name": code, "release_date": parse_date(entry.get("releaseDate"))}
        )
        editions[code] = edition

    commanders = data.get("commander", [])
    main = data.get("mainBoard", [])

    deck = Deck.objects.filter(mtgjson_file=entry["fileName"]).first()
    created = deck is None
    if created:
        deck = Deck(mtgjson_file=entry["fileName"], is_active=not is_variant(entry["name"]))

    deck.name = data["name"]
    deck.edition = edition
    deck.release_date = parse_date(data.get("releaseDate") or entry.get("releaseDate"))
    deck.source_url = data.get("source") or ""
    deck.slug = deck.slug or unique_slug(deck.name, code, exclude_pk=deck.pk)
    deck.color_identity = normalize_colors(
        {color for c in commanders for color in c.get("colorIdentity", [])}
    )
    deck.save()

    # Recria a lista do zero (mais simples e seguro que comparar diferenças)
    deck.deck_cards.all().delete()
    rows: dict[tuple[str, bool], DeckCard] = {}
    for c, is_cmd in [(c, True) for c in commanders] + [(c, False) for c in main]:
        card = get_or_create_card(c, card_cache)
        key = (str(card.scryfall_id), is_cmd)
        if key in rows:  # mesma carta listada duas vezes (ex.: foil e não-foil)
            rows[key].quantity += c.get("count", 1)
        else:
            rows[key] = DeckCard(deck=deck, card=card, quantity=c.get("count", 1), is_commander=is_cmd)
    DeckCard.objects.bulk_create(rows.values())

    if commanders:
        deck.face_commander = get_or_create_card(commanders[0], card_cache)
        deck.save(update_fields=["face_commander"])

    return deck, created


def import_commander_decks(
    source: MtgjsonSource,
    *,
    only: list[str] | None = None,
    limit: int | None = None,
    update: bool = False,
    editions: dict[str, Edition] | None = None,
    log=print,
) -> ImportResult:
    entries = [e for e in source.deck_list() if e["type"] == COMMANDER_TYPE]
    entries.sort(key=lambda e: (e.get("releaseDate") or "", e["fileName"]))
    if only:
        entries = [e for e in entries if e["fileName"] in only]
    if limit:
        entries = entries[:limit]

    existing = set(Deck.objects.exclude(mtgjson_file=None).values_list("mtgjson_file", flat=True))
    editions = editions if editions is not None else {e.code: e for e in Edition.objects.all()}
    card_cache: dict = {}
    result = ImportResult()

    for i, entry in enumerate(entries, 1):
        file_name = entry["fileName"]
        if file_name in existing and not update:
            result.skipped.append(file_name)
            continue
        try:
            data = source.deck(file_name)
            deck, created = import_deck(entry, data, editions, card_cache)
        except Exception as exc:  # um deck com problema não derruba a importação inteira
            result.failed.append((file_name, str(exc)))
            log(f"[{i}/{len(entries)}] ERRO {file_name}: {exc}")
            continue
        (result.created if created else result.updated).append(file_name)
        log(f"[{i}/{len(entries)}] {'novo' if created else 'atualizado'}: {deck}")

    return result
