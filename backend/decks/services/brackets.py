"""
Bracket estimado de um deck (sistema oficial de brackets de Commander, da Wizards).

Quem classifica as cartas é o Commander Spellbook (commanderspellbook.com): para uma lista,
ele diz quais são Game Changers, quais destroem terrenos em massa, quais dão turnos extras
e quais combos de 2 cartas existem no deck. A partir disso aplicamos a tabela oficial:

    Bracket 2 (Core):      nenhum Game Changer, sem combos de 2 cartas, sem destruição em massa
    Bracket 3 (Upgraded):  até 3 Game Changers e/ou combos de 2 cartas (não antes do turno 6)
    Bracket 4 (Optimized): mais de 3 Game Changers, destruição de terrenos em massa,
                           turnos extras em sequência

O bracket 1 (Exhibition) e o 5 (cEDH) dependem da intenção de quem montou o deck, então não
dá para detectar pela lista: o resultado é sempre o bracket *mínimo* (2, 3 ou 4).
"""

import hashlib
import json
import logging
import urllib.error

from django.conf import settings
from django.utils import timezone

from .http import fetch_json

log = logging.getLogger(__name__)

MAX_GAME_CHANGERS_B3 = 3
EXTRA_TURN_CARDS_B4 = 3  # com 3+ cartas de turno extra dá para encadear turnos


def spellbook_estimate(commanders: list[str], main: list[tuple[str, int]]) -> dict:
    # Cartas de duas faces vão com o nome inteiro ("Tergrid, God of Fright // Tergrid's Lantern"):
    # só pelo nome da frente o Spellbook não reconhece a carta (e um Game Changer não contava)
    payload = {
        "commanders": [{"card": c} for c in commanders],
        "main": [{"card": n, "quantity": q} for n, q in main],
    }
    return fetch_json(f"{settings.COMMANDER_SPELLBOOK_URL}/estimate-bracket", data=payload, timeout=30)


def cached_estimate(commanders: list[str], main: list[tuple[str, int]]) -> dict:
    """spellbook_estimate guardado por 6 horas: o deckbuilder pergunta de novo a cada mudança."""
    from django.core.cache import cache

    raw = json.dumps([sorted(commanders), sorted(main)], ensure_ascii=False)
    key = "spellbook:" + hashlib.sha256(raw.encode()).hexdigest()
    result = cache.get(key)
    if result is None:
        result = spellbook_estimate(commanders, main)
        cache.set(key, result, 6 * 3600)
    return result


def classify(result: dict) -> tuple[int, dict]:
    """Resposta do Spellbook → (bracket mínimo, motivos)."""
    cards = result.get("cards") or []
    names = lambda flag: sorted({c["card"]["name"] for c in cards if c.get(flag)})  # noqa: E731
    game_changers = names("gameChanger")
    mass_land_denial = names("massLandDenial")
    extra_turns = names("extraTurn")
    banned = names("banned")

    combos, seen, turn_loops = [], set(), False
    for variant in result.get("combos") or []:
        if not variant.get("definitelyTwoCard"):
            continue
        pieces = sorted({u["card"]["name"] for u in variant.get("combo", {}).get("uses", [])})
        key = tuple(pieces)
        if len(pieces) == 2 and key not in seen:
            seen.add(key)
            combos.append(pieces)
            turn_loops = turn_loops or bool(variant.get("extraTurn"))

    bracket = 2
    if game_changers or combos:
        bracket = 3
    other_b4 = len(game_changers) > MAX_GAME_CHANGERS_B3 or len(extra_turns) >= EXTRA_TURN_CARDS_B4 or turn_loops
    if mass_land_denial or other_b4:
        bracket = 4
    # Só está no 4 por causa de UMA carta de destruição de terrenos (comum em precons):
    # o site avisa que a mesa pode combinar de jogar como 3 sem ela
    single_trigger = mass_land_denial[0] if len(mass_land_denial) == 1 and not other_b4 else None

    return bracket, {
        "single_trigger": single_trigger,
        "game_changers": game_changers,
        "mass_land_denial": mass_land_denial,
        "extra_turns": extra_turns,
        "two_card_combos": combos[:12],
        "banned": banned,
        "source": "Commander Spellbook",
    }


def refresh_bracket(deck, *, fetch=None) -> bool:
    """
    Calcula e grava o bracket de um precon (Deck) ou deck importado (UserDeck).
    Nunca levanta erro: se o Spellbook estiver fora, o deck fica sem bracket e tenta depois.
    """
    if fetch is None:
        if not settings.BRACKETS_ENABLED:
            return False
        fetch = spellbook_estimate
    rows = list(deck.deck_cards.select_related("card"))
    if not rows:
        return False
    commanders = [r.card.name for r in rows if r.is_commander]
    main = [(r.card.name, r.quantity) for r in rows if not r.is_commander]
    try:
        bracket, details = classify(fetch(commanders, main))
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError, OSError) as exc:
        log.warning("Bracket de %s não calculado: %s", deck, exc)
        return False
    deck.bracket = bracket
    deck.bracket_details = details
    deck.bracket_checked_at = timezone.now()
    deck.save(update_fields=["bracket", "bracket_details", "bracket_checked_at"])
    from .analysis import refresh_power

    refresh_power(deck)  # o nível de poder depende do bracket
    return True


def ensure_bracket(deck) -> None:
    """
    Deck aberto sem bracket (o Spellbook estava fora quando foi salvo, ou é novo): tenta
    calcular agora, no máximo uma vez a cada 30 minutos por deck.
    """
    if deck.bracket is not None or not settings.BRACKETS_ENABLED:
        return
    from django.core.cache import cache

    if cache.add(f"bracket-try:{deck._meta.label_lower}:{deck.pk}", 1, 1800):
        refresh_bracket(deck)
