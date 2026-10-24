"""
Atalhos de carta: lê o texto oficial (oracle) e reconhece habilidades comuns que dá para fazer com
um clique, sem motor de regras. A mesa continua manual: o jogador escolhe usar o atalho, e o
servidor só executa o que o texto diz (buscar terreno e embaralhar, criar fichas, marcadores em
todas as suas criaturas, comprar, moer, vidência, drenar, ganhar vida, destruir tudo, destruir ou
exilar um alvo, devolver do cemitério, olhar o topo).

Cada carta guarda uma lista curta de atalhos ("acts") calculada ao carregar o deck. O que não
encaixa com certeza num modelo fica sem atalho: melhor nenhum botão que um botão errado.

Também daqui: se a carta entra virada ("This land enters tapped.") e os gatilhos de manutenção,
combate e etapa final, que a mesa mostra como lembrete na hora certa (sem executar nada).
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
    """
    Habilidades da frente da carta, uma por linha, sem os lembretes entre parênteses e sem o que
    vem entre aspas (habilidade dada a outra coisa: 'tokens with "When this token dies..."').
    """
    front = (text or "").split("\n//\n")[0]
    out = []
    for line in front.splitlines():
        line = re.sub(r"\([^)]*\)|\"[^\"]*\"", "", line).strip()
        if line:
            out.append(line)
    return out


# Alvos que o atalho entende ("target artifact or enchantment"): tipos de carta, "nonland" e "permanent"
TARGET_WHAT = {
    "creature": ["creature"], "artifact": ["artifact"], "enchantment": ["enchantment"], "land": ["land"],
    "planeswalker": ["planeswalker"], "permanent": ["permanent"], "nonland permanent": ["nonland"],
    "artifact or enchantment": ["artifact", "enchantment"], "creature or planeswalker": ["creature", "planeswalker"],
    "artifact or creature": ["artifact", "creature"], "creature or enchantment": ["creature", "enchantment"],
    "artifact, enchantment, or planeswalker": ["artifact", "enchantment", "planeswalker"],
    "artifact, creature, or enchantment": ["artifact", "creature", "enchantment"],
}  # fmt: skip
TARGET_CTL = {"": None, " an opponent controls": "opp", " you don't control": "opp", " you control": "you"}
# O que pode vir depois do alvo sem mudar o efeito ("Exile target creature. Its controller gains...")
_TAIL = re.compile(r"(?:$|,? then\b|,? and (?!target|each|all|up to))")


def _target_of(rest: str) -> tuple[list[str], str | None] | None:
    """'artifact or enchantment an opponent controls' → (["artifact", "enchantment"], "opp")."""
    # Quem escolhe o alvo é o jogador: "nonblack", "attacking", "tapped" só restringem a escolha
    rest = re.sub(r"^(?:(?:non(?!land permanent)\w+|attacking|blocking|tapped|untapped|attacking or blocking),? )+", "", rest)
    for what in sorted(TARGET_WHAT, key=len, reverse=True):
        if not rest.startswith(what):
            continue
        tail = rest[len(what) :]
        for ctl in sorted(TARGET_CTL, key=len, reverse=True):
            if tail.startswith(ctl) and _TAIL.match(tail[len(ctl) :]):
                return TARGET_WHAT[what], TARGET_CTL[ctl]
        return None
    return None


_TARGET_DO = re.compile(r"\b(?P<do>destroy|exile|tap|untap) (?:up to one )?target (?P<rest>[^.;]*)")
_BOUNCE = re.compile(r"\breturn (?:up to one )?target (?P<rest>[^.;]*?) to its owner's hand(?P<after>[^.;]*)")
_TARGET_COUNTERS = re.compile(
    rf"\bput (?P<n>{NUM}|x) (?P<c>\+1/\+1|-1/-1) counters? on (?:up to one )?target (?P<rest>[^.;]*)"
)
_DAMAGE = re.compile(
    r"\bdeals? (?P<n>\d+|x) damage to (?P<to>any target|each opponent|target (?:player|opponent)(?: or planeswalker)?)"
    r"(?P<after>[^.;]*)"
)


def _with_ctl(act: dict, ctl: str | None) -> dict:
    if ctl:
        act["ctl"] = ctl
    return act


def _targeted(line: str) -> list[dict]:
    """Efeitos num alvo: destruir, exilar, devolver à mão, virar, desvirar, marcadores, dano a um jogador."""
    out = []
    low = line.lower()
    for m in _TARGET_DO.finditer(low):
        found = _target_of(m.group("rest"))
        # "Exile target creature. Return it to the battlefield...": a carta volta, não é exilar
        if m.group("do") == "exile" and re.search(r"\breturn (?:it|that card|them|those cards)\b", low[m.end() :]):
            continue
        if found:
            out.append(_with_ctl({"k": "target", "do": m.group("do"), "what": found[0]}, found[1]))
    m = _BOUNCE.search(low)
    if m and not m.group("after").strip():
        found = _target_of(m.group("rest"))
        if found:
            out.append(_with_ctl({"k": "target", "do": "bounce", "what": found[0]}, found[1]))
    m = _TARGET_COUNTERS.search(low)
    if m:
        found = _target_of(m.group("rest"))
        n = 0 if m.group("n") == "x" else _num(m.group("n"))
        if found and n is not None:
            act = {"k": "target", "do": "counters", "what": found[0], "n": n, "c": m.group("c")}
            out.append(_with_ctl(act, found[1]))
    m = _DAMAGE.search(low)
    # "deals 2 damage to any target and 2 damage to you": o resto da frase fica para o jogador
    if m and not re.search(r"\bdamage\b", m.group("after")):
        # "for each creature card in your graveyard": quanto depende da mesa, o jogador diz
        n = 0 if m.group("n") == "x" or m.group("after").startswith(" for each") else _num(m.group("n"))
        if n is not None:
            # A cada oponente é igual a perder vida (drenar sem ganhar); num alvo, o jogador escolhe quem
            out.append({"k": "drain", "n": n} if m.group("to") == "each opponent" else {"k": "damage", "n": n})
    return out


_REGROW = re.compile(
    r"\breturn (?P<count>target|up to (?:one|two|three) target) (?P<what>[a-z ]*?)cards? from your graveyard "
    r"to (?P<to>your hand|the battlefield)(?P<tapped> tapped)?(?P<after>[^.;]*)"
)
REGROW_WHAT = {
    "": [], "creature": ["creature"], "artifact": ["artifact"], "enchantment": ["enchantment"], "land": ["land"],
    "permanent": ["permanent"], "instant or sorcery": ["instant", "sorcery"], "creature or land": ["creature", "land"],
    "artifact or enchantment": ["artifact", "enchantment"], "artifact or creature": ["artifact", "creature"],
    "nonland permanent": ["nonland"],
}  # fmt: skip


def _regrow(line: str) -> dict | None:
    """'Return target creature card from your graveyard to your hand' (o jogador escolhe no cemitério)."""
    m = _REGROW.search(line.lower())
    if not m or m.group("after").strip() not in ("", "under your control"):
        return None
    what = m.group("what").strip()
    if what not in REGROW_WHAT:
        return None
    count = m.group("count")
    n = 1 if count == "target" else _num(count.split()[2])
    if not n:
        return None
    to = "hand" if m.group("to") == "your hand" else "field_tapped" if m.group("tapped") else "field"
    act = {"k": "regrow", "n": n, "to": to}
    if REGROW_WHAT[what]:
        act["types"] = REGROW_WHAT[what]
    if count != "target":
        act["upto"] = True
    return act


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
    else:
        # "Target player draws two cards" (Sign in Blood): quase sempre é você; o atalho compra para quem usa
        m = re.search(rf"(?:^|[.:,] |\bthen |\band )target player draws (?P<n>a card|{NUM} cards)\b", low)
        if m and "each player" not in low:
            n = 1 if m.group("n") == "a card" else _num(m.group("n").split()[0])
            if n:
                out.append({"k": "draw", "n": n})
    m = re.search(r"\binvestigate(?P<twice> twice)?\b", low)
    if m:
        out.append({"k": "tokens", "n": 2 if m.group("twice") else 1, "name": "Clue"})
    m = re.search(rf"\blook at the top (?P<n>{NUM}) cards? of your library", low)
    if m and _num(m.group("n")):
        out.append({"k": "look", "n": _num(m.group("n"))})
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
    "search": ("search",), "tokens": ("create", "investigate"), "counters": ("+1/+1 counter",), "draw": ("draw",),
    "mill": ("mill",), "scry": ("scry",), "surveil": ("surveil",), "drain": ("loses", "damage"), "gain": ("gain",),
    "wipe": ("destroy all", "exile all"), "look": ("look at",), "regrow": ("from your graveyard",),
    "damage": ("damage",), "target": ("target",),
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
            regrow = _regrow(line)
            if regrow:
                found.append(regrow)
            else:  # "return target card from your graveyard" não é devolver um alvo do campo
                found.extend(_targeted(line))
            simple = _simple(line)
            if any(a["k"] == "drain" for a in found):  # dano a cada oponente já virou "drenar"
                simple = [a for a in simple if a["k"] != "drain"]
            found.extend(simple)
        # Na ordem do texto (Preordain: vidência, depois comprar)
        low = line.lower()
        found.sort(key=lambda a: min((i for i in (low.find(w) for w in KEYWORDS[a["k"]]) if i >= 0), default=0))
        cost = _cost(line, name)
        for act in found:
            act.update(cost)
            if line.startswith(("•", "+ {")):
                act["mode"] = True  # um modo de "Choose one —" (ou de Spree): usar qualquer um gasta a mágica
            if act not in acts:
                acts.append(act)
    return acts[:MAX_ACTS]


_ENTERS_TAPPED = re.compile(r"(?:This (?:land|artifact|creature|permanent|enchantment)|~) enters(?: the battlefield)? tapped\.")


def enters_tapped(name: str, oracle_text: str) -> bool:
    """'This land enters tapped.' sem condição (nada de "unless you control...")."""
    for line in _abilities(oracle_text):
        if name:
            line = line.replace(name, "~")
        if _ENTERS_TAPPED.fullmatch(line):
            return True
    return False


# Gatilhos lembrados pela mesa: (começo da habilidade, quando, em que turno)
TRIGGERS = (
    ("at the beginning of your upkeep", "upkeep", "you"),
    ("at the beginning of each opponent's upkeep", "upkeep", "opp"),
    ("at the beginning of each upkeep", "upkeep", "each"),
    ("at the beginning of each player's upkeep", "upkeep", "each"),
    ("at the beginning of combat on your turn", "combat", "you"),
    ("at the beginning of each combat", "combat", "each"),
    ("at the beginning of your end step", "end", "you"),
    ("at the beginning of each opponent's end step", "end", "opp"),
    ("at the beginning of each end step", "end", "each"),
    ("at the beginning of each player's end step", "end", "each"),
    ("at the beginning of the end step", "end", "each"),
)
MAX_TRIGGERS = 3
MAX_TRIGGER_TEXT = 240


def triggers(oracle_text: str) -> list[dict]:
    """Gatilhos de manutenção, combate e etapa final: {"w": "upkeep", "who": "you", "text": a habilidade}."""
    out = []
    for line in _abilities(oracle_text):
        # Palavra de habilidade antes do travessão ("Raid — At the beginning of...") não muda o gatilho
        body = re.sub(r"^[A-Z][\w' ]{0,30} — ", "", line)
        low = body.lower()
        for start, when, who in TRIGGERS:
            if low.startswith(start):
                text = body if len(body) <= MAX_TRIGGER_TEXT else body[: MAX_TRIGGER_TEXT - 1] + "…"
                out.append({"w": when, "who": who, "text": text})
                break
    return out[:MAX_TRIGGERS]
