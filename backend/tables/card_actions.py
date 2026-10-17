"""
Atalhos de carta: lê o texto oficial (oracle) e reconhece habilidades comuns que dá para fazer com
um clique, sem motor de regras. A mesa continua manual: o jogador escolhe usar o atalho, e o
servidor só executa o que o texto diz (buscar terreno e embaralhar, criar fichas, marcadores em
todas as suas criaturas, comprar, moer, vidência, drenar, ganhar vida, destruir tudo).

Cada carta guarda uma lista curta de atalhos ("acts") calculada ao carregar o deck. O que não
encaixa com certeza num modelo fica sem atalho: melhor nenhum botão que um botão errado.
"""

import re

WORDS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10,
}  # fmt: skip
NUM = r"(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)"
# Quantidade que depende do jogo (X, "that many"): o atalho pergunta ao jogador (n = 0)
ANY_N = rf"(?:{NUM}|X|that many|a number of)"
LAND_SUBTYPES = ("Plains", "Island", "Swamp", "Mountain", "Forest", "Desert", "Gate", "Cave", "Town", "Sphere")
CARD_TYPES = ("creature", "artifact", "enchantment", "instant", "sorcery", "planeswalker", "land", "battle")
MAX_ACTS = 4
MAX_N = 20


def _num(word: str) -> int | None:
    word = word.lower()
    n = int(word) if word.isdigit() else WORDS.get(word)
    return n if n is not None and 1 <= n <= MAX_N else None


def _abilities(text: str) -> list[str]:
    """Habilidades da frente da carta, uma por linha, sem os lembretes entre parênteses."""
    front = (text or "").split("\n//\n")[0]
    out = []
    for line in front.splitlines():
        line = re.sub(r"\([^)]*\)", "", line).strip()
        if line:
            out.append(line)
    return out


def _cost(line: str, name: str) -> dict:
    """Custo de uma habilidade ativada ("{T}, Pay 1 life, Sacrifice X: ..."): sacrificar, vida, virar."""
    cost, sep, _ = line.partition(":")
    if not sep or len(cost) > 120:
        return {}
    out = {}
    names = {name, name.split(",")[0]} if name else set()
    if re.search(r"Sacrifice (?:this \w+|it\b|~)", cost) or any(n and f"Sacrifice {n}" in cost for n in names):
        out["sac"] = True
    life = re.search(r"Pay (\d+) life", cost)
    if life:
        out["life"] = int(life.group(1))
    if "{T}" in cost:
        out["tap"] = True
    return out


_SEARCH = re.compile(
    rf"search your library for (?P<count>{NUM}|up to (?:one|two|three|four)) (?P<what>[^.]*?)cards?"
    r"(?: with different names)?(?P<rest>[^.]*(?:\.[^.]*?shuffle)?)",
    re.I,
)


def _search(line: str) -> dict | None:
    """'Search your library for ... card(s), put ... , then shuffle.'"""
    m = _SEARCH.search(line)
    if not m:
        return None
    count = m.group("count").lower()
    upto = count.startswith("up to")
    n = _num(count.split()[-1])
    if not n:
        return None
    what = m.group("what").strip()
    rest = m.group("rest").lower()
    # "basic land", "Forest or Plains", "Plains, Island, Swamp, or Mountain", "creature", "" (qualquer carta)
    if re.search(r"\b(?:with|named|that|mana value|power|toughness|of the chosen|from among|and/or)\b", what, re.I):
        return None
    words = re.sub(r"[,]|\bor\b|\band\b", " ", what).split()
    sub = [w for w in words if w in LAND_SUBTYPES]
    basic = any(w.lower() == "basic" for w in words)
    types = [w.lower() for w in words if w.lower() in CARD_TYPES]
    known = {w for w in words if w in LAND_SUBTYPES or w.lower() in CARD_TYPES or w.lower() == "basic"}
    if set(words) - known:
        return None  # algo que o modelo não entende ("legendary", "Equipment", "snow"...)
    if re.search(r"\bone(?: of them)? onto the battlefield", rest) and "other into your hand" in rest:
        to = ["field_tapped" if "battlefield tapped" in rest else "field", "hand"]
        if n != 2:
            return None
    elif "onto the battlefield" in rest:
        to = ["field_tapped" if "battlefield tapped" in rest else "field"]
    elif "into your hand" in rest:
        to = ["hand"]
    elif "on top of your library" in rest or "on top" in rest:
        to = ["top"]
    else:
        return None
    act = {"k": "search", "n": n, "to": to}
    if upto:
        act["upto"] = True
    if sub:
        act["sub"] = sub
    if basic:
        act["basic"] = True
    if types:
        act["types"] = types
    if "shuffle" not in rest:
        act["noshuffle"] = True
    return act


_TOKENS = re.compile(
    rf"\b[Cc]reate (?P<n>{ANY_N}) (?P<tapped>tapped )?(?:(?P<p>\d+)/(?P<t>\d+) )?"
    r"(?P<colors>(?:(?:white|blue|black|red|green|colorless)(?:,? and |, | ))*)"
    r"(?P<name>[A-Z][A-Za-z']*(?: [A-Z][A-Za-z']*)*) (?:(?:legendary |snow )?(?:artifact |enchantment )*(?:creature )?)?tokens?\b",
)
COLOR_CODE = {"white": "w", "blue": "u", "black": "b", "red": "r", "green": "g", "colorless": "c"}


def _tokens(line: str) -> dict | None:
    m = _TOKENS.search(line)
    if not m:
        return None
    word = m.group("n")
    n = _num(word) if word not in ("X", "that many", "a number of") else 0
    if n is None:
        return None
    if re.match(r"[^.]*? for each\b", line[m.end() :]):
        n = 0  # "for each land you control": quantos depende da mesa
    act = {"k": "tokens", "n": n, "name": m.group("name")}
    if m.group("p"):
        act["p"], act["t"] = m.group("p"), m.group("t")
    colors = "".join(COLOR_CODE[c] for c in re.findall(r"white|blue|black|red|green|colorless", m.group("colors")))
    if colors:
        act["c"] = colors
    if m.group("tapped"):
        act["tapped"] = True
    return act


def _simple(line: str) -> list[dict]:
    """Comprar, moer, vidência, marcadores em todas as suas criaturas, drenar, ganhar vida, destruir tudo."""
    out = []
    low = line.lower()
    m = re.search(rf"put (?P<n>{NUM}) \+1/\+1 counters? on each (?P<other>other )?creature you control", low)
    if m and _num(m.group("n")):
        act = {"k": "counters", "n": _num(m.group("n"))}
        if m.group("other"):
            act["other"] = True
        out.append(act)
    # Só você compra ("draw two cards", "you draw a card"); "each player draws" mexe na mão dos outros
    m = re.search(rf"(?:^|[.:,] |\bthen |\band )(?:you )?draws? (?P<n>a card|{NUM} cards)\b", low)
    if m and not re.search(r"(?:each|target|that) (?:player|opponent)s? (?:\w+ )?draws?", low):
        n = 1 if m.group("n") == "a card" else _num(m.group("n").split()[0])
        if n:
            out.append({"k": "draw", "n": n})
    m = re.search(rf"(?:^|[.:,] |\bthen |\band |\byou )mill (?P<n>{NUM}) cards?", low)
    if m and _num(m.group("n")):
        out.append({"k": "mill", "n": _num(m.group("n"))})
    m = re.search(r"\b(?P<k>scry|surveil) (?P<n>\d+)", low)
    if m and _num(m.group("n")):
        out.append({"k": m.group("k"), "n": _num(m.group("n"))})
    m = re.search(rf"each opponent loses (?P<n>{NUM}) life", low)
    if m and _num(m.group("n")):
        act = {"k": "drain", "n": _num(m.group("n"))}
        gain = re.search(rf"you gain (?P<g>{NUM}) life", low)
        if gain and _num(gain.group("g")):
            act["gain"] = _num(gain.group("g"))
        elif "you gain life equal to the life lost" in low:
            act["gain_lost"] = True
        out.append(act)
    else:
        m = re.search(rf"\byou gain (?P<n>{NUM}) life", low)
        if m and _num(m.group("n")):
            out.append({"k": "gain", "n": _num(m.group("n"))})
    m = re.search(
        r"\b(?P<how>destroy|exile) all (?P<other>other )?(?P<what>creatures|artifacts and enchantments|artifacts|enchantments|nonland permanents)\b",
        low,
    )
    if m and "you control" not in low[m.end() : m.end() + 20]:
        what = {
            "creatures": ["creature"],
            "artifacts": ["artifact"],
            "enchantments": ["enchantment"],
            "artifacts and enchantments": ["artifact", "enchantment"],
            "nonland permanents": ["nonland"],
        }[m.group("what")]
        act = {"k": "wipe", "to": "exile" if m.group("how") == "exile" else "graveyard", "what": what}
        if m.group("other"):
            act["other"] = True
        out.append(act)
    return out


KEYWORDS = {
    "search": ("search",), "tokens": ("create",), "counters": ("+1/+1 counter",), "draw": ("draw",),
    "mill": ("mill",), "scry": ("scry",), "surveil": ("surveil",), "drain": ("loses",), "gain": ("gain",),
    "wipe": ("destroy all", "exile all"),
}  # fmt: skip


def parse(name: str, type_line: str, oracle_text: str) -> list[dict]:
    """Atalhos de uma carta, na ordem em que aparecem no texto (no máximo MAX_ACTS)."""
    if not oracle_text or "Basic Land" in (type_line or ""):
        return []
    acts: list[dict] = []
    for line in _abilities(oracle_text):
        found = []
        search = _search(line)
        if search:
            found.append(search)
        tokens = _tokens(line)
        if tokens:
            found.append(tokens)
        if not search:  # o resto de uma linha de busca ("then shuffle") não vira outro atalho
            found.extend(_simple(line))
        # Na ordem do texto (Preordain: vidência, depois comprar)
        low = line.lower()
        found.sort(key=lambda a: min((i for i in (low.find(w) for w in KEYWORDS[a["k"]]) if i >= 0), default=0))
        cost = _cost(line, name)
        for act in found:
            act.update(cost)
            if act not in acts:
                acts.append(act)
    return acts[:MAX_ACTS]
