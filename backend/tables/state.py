"""
Estado das mesas virtuais (Fase 1 do roadmap).

Cada mesa é um dicionário simples (vira JSON para salvar no Postgres a cada ação, ver
tables/store.py). Ele fica na memória do processo: no Render gratuito roda um processo só,
então todas as conexões de uma mesa caem no mesmo lugar e não precisa de Redis.

Tudo aqui é síncrono e roda no loop de eventos sem `await` no meio: cada ação é atômica.

O servidor não conhece as regras do Magic. Ele só garante que cada jogador mexe nas próprias
cartas e que ninguém vê o que não deve (mão, grimório e pilha virada dos outros).
"""

import os
import re
import secrets
import time

MAX_SEATS = 4
STARTING_LIFE = 40
LIFE_LIMIT = 999
# Mesa sem nenhuma alteração por 10 minutos é fechada (tables/closer.py); a variável serve para testar
IDLE_CLOSE = int(os.environ.get("TABLE_IDLE_CLOSE", "600"))
LOG_SIZE = 150
CODE_RE = re.compile(r"^[A-Z0-9]{4,12}$")

ZONES = ("library", "hand", "battlefield", "graveyard", "exile", "command", "facedown")
COUNTER_RE = re.compile(r"^[\w+\-/ ]{1,16}$")
MAX_DIE = 1000  # dados de 2 a 1000 lados (d2 é a moeda; "d?" é o dado personalizado)
TOKEN_IMAGE_PREFIX = "https://cards.scryfall.io/"
MAX_TOKENS = 200
CHAT_MAX = 300
SHAKE_COOLDOWN = 0.5  # segundos entre duas sacudidas (ou setas de alvo) do mesmo jogador
NOTE_MAX = 40
# Símbolos que dá para pôr numa carta do campo (o desenho de cada um fica no cliente)
SYMBOLS = {"attack", "block", "sick", "target", "star", "skull", "shield", "flame"}
PUBLIC_ZONES = {"battlefield", "graveyard", "exile", "command"}
PRIVATE_ZONES = {"hand", "facedown"}  # o dono vê, os outros só a quantidade
HAND_SIZE = 7

_random = secrets.SystemRandom()


class TableFull(Exception):
    pass


class ActionError(Exception):
    """Ação inválida: o consumer devolve o código ao cliente e nada muda."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def valid_code(code: str) -> bool:
    return bool(CODE_RE.match(code))


def new_table(code: str, dealt: list | None = None) -> dict:
    """`dealt`: decks de um sorteio ("Jogar agora"), para cada jogador pegar o seu."""
    return {
        "code": code,
        "next_id": 1,
        "seq": 0,
        "seats": {},
        "log": [],
        "dealt": dealt or [],
        "turn": {"player": None, "number": 0},  # de quem é o turno (user_id) e o número do turno
        "result": None,  # partida encerrada: {"winner": user_id | None, "winner_name", "by", "turn"}
    }


def new_seat(user_id: int, name: str, number: int) -> dict:
    return {
        "user_id": user_id,
        "name": name,
        "seat": number,
        "life": STARTING_LIFE,
        "poison": 0,
        "cmd_damage": {},  # dano de comandante recebido, por user_id de quem causou
        "tax": {},  # imposto de comandante: vezes que cada comandante foi conjurado
        "deck": None,
        "cards": {},
        "zones": empty_zones(),
        # Começo da partida (mão inicial e mulligan) até o jogador passar o primeiro turno
        "opening": True,
    }


def empty_zones() -> dict:
    return {z: [] for z in ZONES}


class Table:
    """Envolve o dicionário da mesa com as ações. `online` (conexões abertas) não é salvo."""

    def __init__(self, data: dict):
        self.data = data
        self.online: dict[int, int] = {}
        self._shaken: dict[int, float] = {}  # última sacudida de cada jogador (não é salvo)
        # Mesas salvas por versões anteriores: completa os campos novos
        data.setdefault("dealt", [])
        data.setdefault("turn", {"player": None, "number": 0})
        data.setdefault("result", None)
        data.setdefault("seq", len(data["log"]))
        for seat in data["seats"].values():
            for key, default in (("poison", 0), ("cmd_damage", {}), ("tax", {})):
                seat.setdefault(key, default)
            seat.setdefault("opening", data["turn"]["number"] == 0)
            if seat["zones"]["command"]:
                seat["zones"]["battlefield"].extend(_commanders_on_field(seat["zones"]["command"], seat["cards"]))
                seat["zones"]["command"] = []
            for item in seat["zones"]["battlefield"]:
                item.setdefault("counters", {})
                item.setdefault("stats", None)
        data.setdefault("changed_at", time.time())

    # ---- inatividade ---------------------------------------------------------------------

    def mark_changed(self) -> None:
        """Alguém mexeu na mesa: o prazo de 10 minutos recomeça (relógio de parede, sobrevive a reinícios)."""
        self.data["changed_at"] = time.time()

    def idle_left(self, now: float | None = None) -> int:
        """Segundos até a mesa ser fechada por inatividade."""
        now = now if now is not None else time.time()
        return max(0, int(IDLE_CLOSE - (now - self.data["changed_at"])))

    def expired(self, now: float | None = None) -> bool:
        return self.data.get("closed", False) or self.idle_left(now) <= 0

    # ---- consulta ------------------------------------------------------------------------

    @property
    def code(self) -> str:
        return self.data["code"]

    def seat_of(self, user_id: int) -> dict | None:
        return self.data["seats"].get(str(user_id))

    def is_online(self) -> bool:
        return any(self.online.values())

    def _require(self, user_id: int) -> dict:
        seat = self.seat_of(user_id)
        if seat is None:
            raise ActionError("not_seated")
        return seat

    def _find(self, seat: dict, card_id: str) -> tuple[str, int]:
        """Zona e posição de uma carta do jogador. Levanta ActionError se não for dele."""
        if card_id not in seat["cards"]:
            raise ActionError("not_your_card")
        for zone, items in seat["zones"].items():
            for i, item in enumerate(items):
                if (item["id"] if zone == "battlefield" else item) == card_id:
                    return zone, i
        raise ActionError("card_missing")

    def _owner_of(self, card_id: str) -> dict | None:
        return next((s for s in self.data["seats"].values() if card_id in s["cards"]), None)

    def _on_field(self, card_id: str) -> tuple[dict, dict]:
        """
        Carta no campo de qualquer jogador: (dono, item). Ações no campo valem para qualquer
        carta, sua ou de um oponente, como numa mesa de verdade; o log diz quem fez.
        """
        owner = self._owner_of(card_id) if isinstance(card_id, str) else None
        if owner is not None:
            for item in owner["zones"]["battlefield"]:
                if item["id"] == card_id:
                    return owner, item
        raise ActionError("not_on_battlefield")

    def _field_log(self, seat: dict, kind: str, owner: dict, item: dict, **extra) -> None:
        """Registro de uma ação numa carta do campo: o nome some se ela está virada para baixo."""
        name = None if item.get("face_down") else owner["cards"][item["id"]]["name"]
        mine = owner is seat
        self._log(seat, kind, card=name, owner=None if mine else owner["name"], **extra)

    def _release_control(self, user_id: int) -> None:
        """Cartas de outros jogadores controladas por esta conta voltam ao dono."""
        for s in self.data["seats"].values():
            for item in s["zones"]["battlefield"]:
                if item.get("controller") == user_id:
                    item["controller"] = None

    def _detach_from(self, host: dict) -> None:
        """A carta saiu do campo: o que estava preso nela fica solto no mesmo lugar."""
        for s in self.data["seats"].values():
            for item in s["zones"]["battlefield"]:
                if item.get("attached_to") == host["id"]:
                    item["attached_to"] = None
                    item["x"], item["y"] = host["x"], host["y"]

    def _log(self, seat: dict, kind: str, **extra) -> None:
        self.data["seq"] += 1
        entry = {"id": self.data["seq"], "kind": kind, "who": seat["name"], "seat": seat["seat"], **extra}
        log = self.data["log"]
        log.append(entry)
        del log[:-LOG_SIZE]

    def _card_name(self, seat: dict, card_id: str) -> str:
        return seat["cards"][card_id]["name"]

    # ---- jogadores -----------------------------------------------------------------------

    def join(self, user_id: int, name: str) -> dict:
        seats = self.data["seats"]
        seat = seats.get(str(user_id))
        if seat is None:
            taken = {s["seat"] for s in seats.values()}
            free = [n for n in range(1, MAX_SEATS + 1) if n not in taken]
            if not free:
                raise TableFull
            seat = seats[str(user_id)] = new_seat(user_id, name, free[0])
            self._log(seat, "joined")
            self.mark_changed()
        self.online[user_id] = self.online.get(user_id, 0) + 1
        return seat

    def leave(self, user_id: int) -> None:
        if user_id in self.online:
            self.online[user_id] = max(0, self.online[user_id] - 1)

    # ---- ações ---------------------------------------------------------------------------

    def load_deck(self, user_id: int, deck: dict, rows: list[dict]) -> None:
        """
        Troca o deck do jogador. `rows`: [{"name", "image", "back", "quantity", "is_commander"}].
        Comandantes já entram no campo, no canto de cima à direita; o resto é embaralhado no grimório.
        """
        seat = self._require(user_id)
        cards, zones, commanders = {}, empty_zones(), []
        for row in rows:
            for _ in range(row["quantity"]):
                cid = self._new_id()
                cards[cid] = {
                    "name": row["name"],
                    "image": row["image"],
                    "back": row.get("back", ""),
                    "commander": bool(row["is_commander"]),
                    "power": row.get("power", ""),
                    "toughness": row.get("toughness", ""),
                    "loyalty": row.get("loyalty", ""),
                }
                (commanders if row["is_commander"] else zones["library"]).append(cid)
        _random.shuffle(zones["library"])
        zones["battlefield"] = _commanders_on_field(commanders, cards)
        seat.update(
            cards=cards, zones=zones, deck=deck, life=STARTING_LIFE, poison=0, cmd_damage={}, tax={}, opening=True
        )
        self._release_control(user_id)
        self._log(seat, "deck", deck=deck["name"], n=len(cards))

    def draw(self, user_id: int, n: int = 1) -> None:
        seat = self._require(user_id)
        if not 1 <= n <= 20:
            raise ActionError("bad_amount")
        library, hand = seat["zones"]["library"], seat["zones"]["hand"]
        drawn = library[:n]
        if not drawn:
            raise ActionError("library_empty")
        del library[: len(drawn)]
        hand.extend(drawn)
        self._log(seat, "draw", n=len(drawn))

    def move(self, user_id: int, card_id: str, to: str, x=None, y=None, position: str = "top") -> None:
        """
        Move uma carta. Da mão, do grimório e das pilhas só o dono mexe; do campo qualquer jogador
        manda para as zonas do dono (destruir, exilar, devolver à mão...). Arrastar no campo é de
        quem controla a carta.
        """
        actor = self._require(user_id)
        if to not in ZONES:
            raise ActionError("bad_zone")
        seat = self._owner_of(card_id) if isinstance(card_id, str) else None
        if seat is None:
            raise ActionError("not_your_card")
        frm, idx = self._find(seat, card_id)
        if frm != "battlefield" and seat is not actor:
            raise ActionError("not_your_card")
        zones = seat["zones"]
        if frm == "battlefield" and to == "battlefield":
            # Só reposiciona no campo (arrastar a carta); arrastar uma carta presa solta ela
            item = zones["battlefield"][idx]
            if user_id not in (seat["user_id"], item.get("controller")):
                raise ActionError("not_your_card")
            if item.get("locked"):
                raise ActionError("locked")
            item["x"], item["y"] = _clamp01(x, item["x"]), _clamp01(y, item["y"])
            item["attached_to"] = None
            return
        left = zones[frm].pop(idx)
        hidden = frm == "battlefield" and left.get("face_down")
        if frm == "battlefield":
            self._detach_from(left)
        card = seat["cards"][card_id]
        other = None if seat is actor else seat["name"]
        if card.get("token"):
            # Ficha que sai do campo deixa de existir
            del seat["cards"][card_id]
            self._log(actor, "token_gone", card=card["name"], owner=other)
            return
        if to == "battlefield":
            zones["battlefield"].append(_field_item(card_id, _clamp01(x, 0.5), _clamp01(y, 0.5), card))
        elif to == "library":
            if position == "bottom":
                zones["library"].append(card_id)
            else:
                zones["library"].insert(0, card_id)
        else:
            zones[to].append(card_id)
        # O nome só vai para o log se a carta saiu ou entrou numa zona que todos veem
        public = (frm in PUBLIC_ZONES and not hidden) or to in PUBLIC_ZONES
        self._log(
            actor,
            "move",
            card=self._card_name(seat, card_id) if public else None,
            frm=frm,
            to=to,
            position=position if to == "library" else None,
            owner=other,
        )

    def tap(self, user_id: int, card_id: str) -> None:
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        item["tapped"] = not item["tapped"]
        self._field_log(seat, "tap" if item["tapped"] else "untap", owner, item)

    def untap_all(self, user_id: int) -> None:
        """Desvira tudo o que você controla (inclusive cartas de outros que estão com você)."""
        seat = self._require(user_id)
        for s in self.data["seats"].values():
            for item in s["zones"]["battlefield"]:
                if (item.get("controller") or s["user_id"]) == user_id:
                    item["tapped"] = False
        self._log(seat, "untap_all")

    def shuffle(self, user_id: int) -> None:
        seat = self._require(user_id)
        _random.shuffle(seat["zones"]["library"])
        self._log(seat, "shuffle")

    def mulligan(self, user_id: int) -> None:
        """Mão volta para o grimório, embaralha e compra 7 de novo (o jogador devolve as do mulligan)."""
        seat = self._require(user_id)
        zones = seat["zones"]
        zones["library"].extend(zones["hand"])
        zones["hand"].clear()
        _random.shuffle(zones["library"])
        drawn = zones["library"][:HAND_SIZE]
        del zones["library"][: len(drawn)]
        zones["hand"].extend(drawn)
        self._log(seat, "mulligan", n=len(drawn))

    def restart(self, user_id: int) -> None:
        """Recomeça a partida do jogador: tudo volta ao grimório (comandantes ao canto do campo) e a vida a 40."""
        seat = self._require(user_id)
        if not seat["deck"]:
            raise ActionError("no_deck")
        _reset_seat(seat)
        self._release_control(user_id)
        self._log(seat, "restart")

    def end_game(self, user_id: int, winner_id: int | None) -> int | None:
        """
        Encerra a partida com um vencedor (ou sem vencedor, winner_id=None). Devolve a posição do
        vencedor no sorteio de origem, se a mesa veio de um ("Jogar agora"), para ir ao ranking.
        """
        seat = self._require(user_id)
        winner = None
        if winner_id is not None:
            winner = self.seat_of(winner_id)
            if winner is None:
                raise ActionError("bad_winner")
        self.data["result"] = {
            "winner": winner_id,
            "winner_name": winner["name"] if winner else None,
            "by": seat["name"],
            "turn": self.data["turn"]["number"],
        }
        self._log(seat, "game_over", winner=winner["name"] if winner else None)
        if winner is None:
            return None
        claimed = next((e for e in self.data["dealt"] if e.get("claimed") == winner_id), None)
        return claimed["position"] if claimed else None

    def new_game(self, user_id: int) -> None:
        """Partida nova com os mesmos decks: todos recomeçam e o turno zera."""
        seat = self._require(user_id)
        for s in self.data["seats"].values():
            if s["deck"]:
                _reset_seat(s)
        self.data["turn"] = {"player": None, "number": 0}
        self.data["result"] = None
        self._log(seat, "new_game")

    def change_life(self, user_id: int, delta: int) -> None:
        """Cada jogador mexe só na própria vida, como numa mesa física."""
        seat = self._require(user_id)
        before = seat["life"]
        seat["life"] = max(-LIFE_LIMIT, min(LIFE_LIMIT, before + delta))
        self._log(seat, "life", frm=before, to=seat["life"])

    def counter(self, user_id: int, card_id: str, kind: str, delta: int) -> None:
        """Marcadores numa carta do campo (+1/+1, -1/-1, lealdade, carga...)."""
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        if not isinstance(kind, str) or not COUNTER_RE.match(kind) or not -99 <= delta <= 99 or delta == 0:
            raise ActionError("bad_counter")
        counters = item["counters"]
        if kind not in counters and len(counters) >= 6:
            raise ActionError("bad_counter")
        value = max(0, min(999, counters.get(kind, 0) + delta))
        if value:
            counters[kind] = value
        else:
            counters.pop(kind, None)
        self._field_log(seat, "counter", owner, item, counter=kind, n=value)

    def stat(self, user_id: int, card_id: str, which: str, delta: int) -> None:
        """Muda força ("p") ou resistência ("t") de uma carta no campo (clique soma, direito tira)."""
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        if which not in ("p", "t") or not -99 <= delta <= 99 or delta == 0:
            raise ActionError("bad_stat")
        if not item.get("stats"):
            raise ActionError("no_stats")
        item["stats"][which] = max(-99, min(999, item["stats"][which] + delta))
        self._field_log(seat, "stat", owner, item, p=item["stats"]["p"], t=item["stats"]["t"])

    def toggle_stats(self, user_id: int, card_id: str) -> None:
        """Põe (com a força/resistência impressa, ou 0/0) ou tira o contador de força/resistência."""
        self._require(user_id)
        owner, item = self._on_field(card_id)
        if item.get("stats"):
            item["stats"] = None
        elif item.get("face_down"):
            item["stats"] = {"p": 2, "t": 2}
        else:
            item["stats"] = _base_stats(owner["cards"][card_id]) or {"p": 0, "t": 0}

    def commander_tax(self, user_id: int, card_id: str, delta: int) -> None:
        seat = self._require(user_id)
        if card_id not in seat["cards"] or not seat["cards"][card_id].get("commander"):
            raise ActionError("not_commander")
        value = max(0, min(20, seat["tax"].get(card_id, 0) + delta))
        seat["tax"][card_id] = value
        self._log(seat, "tax", card=self._card_name(seat, card_id), n=value * 2)

    def commander_damage(self, user_id: int, source_id: int, delta: int) -> None:
        """Dano de comandante recebido de outro jogador. Também mexe na vida, como no jogo."""
        seat = self._require(user_id)
        source = self.seat_of(source_id)
        if source is None or source_id == user_id or not -99 <= delta <= 99:
            raise ActionError("bad_source")
        key = str(source_id)
        before = seat["cmd_damage"].get(key, 0)
        after = max(0, min(99, before + delta))
        seat["cmd_damage"][key] = after
        seat["life"] = max(-LIFE_LIMIT, min(LIFE_LIMIT, seat["life"] - (after - before)))
        self._log(seat, "cmd_damage", source=source["name"], n=after)

    def poison(self, user_id: int, delta: int) -> None:
        seat = self._require(user_id)
        seat["poison"] = max(0, min(99, seat["poison"] + delta))
        self._log(seat, "poison", n=seat["poison"])

    def peek(self, user_id: int, n: int | None, quiet: bool = False) -> list[dict]:
        """Cartas do grimório só para o dono: as N do topo, ou todas (buscar)."""
        seat = self._require(user_id)
        library = seat["zones"]["library"]
        ids = library if n is None else library[: max(1, min(n, 30))]
        if not quiet:
            if n is None:
                self._log(seat, "search")
            else:
                self._log(seat, "look", n=len(ids))
        return [self._card_obj(seat, cid) for cid in ids]

    def reveal(self, user_id: int, card_id: str) -> None:
        seat = self._require(user_id)
        zone, _ = self._find(seat, card_id)
        card = seat["cards"][card_id]
        self._log(seat, "reveal", card=card["name"], image=card["image"], frm=zone)

    def shake(self, user_id: int, card_id: str) -> None:
        """
        Sacode uma carta do campo de qualquer jogador (a sua ou a de um oponente) para chamar a
        atenção da mesa: a carta treme na tela de todos. Uma por jogador a cada meio segundo.
        """
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        self._cooldown(user_id)
        self._field_log(seat, "shake", owner, item, ref=card_id)

    def _cooldown(self, user_id: int) -> None:
        now = time.monotonic()
        if now - self._shaken.get(user_id, 0.0) < SHAKE_COOLDOWN:
            raise ActionError("too_fast")
        self._shaken[user_id] = now

    # ---- marcações nas cartas do campo (qualquer jogador, qualquer carta) ------------------

    def invert(self, user_id: int, card_id: str) -> None:
        """Vira a carta de cabeça para baixo (lembrete: "não desvira", efeito invertido...)."""
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        item["inverted"] = not item.get("inverted")
        self._field_log(seat, "invert" if item["inverted"] else "uninvert", owner, item)

    def highlight(self, user_id: int, card_id: str) -> None:
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        item["highlight"] = not item.get("highlight")
        if item["highlight"]:
            self._field_log(seat, "highlight", owner, item)

    def lock(self, user_id: int, card_id: str) -> None:
        """Trava a posição da carta (não dá para arrastar sem querer)."""
        self._require(user_id)
        _, item = self._on_field(card_id)
        item["locked"] = not item.get("locked")

    def note(self, user_id: int, card_id: str, text) -> None:
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        text = " ".join(text.split()) if isinstance(text, str) else ""
        if len(text) > NOTE_MAX:
            raise ActionError("bad_note")
        item["note"] = text or None
        self._field_log(seat, "note", owner, item, text=text or None)

    def symbol(self, user_id: int, card_id: str, symbol) -> None:
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        if symbol is not None and symbol not in SYMBOLS:
            raise ActionError("bad_symbol")
        item["symbol"] = symbol
        if symbol:
            self._field_log(seat, "symbol", owner, item, text=symbol)

    def face_down(self, user_id: int, card_id: str) -> None:
        """
        Vira a carta para baixo no campo (metamorfo, manifestar...): só o dono e quem controla veem
        qual é; para os outros é um 2/2 sem nome. Virar para cima revela.
        """
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        if item.get("face_down"):
            item["face_down"] = False
            item["stats"] = _base_stats(owner["cards"][card_id])
            self._field_log(seat, "face_up", owner, item)
        else:
            item["face_down"] = True
            item["stats"] = {"p": 2, "t": 2}
            self._field_log(seat, "face_down", owner, item)

    def flip(self, user_id: int, card_id: str) -> None:
        """Mostra a outra face (cartas de duas faces)."""
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        if not owner["cards"][card_id].get("back"):
            raise ActionError("no_back")
        item["flipped"] = not item.get("flipped")
        self._field_log(seat, "flip", owner, item)

    def give_control(self, user_id: int, card_id: str, to_id) -> None:
        """Passa o controle da carta para outro jogador: ela vai para o campo dele (e volta ao sair)."""
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        target = self.seat_of(to_id) if isinstance(to_id, int) and not isinstance(to_id, bool) else None
        if target is None:
            raise ActionError("bad_player")
        item["controller"] = None if target is owner else target["user_id"]
        item["attached_to"] = None
        self._field_log(seat, "control", owner, item, to=target["name"])

    def attach(self, user_id: int, card_id: str, host_id) -> None:
        """Prende a carta (equipamento, aura) em outra do campo, ou solta (host_id None)."""
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        if host_id is None:
            if item.get("attached_to"):
                _, host = self._on_field(item["attached_to"])
                item["x"], item["y"] = _clamp01(host["x"] + 0.05, 0.5), host["y"]
            item["attached_to"] = None
            self._field_log(seat, "detach", owner, item)
            return
        if host_id == card_id:
            raise ActionError("bad_attach")
        host_owner, host = self._on_field(str(host_id))
        # Sem correntes: prende na carta "raiz" (se o alvo já está preso em outra)
        if host.get("attached_to"):
            host_owner, host = self._on_field(host["attached_to"])
        if host is item:
            raise ActionError("bad_attach")
        item["attached_to"] = host["id"]
        for other in self._all_field():
            if other.get("attached_to") == item["id"]:
                other["attached_to"] = host["id"]  # o que estava preso nela passa para o novo alvo
        host_name = None if host.get("face_down") else host_owner["cards"][host["id"]]["name"]
        self._field_log(seat, "attach", owner, item, to=host_name)

    def target(self, user_id: int, card_id: str, to_card=None, to_player=None) -> None:
        """Seta de alvo: da carta para outra carta do campo ou para um jogador (some em segundos)."""
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        extra: dict = {"ref": card_id}
        if to_card is not None:
            t_owner, t_item = self._on_field(str(to_card))
            extra.update(
                to_ref=t_item["id"],
                to=None if t_item.get("face_down") else t_owner["cards"][t_item["id"]]["name"],
                to_owner=t_owner["name"],
            )
        elif isinstance(to_player, int) and not isinstance(to_player, bool) and self.seat_of(to_player):
            target = self.seat_of(to_player)
            extra.update(to_seat=target["seat"], to=target["name"])
        else:
            raise ActionError("bad_target")
        self._cooldown(user_id)
        self._field_log(seat, "target", owner, item, **extra)

    def _all_field(self):
        for s in self.data["seats"].values():
            yield from s["zones"]["battlefield"]

    def create_token(self, user_id: int, name: str, image: str, x=None, y=None, power="", toughness="") -> None:
        seat = self._require(user_id)
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            raise ActionError("bad_token")
        if not isinstance(image, str) or not image.startswith(TOKEN_IMAGE_PREFIX) or len(image) > 300:
            raise ActionError("bad_token")
        if sum(1 for c in seat["cards"].values() if c.get("token")) >= MAX_TOKENS:
            raise ActionError("too_many_tokens")
        cid = self._new_id()
        card = {
            "name": name.strip(),
            "image": image,
            "back": "",
            "token": True,
            "power": _short(power),
            "toughness": _short(toughness),
        }
        seat["cards"][cid] = card
        seat["zones"]["battlefield"].append(_field_item(cid, _clamp01(x, 0.5), _clamp01(y, 0.5), card))
        self._log(seat, "token", card=name.strip())

    def clone(self, user_id: int, card_id: str) -> None:
        """Cópia (ficha) de uma carta do campo (sua ou de um oponente); a cópia entra no seu campo."""
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        if sum(1 for c in seat["cards"].values() if c.get("token")) >= MAX_TOKENS:
            raise ActionError("too_many_tokens")
        src = owner["cards"][card_id]
        cid = self._new_id()
        card = {**src, "token": True, "commander": False}
        seat["cards"][cid] = card
        here = owner is seat and not item.get("controller")
        x, y = (item["x"] + 0.04, item["y"] + 0.06) if here else (0.45, 0.5)
        copy = _field_item(cid, min(1.0, x), min(1.0, y), card)
        copy["stats"] = dict(item["stats"]) if item.get("stats") else copy["stats"]  # copia como está agora
        seat["zones"]["battlefield"].append(copy)
        self._log(seat, "clone", card=src["name"])

    def roll(self, user_id: int, sides: int) -> None:
        seat = self._require(user_id)
        if not 2 <= sides <= MAX_DIE:
            raise ActionError("bad_die")
        self._log(seat, "roll", sides=sides, n=_random.randint(1, sides))

    def chat(self, user_id: int, text: str) -> None:
        seat = self._require(user_id)
        text = text.strip() if isinstance(text, str) else ""
        if not 1 <= len(text) <= CHAT_MAX:
            raise ActionError("bad_message")
        self._log(seat, "chat", text=text)

    def pass_turn(self, user_id: int) -> None:
        """
        Passa o turno para o próximo jogador sentado (na ordem das cadeiras). Sem turno ainda,
        quem aperta começa. Só quem está com o turno passa, a não ser que esteja desconectado.
        """
        seat = self._require(user_id)
        turn = self.data["turn"]
        active = turn["player"]
        seats = sorted(self.data["seats"].values(), key=lambda s: s["seat"])
        if active is None or self.seat_of(active) is None:
            nxt = seat
        else:
            if active != user_id and self.online.get(active, 0) > 0:
                raise ActionError("not_your_turn")
            passing = self.seat_of(active)
            passing["opening"] = False  # passou o primeiro turno: acabou a fase de mão inicial
            current = passing["seat"]
            nxt = next((s for s in seats if s["seat"] > current), seats[0])
        turn["player"] = nxt["user_id"]
        turn["number"] += 1
        self._log(seat, "turn", next=nxt["name"], n=turn["number"])

    def claim_dealt(self, user_id: int, deck: dict) -> None:
        """Marca o deck do sorteio como pego por este jogador (se veio da lista do sorteio)."""
        for entry in self.data["dealt"]:
            if entry["deck"]["kind"] == deck["kind"] and entry["deck"]["ref"] == deck["ref"] and not entry.get("claimed"):
                entry["claimed"] = user_id
                return

    def dealt_for(self, user_id: int) -> dict | None:
        """Deck que o sorteio deu para esta conta (salas online, onde o jogador tem conta)."""
        return next(
            (e["deck"] for e in self.data["dealt"] if e.get("user_id") == user_id and not e.get("claimed")),
            None,
        )

    def _new_id(self) -> str:
        cid = f"c{self.data['next_id']}"
        self.data["next_id"] += 1
        return cid

    def _card_obj(self, seat: dict, cid: str) -> dict:
        c = seat["cards"][cid]
        return {"id": cid, "name": c["name"], "image": c["image"], "back": c["back"]}

    # ---- o que cada jogador vê -----------------------------------------------------------

    def _field_view(self, viewer_id: int) -> dict[int, list[dict]]:
        """
        Cartas do campo agrupadas pelo campo onde aparecem: o de quem controla, ou o da carta em
        que estão presas. Viradas para baixo só mostram a frente para o dono e quem controla.
        """
        found = {}  # id → (dono, item)
        for s in self.data["seats"].values():
            for item in s["zones"]["battlefield"]:
                found[item["id"]] = (s, item)

        def board(owner, item, depth=0):
            host = item.get("attached_to")
            if host in found and depth < 3:
                return board(*found[host], depth + 1)
            return item.get("controller") or owner["user_id"]

        out: dict[int, list[dict]] = {}
        for owner, item in found.values():
            c = owner["cards"][item["id"]]
            controller = item.get("controller")
            hidden = item.get("face_down") and viewer_id not in (owner["user_id"], controller)
            if hidden:
                face = {"id": item["id"], "name": "", "image": "", "back": ""}
            elif item.get("flipped") and c["back"]:
                face = {"id": item["id"], "name": c["name"], "image": c["back"], "back": c["image"]}
            else:
                face = {"id": item["id"], "name": c["name"], "image": c["image"], "back": c["back"]}
            out.setdefault(board(owner, item), []).append(
                {
                    **face,
                    "x": item["x"],
                    "y": item["y"],
                    "tapped": item["tapped"],
                    "counters": item["counters"],
                    "stats": item.get("stats"),
                    "base": None if hidden else _base_stats(c),
                    "token": bool(c.get("token")),
                    "commander": bool(c.get("commander")) and not hidden,
                    "owner": owner["user_id"],
                    "controller": controller,
                    "attached_to": item.get("attached_to") if item.get("attached_to") in found else None,
                    "inverted": bool(item.get("inverted")),
                    "highlight": bool(item.get("highlight")),
                    "locked": bool(item.get("locked")),
                    "face_down": bool(item.get("face_down")),
                    "flipped": bool(item.get("flipped")),
                    "note": item.get("note"),
                    "symbol": item.get("symbol"),
                }
            )
        return out

    def view(self, viewer_id: int) -> dict:
        players = []
        field = self._field_view(viewer_id)
        for seat in sorted(self.data["seats"].values(), key=lambda s: s["seat"]):
            mine = seat["user_id"] == viewer_id
            cards, zones = seat["cards"], seat["zones"]

            def card(cid, cards=cards):
                c = cards[cid]
                return {"id": cid, "name": c["name"], "image": c["image"], "back": c["back"]}

            p = {
                "id": seat["user_id"],
                "name": seat["name"],
                "seat": seat["seat"],
                "life": seat["life"],
                "online": self.online.get(seat["user_id"], 0) > 0,
                "deck": seat["deck"],
                "counts": {z: len(zones[z]) for z in ZONES},
                "poison": seat["poison"],
                "opening": seat["opening"],
                "cmd_damage": seat["cmd_damage"],
                "tax": {cid: n for cid, n in seat["tax"].items() if n},
                "battlefield": field.get(seat["user_id"], []),
            }
            for z in ("graveyard", "exile", "command"):
                p[z] = [card(cid) for cid in zones[z]]
            for z in PRIVATE_ZONES:
                p[z] = [card(cid) for cid in zones[z]] if mine else None
            players.append(p)
        dealt = [
            {"position": e["position"], "player": e["player"], "deck": e["deck"], "claimed": bool(e.get("claimed"))}
            for e in self.data["dealt"]
        ]
        return {
            "code": self.code,
            "max_seats": MAX_SEATS,
            "players": players,
            "log": self.data["log"][-100:],
            "dealt": dealt,
            "turn": self.data["turn"],
            "result": self.data["result"],
            "idle_left": self.idle_left(),
            "idle_close": IDLE_CLOSE,
        }

    def summary(self, user_id: int) -> dict:
        """Resumo para a lista "suas mesas ativas" (sem cartas)."""
        seats = sorted(self.data["seats"].values(), key=lambda s: s["seat"])
        return {
            "code": self.code,
            "players": [
                {
                    "name": s["name"],
                    "seat": s["seat"],
                    "deck": (s["deck"] or {}).get("name"),
                    "online": self.online.get(s["user_id"], 0) > 0,
                    "you": s["user_id"] == user_id,
                }
                for s in seats
            ],
            "max_seats": MAX_SEATS,
            "turn": self.data["turn"]["number"],
            "finished": self.data["result"] is not None,
            "idle_left": self.idle_left(),
        }


def _reset_seat(seat: dict) -> None:
    """Tudo volta ao grimório embaralhado (fichas somem, comandantes ao canto do campo), vida a 40."""
    all_ids = [item["id"] if isinstance(item, dict) else item for items in seat["zones"].values() for item in items]
    for cid in [c for c in all_ids if seat["cards"][c].get("token")]:
        del seat["cards"][cid]
    all_ids = [c for c in all_ids if c in seat["cards"]]
    zones = empty_zones()
    commanders = [cid for cid in all_ids if seat["cards"][cid].get("commander")]
    zones["library"] = [cid for cid in all_ids if cid not in set(commanders)]
    zones["battlefield"] = _commanders_on_field(commanders, seat["cards"])
    _random.shuffle(zones["library"])
    seat.update(zones=zones, life=STARTING_LIFE, poison=0, cmd_damage={}, tax={}, opening=True)


def _stat_int(value) -> int | None:
    """"3" → 3, "*" ou "1+*" → só a parte numérica (0 se não houver); vazio → None."""
    if not isinstance(value, str) or not value.strip():
        return None
    digits = "".join(ch for ch in value.split("+")[0] if ch.isdigit() or ch == "-")
    try:
        return int(digits)
    except ValueError:
        return 0


def _base_stats(card: dict) -> dict | None:
    p, t = _stat_int(card.get("power")), _stat_int(card.get("toughness"))
    return {"p": p, "t": t} if p is not None and t is not None else None


def _short(value) -> str:
    return value[:8] if isinstance(value, str) else ""


def _field_item(cid: str, x: float, y: float, card: dict | None = None) -> dict:
    """
    Carta entrando no campo. Criaturas (e veículos) já entram com o contador de força/resistência
    impresso; planeswalkers, com os marcadores de lealdade iniciais.
    """
    item = {"id": cid, "x": x, "y": y, "tapped": False, "counters": {}, "stats": None}
    if card:
        item["stats"] = _base_stats(card)
        loyalty = _stat_int(card.get("loyalty"))
        if loyalty:
            item["counters"]["Loyalty"] = loyalty
    return item


def _commanders_on_field(ids: list[str], cards: dict | None = None) -> list[dict]:
    """Comandantes no canto de cima à direita do campo, lado a lado (parceiros)."""
    return [
        _field_item(cid, round(1 - i * 0.09, 4), 0.0, (cards or {}).get(cid)) for i, cid in enumerate(ids)
    ]


def _clamp01(value, default: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return round(max(0.0, min(1.0, float(value))), 4)


TABLES: dict[str, Table] = {}
