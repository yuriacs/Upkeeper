"""
Leitura de listas coladas pelo usuário. Aceita os formatos mais comuns:

    1 Sol Ring                       texto simples
    1x Sol Ring (cmr) 472 [Ramp]     Archidekt ([Commander{top}] marca o comandante)
    1 Sol Ring (CMR) 472             Moxfield / MTG Arena (seções "Commander" e "Deck")
    Sol Ring                         sem quantidade = 1

Sem seção "Commander" nem marcação [Commander], vale o formato de export do Moxfield:
o primeiro bloco (antes da primeira linha em branco) traz o(s) comandante(s), 1 ou 2 cartas.
Se a lista não tiver esse bloco, a primeira carta é o comandante.

Linhas vazias, comentários (// ou #) e seções Sideboard/Maybeboard/Tokens são ignorados. O que fica
fora do deck também é reconhecido quando vem:
- como comentário ("//Sideboard", deckstats/MTGA) ou com "SB:" na frente da linha (MTGO);
- na categoria do Archidekt ([Sideboard], [Maybeboard], ou qualquer uma marcada {noDeck});
- num último bloco sem título que faz a lista passar de 100 cartas (export MTGO do Moxfield).
"""

import re
from dataclasses import dataclass
from django.utils.translation import gettext as _

SECTION_RE = re.compile(
    r"^(?P<section>commanders?|comandantes?|companion|deck|main(?:board)?|sideboard|maybeboard|considering|tokens?)"
    r"\s*:?\s*(?:\(\d+\))?$",
    re.IGNORECASE,
)
LINE_RE = re.compile(
    r"^(?:(?P<qty>\d+)\s*x?\s+)?"  # 1 / 1x / (nada)
    r"(?P<name>.+?)"
    r"(?:\s+\((?P<set>[A-Za-z0-9]{2,6})\)(?:\s+(?P<num>[^\s\[*^]+))?)?"  # (SET) 123
    r"(?P<flags>(?:\s*\*[A-Za-z]+\*)*)"  # *F* *CMDR*
    r"(?:\s*\[(?P<cats>[^\]]*)\])?"  # [Commander{top}]
    r"(?:\s*\^[^^]*\^)*\s*$"  # ^Tag^ do Archidekt
)
IGNORED_SECTIONS = {"sideboard", "maybeboard", "considering", "token", "tokens"}
COMMANDER_SECTIONS = {"commander", "commanders", "comandante", "comandantes"}
SB_PREFIX_RE = re.compile(r"^SB:\s*", re.IGNORECASE)
DECK_SIZE = 100
MAX_SIDEBOARD = 15


def _outside_deck(cats: str) -> bool:
    """Categorias do Archidekt que não entram no deck: "Sideboard", "Maybeboard{noDeck}"..."""
    if "{nodeck}" in cats:
        return True
    names = {re.sub(r"\{[^}]*\}", "", c).strip() for c in cats.split(",")}
    return bool(names & IGNORED_SECTIONS)

MAX_LINES = 300


@dataclass
class ParsedLine:
    line_no: int
    quantity: int
    name: str
    set_code: str | None
    collector_number: str | None
    is_commander: bool
    block: int = 0


class DecklistError(Exception):
    def __init__(self, message: str, details: list[str] | None = None):
        super().__init__(message)
        self.details = details or []


def parse_decklist(text: str) -> list[ParsedLine]:
    lines = text.splitlines()
    if len(lines) > MAX_LINES:
        raise DecklistError(_("The list has {n} lines; the limit is {max}.").format(n=len(lines), max=MAX_LINES))

    section = "deck"
    has_sections = False
    block = 0
    parsed: list[ParsedLine] = []
    bad: list[str] = []
    for i, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line:
            if parsed and parsed[-1].block == block:
                block += 1  # linha em branco separa blocos
            continue
        if line.startswith(("//", "#")):
            # "//Sideboard" (deckstats, MTGA): o comentário serve de título de seção
            header = SECTION_RE.match(line.lstrip("/#").strip())
            if header:
                section = header.group("section").lower()
                has_sections = True
            continue
        if SB_PREFIX_RE.match(line):
            continue
        header = SECTION_RE.match(line)
        if header:
            section = header.group("section").lower()
            has_sections = True
            continue
        if section in IGNORED_SECTIONS:
            continue
        m = LINE_RE.match(line)
        if not m or not m.group("name").strip():
            bad.append(_("Line {n}: {text}").format(n=i, text=line))
            continue
        cats = (m.group("cats") or "").lower()
        if _outside_deck(cats):
            continue
        flags = (m.group("flags") or "").upper()
        parsed.append(ParsedLine(
            line_no=i,
            quantity=int(m.group("qty") or 1),
            name=m.group("name").strip(),
            set_code=m.group("set"),
            collector_number=m.group("num"),
            is_commander=section in COMMANDER_SECTIONS or "commander" in cats or "*CMDR*" in flags,
            block=block,
        ))
    if bad:
        raise DecklistError(_("Some lines could not be read."), bad[:20])
    if not parsed:
        raise DecklistError(_("The list is empty."))
    if not has_sections:
        parsed = _drop_trailing_sideboard(parsed)
    if not has_sections and not any(p.is_commander for p in parsed):
        _infer_commanders(parsed)
    return parsed


def _drop_trailing_sideboard(parsed: list[ParsedLine]) -> list[ParsedLine]:
    """
    Lista sem títulos cujo último bloco faz passar de 100 cartas: esse bloco é o sideboard
    (formato MTGO: deck, linha em branco, sideboard). Só quando tirar o bloco deixa 100 ou menos.
    """
    blocks = sorted({p.block for p in parsed})
    if len(blocks) < 2:
        return parsed
    last = [p for p in parsed if p.block == blocks[-1]]
    rest = [p for p in parsed if p.block != blocks[-1]]
    total, extra = sum(p.quantity for p in parsed), sum(p.quantity for p in last)
    if total > DECK_SIZE and total - extra <= DECK_SIZE and extra <= MAX_SIDEBOARD and not any(p.is_commander for p in last):
        return rest
    return parsed


def _infer_commanders(parsed: list[ParsedLine]) -> None:
    """Formato Moxfield: 1–2 cartas no primeiro bloco = comandantes; senão, a primeira carta."""
    first_block = [p for p in parsed if p.block == parsed[0].block]
    rest = len(parsed) - len(first_block)
    if rest and len(first_block) <= 2 and all(p.quantity == 1 for p in first_block):
        for p in first_block:
            p.is_commander = True
    else:
        parsed[0].is_commander = True
