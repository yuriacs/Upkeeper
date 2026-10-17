"""
Análise de um deck: o que tem nele (tutores, ramp, compra, remoção...) e um nível de poder
estimado de 1 a 10.

- A função de cada carta vem das tags do Scryfall (tabela OracleTag, `manage.py sync_card_tags`).
- Mana rápida é uma lista curta e conhecida, mantida aqui.
- O nível de poder é uma fórmula nossa e transparente: cada fator vira uma nota de 0 a 1, as
  notas são somadas com pesos (0 a 1 no total) e viram uma escala de 1,5 a 8. O bracket soma
  um bônus pequeno (Game Changers e combos já pesam nos fatores). Um deck no bracket 4 só por
  uma carta de destruição de terrenos ganha o bônus do 3, para um precon não virar "otimizado".
"""

from collections import defaultdict

from ..models import OracleTag

# Tag interna → busca no Scryfall (só cartas legais em Commander)
TAG_QUERIES = {
    "tutor": "otag:tutor -otag:tutor-land",  # busca de terreno é ramp, não tutor
    "ramp": "otag:ramp",
    "draw": "otag:draw",
    "removal": "otag:removal",
    "board_wipe": "otag:board-wipe",
    "counterspell": "otag:counterspell",
    "protection": "otag:protection",
    "recursion": "otag:recursion",  # só para agrupar no deckbuilder; não entra no nível de poder
}

# Mana que acelera muito o começo do jogo (aceleração de 0 ou 1 mana, ou que gera mais do que custa)
FAST_MANA = {
    "Sol Ring", "Mana Crypt", "Mana Vault", "Grim Monolith", "Basalt Monolith", "Chrome Mox", "Mox Diamond",
    "Mox Opal", "Mox Amber", "Mox Tantalite", "Lotus Petal", "Jeweled Lotus", "Lion's Eye Diamond", "Lotus Bloom",
    "Dark Ritual", "Cabal Ritual", "Culling the Weak", "Rite of Flame", "Simian Spirit Guide",
    "Elvish Spirit Guide", "Ancient Tomb", "Gemstone Caverns", "Springleaf Drum", "Utopia Sprawl", "Wild Growth",
}

BASE, SPAN = 1.5, 6.5  # nota 0 → 1,5; nota 1 → 8,0
BRACKET_BONUS = {2: 0.0, 3: 0.5, 4: 1.5}

# Rótulos em inglês: o frontend traduz
LABELS = [(4.0, "Casual"), (6.0, "Upper casual"), (7.5, "Focused"), (9.0, "Optimized"), (99, "Competitive")]


def _lin(value: float, low: float, high: float) -> float:
    """0 em `low`, 1 em `high`, linear no meio (funciona com low > high para "menor é melhor")."""
    if high == low:
        return 1.0
    return max(0.0, min(1.0, (value - low) / (high - low)))


def display_name(name: str) -> str:
    """"Okaun // Okaun" (cartas com o mesmo nome dos dois lados) vira só "Okaun"."""
    faces = name.split(" // ")
    return faces[0] if len(set(faces)) == 1 else name


def label_for(power: float) -> str:
    return next(name for limit, name in LABELS if power < limit)


def tags_for(oracle_ids) -> dict:
    found = defaultdict(set)
    for oid, tag in OracleTag.objects.filter(oracle_id__in=set(oracle_ids)).values_list("oracle_id", "tag"):
        found[oid].add(tag)
    return found


def analyze(rows, bracket: int | None, bracket_details: dict | None = None) -> dict:
    """
    `rows`: objetos com .card, .quantity e .is_commander (DeckCard ou UserDeckCard).
    Devolve as categorias (com as cartas), os fatores do nível de poder e o nível final.
    """
    rows = list(rows)
    tags = tags_for(r.card.oracle_id for r in rows if r.card.oracle_id)
    details = bracket_details or {}

    categories: dict[str, dict] = {
        key: {"count": 0, "cards": []}
        for key in ["fast_mana", "ramp", "draw", "tutor", "removal", "board_wipe", "counterspell", "protection"]
    }
    lands = 0
    cmc_total = 0.0
    spells = 0
    for r in rows:
        card = r.card
        is_land = card.category == "land"
        if is_land:
            lands += r.quantity
        else:
            cmc_total += float(card.cmc) * r.quantity
            spells += r.quantity
        card_tags = set(tags.get(card.oracle_id, ()))
        if card.name.split(" // ")[0] in FAST_MANA:
            card_tags.add("fast_mana")
        if "board_wipe" in card_tags:
            card_tags.discard("removal")  # remoção = pontual; board wipe conta à parte
        if is_land:
            # Terrenos só contam como mana rápida (Ancient Tomb...), não como ramp/compra
            card_tags &= {"fast_mana"}
        for tag in card_tags:
            if tag in categories:
                categories[tag]["count"] += r.quantity
                categories[tag]["cards"].append(display_name(card.name))
    for cat in categories.values():
        cat["cards"].sort()

    count = lambda key: categories[key]["count"]  # noqa: E731
    avg_cmc = round(cmc_total / spells, 2) if spells else 0.0
    game_changers = len(details.get("game_changers") or [])
    combos = len(details.get("two_card_combos") or [])
    interaction = count("removal") + count("board_wipe") + count("counterspell")

    # Fatores: (chave, valor mostrado, nota 0..1, peso)
    factors = [
        ("speed", avg_cmc, _lin(avg_cmc, 4.2, 2.4), 0.20),
        ("ramp", count("ramp") + count("fast_mana"), _lin(count("ramp") + 2 * count("fast_mana"), 6, 22), 0.20),
        ("draw", count("draw"), _lin(count("draw"), 5, 18), 0.15),
        ("tutor", count("tutor"), _lin(count("tutor"), 0, 8), 0.15),
        ("interaction", interaction, _lin(interaction, 6, 22), 0.15),
        ("protection", count("protection"), _lin(count("protection"), 0, 6), 0.05),
        ("combos", game_changers + combos, min(1.0, 0.25 * game_changers + 0.5 * combos), 0.10),
    ]
    score = sum(s * w for _, _, s, w in factors)

    bonus = BRACKET_BONUS.get(bracket or 2, 0.0)
    if bracket == 4 and details.get("single_trigger"):
        bonus = BRACKET_BONUS[3]
    power = round(min(10.0, BASE + score * SPAN + bonus), 1)
    return {
        "power": power,
        "label": label_for(power),
        "base": BASE,
        "bracket_bonus": bonus,
        "score": round(score, 3),
        "factors": [
            {"key": k, "value": v, "score": round(s, 2), "weight": w, "points": round(s * w * SPAN, 2)}
            for k, v, s, w in factors
        ],
        "categories": categories,
        "lands": lands,
        "avg_cmc": avg_cmc,
    }


def refresh_power(deck) -> float:
    """Recalcula e grava o nível de poder de um precon ou deck importado."""
    rows = deck.deck_cards.select_related("card")
    deck.power = analyze(rows, deck.bracket, deck.bracket_details)["power"]
    deck.save(update_fields=["power"])
    return deck.power
