"""
Estado das mesas virtuais (Fase 1 do roadmap).

Cada mesa é um dicionário simples (vira JSON para salvar no Postgres a cada ação, ver
tables/store.py). Ele fica na memória do processo: no Render gratuito roda um processo só,
então todas as conexões de uma mesa caem no mesmo lugar e não precisa de Redis.

Tudo aqui é síncrono e roda no loop de eventos sem `await` no meio: cada ação é atômica.

O servidor não conhece as regras do Magic. Ele só garante que cada jogador mexe nas próprias
cartas e que ninguém vê o que não deve (mão, grimório e pilha virada dos outros).
"""

import functools
import json
import os
import re
import secrets
import time
import zlib

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
# Cartas de ajuda (Monarca, Iniciativa, Dia/Noite...): entram como fichas sem o selo "Ficha".
# Estas só existem uma na mesa: quem cria pega para si (a de outro jogador sai do campo).
UNIQUE_HELPERS = {"The Monarch", "The Initiative", "Day // Night"}
CHAT_MAX = 300
SHAKE_COOLDOWN = 0.5  # segundos entre duas sacudidas (ou setas de alvo) do mesmo jogador
NOTE_MAX = 120
# Desfazer: cada jogador desfaz as próprias ações (as últimas 20), com o "ok" dos outros conectados
UNDO_DEPTH = 20
CHECKPOINTS = 80  # momentos da partida guardados para "voltar a este momento" (comprimidos, só na memória)
UNDO_TIMEOUT = 90  # segundos para os outros responderem ao pedido de desfazer
CONTROL_TIMEOUT = 60  # segundos para quem controla a carta responder ao pedido de controle
UNDOABLE = {
    "load_deck", "draw", "move", "tap", "untap_all", "shuffle", "mulligan", "restart", "life", "counter", "stat",
    "toggle_stats", "tax", "cmd_damage", "poison", "token", "clone", "pass_turn", "invert", "highlight", "lock",
    "note", "symbol", "face_down", "flip", "control", "attach", "draw_to", "top_revealed", "scoop", "reorder_top",
    "tap_many", "move_many", "place_many", "arrange",
}  # fmt: skip
# Espaço livre e "organizar" no campo (coordenadas de 0 a 1): uma carta de 62 px num campo de
# ~1000 px ocupa uns 0,06 na largura e uns 0,2 na altura
FREE_X0, FREE_STEP_X, FREE_COLS, FREE_GAP_Y = 0.02, 0.07, 14, 0.2
# Zona do comandante: um quadro no canto de cima à esquerda do campo, uma vaga por comandante
# (parceiros lado a lado). Carta na zona tem "slot" (a vaga) e o cliente desenha dentro do quadro;
# as fileiras de cima começam depois dele.
CMD_X, ROW_X1, TOP_X0, MAX_CMD_SLOTS = 0.0, 0.98, 0.24, 4
BASIC_LANDS = {"Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"}
MAX_BATCH = 60  # cartas por ação em grupo (várias selecionadas)
# Destinos de "comprar para" (do topo ou do fundo do grimório); "battlefield_down" = no campo virada
DRAW_TO = {"hand", "graveyard", "exile", "facedown", "battlefield", "battlefield_down"}
# Símbolos que dá para pôr numa carta do campo (o desenho de cada um fica no cliente)
SYMBOLS = {
    "attack", "block", "sick", "target", "star", "skull", "shield", "flame",
    # Habilidades (lembretes): voar, toque mortífero, vínculo com a vida...
    "flying", "deathtouch", "lifelink", "trample", "vigilance", "first_strike", "double_strike", "haste",
    "hexproof", "indestructible", "menace", "reach",
}  # fmt: skip
MAX_SYMBOLS = len(SYMBOLS)  # todos cabem (o cliente quebra em colunas)
MAX_COUNTER_KINDS = 16
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
        # Desfazer (só na memória): pilha de cada jogador e o pedido aberto, se houver
        self._undo: dict[int, list[dict]] = {}
        self.undo_request: dict | None = None
        # Pedidos de controle abertos (só na memória): id da carta → quem pediu, quem responde, quando
        self.control_requests: dict[str, dict] = {}
        # Espectadores conectados (só na memória): id → [nome, conexões]
        self.spectators: dict[int, list] = {}
        # Parte comum da visão, montada uma vez por atualização enviada (ver view)
        self.gen = 0
        self._share: dict | None = None
        self._share_gen: int | None = None
        # Histórico da partida: (id do registro no log, o registro, a mesa comprimida logo depois dele)
        self._checkpoints: list[tuple[int, dict, bytes]] = []
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
            if not seat.get("cmd_zone"):
                # Antes da zona do comandante: comandantes que ainda estão no canto de cima vão para ela
                seat["cmd_zone"] = True
                for item in seat["zones"]["battlefield"]:
                    card = seat["cards"].get(item["id"]) or {}
                    if card.get("commander") and item["y"] == 0.0 and (item["x"] >= 0.8 or item["x"] == 0.0):
                        item["slot"] = self._cmd_slot(seat)
                        item["x"] = CMD_X
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

    def _controlled(self, user_id: int, card_id: str) -> tuple[dict, dict]:
        """
        Carta no campo que esta conta controla: (dono, item). Força/resistência e marcadores
        só mudam pela mão de quem controla a carta (o oponente não mexe nos números da sua).
        """
        owner, item = self._on_field(card_id)
        if (item.get("controller") or owner["user_id"]) != user_id:
            raise ActionError("not_controller")
        return owner, item

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

    # ---- espectadores (mesa cheia: quem chega pode assistir) ---------------------------------

    def watch(self, user_id: int, name: str) -> None:
        """Entra como espectador: vê o campo de todos, sem as mãos, e não mexe em nada."""
        names = self.spectators.setdefault(user_id, [name, 0])
        names[1] += 1

    def unwatch(self, user_id: int) -> None:
        entry = self.spectators.get(user_id)
        if entry:
            entry[1] -= 1
            if entry[1] <= 0:
                del self.spectators[user_id]

    def leave(self, user_id: int) -> None:
        if user_id in self.online:
            self.online[user_id] = max(0, self.online[user_id] - 1)
        # Quem saiu não precisa mais aprovar o desfazer pendente
        req = self.undo_request
        if req and not self.online.get(user_id) and user_id in req["needed"]:
            req["needed"].remove(user_id)
            self._finish_undo_if_ready()

    # ---- ações ---------------------------------------------------------------------------

    def load_deck(self, user_id: int, deck: dict, rows: list[dict]) -> None:
        """
        Troca o deck do jogador. `rows`: [{"name", "image", "back", "quantity", "is_commander"}].
        Comandantes já entram no campo, na zona deles (à esquerda); o resto é embaralhado no grimório.
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
                    "attach": _attach_kind(row.get("type_line", "")),
                    "kind": _card_kind(row.get("type_line", "")),
                    "types": _card_types(row.get("type_line", "")),
                }
                (commanders if row["is_commander"] else zones["library"]).append(cid)
        _random.shuffle(zones["library"])
        zones["battlefield"] = _commanders_on_field(commanders, cards)
        seat.update(
            cards=cards, zones=zones, deck=deck, life=STARTING_LIFE, poison=0, cmd_damage={}, tax={}, opening=True,
            hand_shown=[], cmd_zone=True,
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
        seat["last_draw"] = drawn[-1]
        self._log(seat, "draw", n=len(drawn))

    # ---- grimório (menu do deck) ---------------------------------------------------------

    def draw_to(self, user_id: int, n: int, to: str, bottom: bool = False) -> None:
        """
        N cartas do topo (ou do fundo) do grimório direto para outra zona: cemitério (moer), exílio,
        pilha virada, mão, ou o campo (virada para cima ou para baixo).
        """
        seat = self._require(user_id)
        if not isinstance(n, int) or not 1 <= n <= 20 or to not in DRAW_TO:
            raise ActionError("bad_amount")
        library = seat["zones"]["library"]
        if not library:
            raise ActionError("library_empty")
        taken = library[-n:][::-1] if bottom else library[:n]
        if bottom:
            del library[len(library) - len(taken) :]
        else:
            del library[: len(taken)]
        for cid in taken:
            if to.startswith("battlefield"):
                card = seat["cards"][cid]
                # Num espaço livre do campo, sem cair em cima das que já estão lá
                x, y = self._free_spot(seat["user_id"], card if to == "battlefield" else None)
                item = _field_item(cid, x, y, card)
                if to == "battlefield_down":
                    item.update(face_down=True, stats={"p": 2, "t": 2}, counters={})
                seat["zones"]["battlefield"].append(item)
            else:
                seat["zones"][to].append(cid)
        if to == "hand":
            seat["last_draw"] = taken[-1]
        public = to in ("graveyard", "exile", "battlefield")
        self._log(
            seat,
            "draw_to",
            n=len(taken),
            to=to,
            position="bottom" if bottom else "top",
            text=", ".join(seat["cards"][c]["name"] for c in taken) if public else None,
        )

    def reveal_top(self, user_id: int, n: int) -> None:
        """Mostra para todos as N cartas do topo do grimório (elas continuam lá, na mesma ordem)."""
        seat = self._require(user_id)
        if not isinstance(n, int) or not 1 <= n <= 20:
            raise ActionError("bad_amount")
        top = seat["zones"]["library"][:n]
        if not top:
            raise ActionError("library_empty")
        cards = [{"name": seat["cards"][c]["name"], "image": seat["cards"][c]["image"]} for c in top]
        self._log(seat, "reveal", cards=cards, n=len(cards), frm="library", card=cards[0]["name"], image=cards[0]["image"])

    def toggle_top_revealed(self, user_id: int) -> None:
        """Deixa a carta do topo do grimório sempre virada para cima (todos veem qual é)."""
        seat = self._require(user_id)
        seat["top_revealed"] = not seat.get("top_revealed")
        self._log(seat, "top_revealed" if seat["top_revealed"] else "top_hidden")

    def reveal_last_draw(self, user_id: int) -> None:
        """Revela a última carta comprada, se ela ainda está na mão."""
        seat = self._require(user_id)
        cid = seat.get("last_draw")
        if not cid or cid not in seat["zones"]["hand"]:
            raise ActionError("no_last_draw")
        self.reveal(user_id, cid)

    def scoop(self, user_id: int) -> None:
        """Recolher (desistir): todas as suas cartas voltam ao grimório embaralhado; fichas somem."""
        seat = self._require(user_id)
        if not seat["deck"]:
            raise ActionError("no_deck")
        for item in seat["zones"]["battlefield"]:
            self._detach_from(item)
        ids = [i["id"] if isinstance(i, dict) else i for items in seat["zones"].values() for i in items]
        for cid in [c for c in ids if seat["cards"][c].get("token")]:
            del seat["cards"][cid]
        zones = empty_zones()
        zones["library"] = [c for c in ids if c in seat["cards"]]
        _random.shuffle(zones["library"])
        seat["zones"] = zones
        self._release_control(user_id)
        self._log(seat, "scoop")

    def move(
        self,
        user_id: int,
        card_id: str,
        to: str,
        x=None,
        y=None,
        position: str = "top",
        log: bool = True,
        slot: bool = False,
    ) -> str | None:
        """
        Move uma carta. Da mão, do grimório e das pilhas só o dono mexe; do campo qualquer jogador
        manda para as zonas do dono (destruir, exilar, devolver à mão...). Arrastar no campo é de
        quem controla a carta. `slot`: comandante solto na zona do comandante (sem ponto, ele
        também volta para lá).
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
            item["attached_to"] = None
            if slot and seat["cards"][card_id].get("commander") and item.get("controller") in (None, seat["user_id"]):
                item["slot"] = self._cmd_slot(seat, skip=item) if item.get("slot") is None else item["slot"]
                item["x"], item["y"] = CMD_X, 0.0
                return
            item.pop("slot", None)
            item["x"], item["y"] = _clamp01(x, item["x"]), _clamp01(y, item["y"])
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
            if log:
                self._log(actor, "token_gone", card=card["name"], owner=other)
            return card["name"]
        if to == "battlefield":
            point = _is_num(x) and _is_num(y)
            if card.get("commander") and (slot or not point):
                # Comandante volta para a zona dele
                item = _field_item(card_id, CMD_X, 0.0, card)
                item["slot"] = self._cmd_slot(seat)
                zones["battlefield"].append(item)
            else:
                if not point:  # sem ponto escolhido (atalho, menu): um espaço livre
                    x, y = self._free_spot(seat["user_id"], card)
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
        if not log:
            return self._card_name(seat, card_id) if public else None
        self._log(
            actor,
            "move",
            card=self._card_name(seat, card_id) if public else None,
            frm=frm,
            to=to,
            position=position if to == "library" else None,
            owner=other,
        )

    # ---- várias cartas de uma vez (seleção) ---------------------------------------------

    def _batch(self, cards) -> list[str]:
        if not isinstance(cards, list) or not 1 <= len(cards) <= MAX_BATCH:
            raise ActionError("bad_selection")
        return list(dict.fromkeys(str(c) for c in cards))

    def tap_many(self, user_id: int, cards, tapped: bool) -> None:
        """Vira (ou desvira) todas as cartas selecionadas do campo, de qualquer jogador."""
        seat = self._require(user_id)
        items = [self._on_field(c)[1] for c in self._batch(cards)]
        for item in items:
            item["tapped"] = bool(tapped)
        self._log(seat, "tap_many" if tapped else "untap_many", n=len(items))

    def move_many(self, user_id: int, cards, to: str, position: str = "top") -> None:
        """Manda as cartas selecionadas para uma zona (cada uma vai para a zona do dono)."""
        seat = self._require(user_id)
        ids = self._batch(cards)
        if to not in ZONES or to == "battlefield":
            raise ActionError("bad_zone")
        for cid in ids:  # confere tudo antes de mexer: ou move todas, ou nenhuma
            owner = self._owner_of(cid)
            if owner is None:
                raise ActionError("not_your_card")
            frm, _ = self._find(owner, cid)
            if frm != "battlefield" and owner is not seat:
                raise ActionError("not_your_card")
        names = [self.move(user_id, cid, to, position=position, log=False) for cid in ids]
        shown = [n for n in names if n]
        self._log(
            seat,
            "move_many",
            n=len(ids),
            to=to,
            position=position if to == "library" else None,
            text=", ".join(shown[:8]) + ("…" if len(shown) > 8 else "") if shown else None,
        )

    def place_many(self, user_id: int, places) -> None:
        """Reposiciona várias cartas do campo (arrastar um grupo selecionado). Sem registro no log."""
        self._require(user_id)
        if not isinstance(places, list) or not 1 <= len(places) <= MAX_BATCH:
            raise ActionError("bad_selection")
        for p in places:
            if isinstance(p, dict):
                self.move(user_id, str(p.get("card")), "battlefield", p.get("x"), p.get("y"))

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
        self._undo.clear()
        self._checkpoints.clear()
        self.undo_request = None
        self._log(seat, "new_game")

    def change_life(self, user_id: int, delta: int) -> None:
        """Cada jogador mexe só na própria vida, como numa mesa física."""
        seat = self._require(user_id)
        before = seat["life"]
        seat["life"] = max(-LIFE_LIMIT, min(LIFE_LIMIT, before + delta))
        self._log(seat, "life", frm=before, to=seat["life"])

    def counter(self, user_id: int, card_id: str, kind: str, delta: int) -> None:
        """Marcadores numa carta do campo (+1/+1, -1/-1, lealdade, carga...). Só quem controla."""
        seat = self._require(user_id)
        owner, item = self._controlled(user_id, card_id)
        if not isinstance(kind, str) or not COUNTER_RE.match(kind) or not -999 <= delta <= 999 or delta == 0:
            raise ActionError("bad_counter")
        counters = item["counters"]
        if kind not in counters and len(counters) >= MAX_COUNTER_KINDS:
            raise ActionError("bad_counter")
        value = max(0, min(999, counters.get(kind, 0) + delta))
        if value:
            counters[kind] = value
        else:
            counters.pop(kind, None)
        self._field_log(seat, "counter", owner, item, counter=kind, n=value)

    def stat(self, user_id: int, card_id: str, which: str, delta: int) -> None:
        """Muda força ("p") ou resistência ("t") de uma carta no campo (clique soma, direito tira). Só quem controla."""
        seat = self._require(user_id)
        owner, item = self._controlled(user_id, card_id)
        if which not in ("p", "t") or not -99 <= delta <= 99 or delta == 0:
            raise ActionError("bad_stat")
        if not item.get("stats"):
            raise ActionError("no_stats")
        item["stats"][which] = max(-99, min(999, item["stats"][which] + delta))
        self._field_log(seat, "stat", owner, item, p=item["stats"]["p"], t=item["stats"]["t"])

    def toggle_stats(self, user_id: int, card_id: str) -> None:
        """Põe (com a força/resistência impressa, ou 0/0) ou tira o contador de força/resistência."""
        self._require(user_id)
        owner, item = self._controlled(user_id, card_id)
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

    # ---- desfazer --------------------------------------------------------------------------

    def snapshot(self) -> dict[str, str]:
        """Foto das partes que uma ação pode mudar (cada lugar, o turno, o resultado, os decks sorteados)."""
        snap = {f"seat:{k}": json.dumps(v) for k, v in self.data["seats"].items()}
        for key in ("turn", "result", "dealt"):
            snap[key] = json.dumps(self.data[key])
        return snap

    def record_undo(self, user_id: int, kind: str, before: dict[str, str], seq_before: int) -> None:
        """Depois de uma ação: guarda o que mudou (antes e depois) para poder desfazer só isso."""
        after = self.snapshot()
        changed = {k: (before.get(k), v) for k, v in after.items() if before.get(k) != v}
        if not changed:
            return
        logged = [e for e in self.data["log"] if e["id"] > seq_before]
        entry = logged[0] if logged else {"kind": "action", "text": kind}
        if logged:
            # Momento da partida para o histórico: a mesa como ficou depois desta ação
            # (monta o JSON com os pedaços que a foto "depois" já tem, sem serializar a mesa de novo)
            seats = ",".join(f"{json.dumps(k[5:])}:{v}" for k, v in after.items() if k.startswith("seat:"))
            text = f'{{"seats":{{{seats}}},"turn":{after["turn"]},"result":{after["result"]},"dealt":{after["dealt"]}}}'
            self._checkpoints.append((entry["id"], entry, zlib.compress(text.encode(), 1)))
            del self._checkpoints[:-CHECKPOINTS]
        stack = self._undo.setdefault(user_id, [])
        stack.append({"changed": changed, "entry": entry})
        del stack[:-UNDO_DEPTH]

    def request_undo(self, user_id: int) -> bool:
        """
        Pede para desfazer a última ação. Sem mais ninguém conectado, desfaz na hora (True);
        senão abre o pedido e espera o "ok" de cada jogador conectado (False).
        """
        seat = self._require(user_id)
        self._expire_undo()
        if self.undo_request:
            raise ActionError("undo_pending")
        stack = self._undo.get(user_id)
        if not stack:
            raise ActionError("nothing_to_undo")
        self._check_undo(stack[-1])
        needed = self._others_online(user_id)
        if not needed:
            self._apply_undo(user_id)
            return True
        self.undo_request = {
            "kind": "undo",
            "by": user_id,
            "name": seat["name"],
            "needed": needed,
            "approved": [],
            "entry": stack[-1]["entry"],
            "at": time.time(),
        }
        return False

    def _others_online(self, user_id: int) -> list[int]:
        return [
            s["user_id"] for s in self.data["seats"].values()
            if s["user_id"] != user_id and self.online.get(s["user_id"], 0) > 0
        ]  # fmt: skip

    def request_rewind(self, user_id: int, to_id) -> bool:
        """
        Voltar a mesa inteira para um momento do histórico (logo depois daquele registro do log).
        Mexe em todos, então todos os conectados aprovam (sozinho na mesa, volta na hora).
        """
        seat = self._require(user_id)
        self._expire_undo()
        if self.undo_request:
            raise ActionError("undo_pending")
        point = next((c for c in self._checkpoints if c[0] == to_id), None)
        if point is None:
            raise ActionError("no_checkpoint")
        needed = self._others_online(user_id)
        if not needed:
            self._apply_rewind(user_id, to_id)
            return True
        self.undo_request = {
            "kind": "rewind",
            "to": to_id,
            "by": user_id,
            "name": seat["name"],
            "needed": needed,
            "approved": [],
            "entry": point[1],
            "at": time.time(),
        }
        return False

    def _apply_rewind(self, user_id: int, to_id: int) -> None:
        idx = next((i for i, c in enumerate(self._checkpoints) if c[0] == to_id), None)
        if idx is None:
            raise ActionError("no_checkpoint")
        _, entry, blob = self._checkpoints[idx]
        saved = json.loads(zlib.decompress(blob))
        for key, seat in saved["seats"].items():
            self.data["seats"][key] = seat  # quem sentou depois daquele momento fica como está
        for key in ("turn", "result", "dealt"):
            self.data[key] = saved[key]
        # O que veio depois daquele momento deixa de existir: desfazer e histórico seguem dali
        del self._checkpoints[idx + 1 :]
        self._undo.clear()
        self._log(self._require(user_id), "rewind", undone=entry)

    def checkpoint_ids(self) -> list[int]:
        return [c[0] for c in self._checkpoints]

    def vote_undo(self, user_id: int, approve: bool) -> None:
        self._require(user_id)
        self._expire_undo()
        req = self.undo_request
        if not req:
            raise ActionError("no_undo_request")
        if user_id == req["by"]:
            if not approve:  # quem pediu desistiu
                self.undo_request = None
                return
            raise ActionError("not_your_vote")
        if user_id not in req["needed"]:
            raise ActionError("not_your_vote")
        if not approve:
            self.undo_request = None
            requester = self.seat_of(req["by"])
            self._log(self._require(user_id), "undo_rejected", owner=requester["name"] if requester else None)
            return
        if user_id not in req["approved"]:
            req["approved"].append(user_id)
        self._finish_undo_if_ready()

    def _finish_undo_if_ready(self) -> None:
        req = self.undo_request
        if not req or any(uid not in req["approved"] for uid in req["needed"]):
            return
        self.undo_request = None
        try:
            if req.get("kind") == "rewind":
                self._apply_rewind(req["by"], req["to"])
            else:
                self._apply_undo(req["by"])
        except ActionError:
            seat = self.seat_of(req["by"])
            if seat:
                self._log(seat, "undo_failed", undone=req["entry"])

    def _expire_undo(self) -> None:
        if self.undo_request and time.time() - self.undo_request["at"] > UNDO_TIMEOUT:
            self.undo_request = None

    def _check_undo(self, entry: dict) -> None:
        """Só desfaz se ninguém mexeu, depois, no que aquela ação mudou."""
        now = self.snapshot()
        if any(now.get(k) != after for k, (_, after) in entry["changed"].items()):
            raise ActionError("undo_conflict")

    def _apply_undo(self, user_id: int) -> None:
        stack = self._undo.get(user_id) or []
        if not stack:
            raise ActionError("nothing_to_undo")
        entry = stack[-1]
        self._check_undo(entry)
        for key, (before, _) in entry["changed"].items():
            if before is None:
                continue
            if key.startswith("seat:"):
                self.data["seats"][key[5:]] = json.loads(before)
            else:
                self.data[key] = json.loads(before)
        stack.pop()
        self._log(self._require(user_id), "undo", undone=entry["entry"])

    def undo_view(self, viewer_id: int) -> dict:
        """O que o jogador pode desfazer e o pedido aberto (com quem já aprovou)."""
        self._expire_undo()
        stack = self._undo.get(viewer_id) or []
        req = self.undo_request
        names = {s["user_id"]: s["name"] for s in self.data["seats"].values()}
        return {
            "count": len(stack),
            "last": stack[-1]["entry"] if stack else None,
            # Momentos para onde a mesa pode voltar (ids de registros do log)
            "checkpoints": self.checkpoint_ids(),
            "request": {
                "kind": req.get("kind", "undo"),
                "by": req["by"],
                "name": req["name"],
                "entry": req["entry"],
                "needed": [{"id": u, "name": names.get(u, "?"), "approved": u in req["approved"]} for u in req["needed"]],
                "left": max(0, int(UNDO_TIMEOUT - (time.time() - req["at"]))),
            }
            if req
            else None,
        }

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
        """Liga/desliga um símbolo na carta (vários ao mesmo tempo, ex.: voar + toque mortífero); None tira todos."""
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        if symbol is not None and symbol not in SYMBOLS:
            raise ActionError("bad_symbol")
        current = _symbols(item)
        if symbol is None:
            current = []
        elif symbol in current:
            current.remove(symbol)
        elif len(current) >= MAX_SYMBOLS:
            raise ActionError("too_many_symbols")
        else:
            current.append(symbol)
            self._field_log(seat, "symbol", owner, item, text=symbol)
        item["symbols"] = current
        item.pop("symbol", None)

    def reorder_top(self, user_id: int, order) -> None:
        """Nova ordem para as cartas do topo do grimório (vidência: arrastar na janela)."""
        seat = self._require(user_id)
        library = seat["zones"]["library"]
        if not isinstance(order, list) or not 1 <= len(order) <= 30 or len(set(order)) != len(order):
            raise ActionError("bad_order")
        if sorted(order) != sorted(library[: len(order)]):
            raise ActionError("bad_order")
        library[: len(order)] = order

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
        """
        Passa o controle da carta para outro jogador: ela vai para o campo dele (e volta ao sair).
        Só quem controla a carta dá o controle; os outros pedem (request_control).
        """
        seat = self._require(user_id)
        owner, item = self._controlled(user_id, card_id)
        target = self.seat_of(to_id) if isinstance(to_id, int) and not isinstance(to_id, bool) else None
        if target is None:
            raise ActionError("bad_player")
        item["controller"] = None if target is owner else target["user_id"]
        item["attached_to"] = None
        self.control_requests.pop(card_id, None)
        self._field_log(seat, "control", owner, item, to=target["name"])

    # ---- pedir o controle ----------------------------------------------------------------

    def _prune_control(self) -> None:
        """Tira os pedidos vencidos e os de cartas que saíram do campo ou mudaram de mãos."""
        now = time.time()
        for cid, req in list(self.control_requests.items()):
            try:
                owner, item = self._on_field(cid)
            except ActionError:
                owner = item = None
            holder = (item.get("controller") or owner["user_id"]) if item else None
            if now - req["at"] > CONTROL_TIMEOUT or holder != req["to"] or self.seat_of(req["from"]) is None:
                del self.control_requests[cid]

    def request_control(self, user_id: int, card_id: str) -> None:
        """Pede o controle de uma carta do campo a quem a controla agora (ela aceita ou recusa)."""
        seat = self._require(user_id)
        owner, item = self._on_field(card_id)
        holder = item.get("controller") or owner["user_id"]
        if holder == user_id:
            raise ActionError("already_yours")
        self._prune_control()
        if card_id in self.control_requests:
            raise ActionError("control_pending")
        self.control_requests[card_id] = {"from": user_id, "to": holder, "at": time.time()}
        self._field_log(seat, "control_ask", owner, item, to=self.seat_of(holder)["name"])

    def answer_control(self, user_id: int, card_id: str, accept: bool) -> None:
        """Quem controla a carta responde ao pedido: aceitar passa o controle para quem pediu."""
        seat = self._require(user_id)
        self._prune_control()
        req = self.control_requests.get(card_id)
        if req is None or req["to"] != user_id:
            raise ActionError("no_control_request")
        del self.control_requests[card_id]
        if accept is True:
            self.give_control(user_id, card_id, req["from"])
            return
        owner, item = self._on_field(card_id)
        self._field_log(seat, "control_no", owner, item, to=self.seat_of(req["from"])["name"])

    def control_view(self, viewer_id: int) -> list[dict]:
        """Pedidos de controle que esta conta fez ou precisa responder."""
        self._prune_control()
        out = []
        for cid, req in self.control_requests.items():
            if viewer_id not in (req["from"], req["to"]):
                continue
            owner, item = self._on_field(cid)
            card = owner["cards"][cid]
            hidden = item.get("face_down") and viewer_id != req["to"]
            out.append({
                "card": cid,
                "name": "" if hidden else card["name"],
                "image": "" if hidden else card["image"],
                "from": req["from"],
                "from_name": self.seat_of(req["from"])["name"],
                "to": req["to"],
                "to_name": self.seat_of(req["to"])["name"],
                "until": round(req["at"] + CONTROL_TIMEOUT, 1),
            })
        return out

    # ---- revelar a mão -------------------------------------------------------------------

    def show_hand(self, user_id: int, to, show) -> None:
        """
        Mostra (ou para de mostrar) a sua mão para um jogador (`to` = id) ou para todos (`to` None).
        Enquanto estiver mostrando, ele vê a mão ao vivo, inclusive as cartas que entrarem depois.
        """
        seat = self._require(user_id)
        if not isinstance(show, bool):
            raise ActionError("bad_player")
        others = [s for s in self.data["seats"].values() if s is not seat]
        if to is None:
            targets = others
        else:
            target = self.seat_of(to) if isinstance(to, int) and not isinstance(to, bool) else None
            if target is None or target is seat:
                raise ActionError("bad_player")
            targets = [target]
        shown = set(seat.get("hand_shown") or [])
        before = set(shown)
        ids = {s["user_id"] for s in targets}
        shown = shown | ids if show else shown - ids
        if shown == before:
            return
        seat["hand_shown"] = sorted(shown)
        names = None if to is None else targets[0]["name"]
        self._log(seat, "show_hand" if show else "hide_hand", target=names, n=len(seat["zones"]["hand"]))

    # ---- ausente (AFK) -------------------------------------------------------------------

    def set_afk(self, user_id: int, player_id, afk) -> None:
        """
        Marca um jogador (você ou outro) como ausente ou de volta. Quem está ausente tem o turno
        pulado; ele volta sozinho ao fazer qualquer coisa na mesa.
        """
        seat = self._require(user_id)
        target = self.seat_of(player_id) if isinstance(player_id, int) and not isinstance(player_id, bool) else None
        if target is None or not isinstance(afk, bool):
            raise ActionError("bad_player")
        if bool(target.get("afk")) == afk:
            return
        target["afk"] = afk
        self._log(seat, "afk" if afk else "back", target=None if target is seat else target["name"])

    def back_from_afk(self, user_id: int) -> bool:
        """O jogador ausente fez alguma coisa: está de volta. True se mudou."""
        seat = self.seat_of(user_id)
        if not seat or not seat.get("afk"):
            return False
        seat["afk"] = False
        self._log(seat, "back", target=None)
        return True

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

    def _board_items(self, user_id: int) -> list[dict]:
        """Cartas que aparecem no campo desta conta: as suas e as que ela controla (soltas, não presas)."""
        return [
            item
            for s in self.data["seats"].values()
            for item in s["zones"]["battlefield"]
            if (item.get("controller") or s["user_id"]) == user_id and not item.get("attached_to")
        ]

    def _free_spot(self, user_id: int, card: dict | None = None) -> tuple[float, float]:
        """
        Lugar livre no campo para uma carta que entra sem ponto escolhido (atalho, "comprar para o
        campo", ficha). Procura em fileiras, da esquerda para a direita; terrenos preferem a fileira
        de baixo (perto de você), criaturas a de cima, o resto a do meio. Lotado: a casa com menos
        cartas por perto.
        """
        taken = [(i["x"], i["y"]) for i in self._board_items(user_id)]
        rows = {
            "land": (1.0, 0.75, 0.5, 0.25, 0.0),
            "creature": (0.0, 0.25, 0.5, 0.75, 1.0),
        }.get(_kind_of(card) if card else "other", (0.5, 0.25, 0.75, 0.0, 1.0))
        spots = [
            (round(x0 + FREE_STEP_X * k, 4), y)
            for y in rows
            for x0 in [TOP_X0 if y < 0.5 else FREE_X0]  # as fileiras de cima começam depois da zona do comandante
            for k in range(FREE_COLS)
            if x0 + FREE_STEP_X * k <= ROW_X1
        ]

        def crowd(spot):
            return sum(1 for x, y in taken if abs(x - spot[0]) < FREE_STEP_X * 0.9 and abs(y - spot[1]) < FREE_GAP_Y)

        free = next((spot for spot in spots if not crowd(spot)), None)
        return free or min(spots, key=crowd)

    def arrange(self, user_id: int) -> None:
        """
        Organiza o seu campo: criaturas na fileira de cima (depois da zona do comandante), outras
        permanentes no meio e terrenos embaixo (perto de você), cada fileira centralizada, iguais
        lado a lado. Comandantes na zona do comandante, cartas travadas e presas ficam onde estão.
        """
        seat = self._require(user_id)
        owners = {s["user_id"]: s for s in self.data["seats"].values()}
        groups: dict[str, list[tuple[str, dict]]] = {"creature": [], "other": [], "land": []}
        for s in self.data["seats"].values():
            for item in s["zones"]["battlefield"]:
                if (item.get("controller") or s["user_id"]) != user_id or item.get("attached_to") or item.get("locked"):
                    continue
                if item.get("slot") is not None:
                    continue
                card = owners[s["user_id"]]["cards"][item["id"]]
                kind = "other" if item.get("face_down") else _kind_of(card, item)
                groups[kind].append((card["name"], item))
        if not any(groups.values()):
            return
        for kind, y, x0 in (("creature", 0.0, TOP_X0), ("other", 0.5, FREE_X0), ("land", 1.0, FREE_X0)):
            row = sorted(groups[kind], key=lambda pair: (pair[0].casefold(), pair[1]["id"]))
            n = len(row)
            width = ROW_X1 - x0
            # Fileira cheia: as cartas se aproximam (sobrepõem um pouco) em vez de passar da borda
            step = min(FREE_STEP_X, width / max(1, n - 1))
            start = x0 + (width - step * (n - 1)) / 2
            for k, (_, item) in enumerate(row):
                item["x"], item["y"] = round(start + step * k, 4), y
        self._log(seat, "arrange")

    def _cmd_slot(self, seat: dict, skip: dict | None = None) -> int:
        """Primeira vaga livre na zona do comandante deste jogador."""
        used = {i.get("slot") for i in seat["zones"]["battlefield"] if i is not skip}
        return next((k for k in range(MAX_CMD_SLOTS) if k not in used), MAX_CMD_SLOTS - 1)

    def _all_field(self):
        for s in self.data["seats"].values():
            yield from s["zones"]["battlefield"]

    def create_token(
        self, user_id: int, name: str, image: str, x=None, y=None, power="", toughness="", back="", helper=False
    ) -> None:
        """
        Ficha (imagem do Scryfall) no seu campo. `helper`: carta de ajuda (Monarca, Iniciativa, O Anel,
        Radiação...), que pode ter verso (Dia // Noite). Monarca, Iniciativa e Dia/Noite são únicas:
        criar de novo tira a que estava com outro jogador.
        """
        seat = self._require(user_id)
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            raise ActionError("bad_token")
        if not isinstance(image, str) or not image.startswith(TOKEN_IMAGE_PREFIX) or len(image) > 300:
            raise ActionError("bad_token")
        if back and (not isinstance(back, str) or not back.startswith(TOKEN_IMAGE_PREFIX) or len(back) > 300):
            raise ActionError("bad_token")
        helper = helper is True
        took_from = None
        if helper and name.strip() in UNIQUE_HELPERS:
            for s in self.data["seats"].values():
                for item in list(s["zones"]["battlefield"]):
                    c = s["cards"][item["id"]]
                    if c.get("helper") and c["name"] == name.strip():
                        self._detach_from(item)
                        s["zones"]["battlefield"].remove(item)
                        del s["cards"][item["id"]]
                        took_from = None if s is seat else s["name"]
        if sum(1 for c in seat["cards"].values() if c.get("token")) >= MAX_TOKENS:
            raise ActionError("too_many_tokens")
        cid = self._new_id()
        card = {
            "name": name.strip(),
            "image": image,
            "back": back or "",
            "token": True,
            "power": _short(power),
            "toughness": _short(toughness),
        }
        if helper:
            card.update(helper=True, kind="other")
        seat["cards"][cid] = card
        if not _is_num(x) or not _is_num(y):
            x, y = self._free_spot(user_id, card)
        seat["zones"]["battlefield"].append(_field_item(cid, _clamp01(x, 0.5), _clamp01(y, 0.5), card))
        if helper:
            self._log(seat, "helper", card=name.strip(), owner=took_from)
        else:
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
        x, y = (item["x"] + 0.04, item["y"] + 0.06) if here else self._free_spot(user_id, card)
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
        Passa o turno para o próximo jogador sentado (na ordem das cadeiras), pulando quem está
        ausente. Sem turno ainda, quem aperta começa. Só quem está com o turno passa, a não ser
        que ele esteja desconectado ou ausente: aí qualquer um passa por ele.
        """
        seat = self._require(user_id)
        turn = self.data["turn"]
        active = turn["player"]
        seats = sorted(self.data["seats"].values(), key=lambda s: s["seat"])
        if active is None or self.seat_of(active) is None:
            nxt = seat
        else:
            passing = self.seat_of(active)
            if active != user_id and self.online.get(active, 0) > 0 and not passing.get("afk"):
                raise ActionError("not_your_turn")
            passing["opening"] = False  # passou o primeiro turno: acabou a fase de mão inicial
            current = passing["seat"]
            # Próximo na roda, pulando os ausentes (todos ausentes: o próximo mesmo)
            ring = [s for s in seats if s["seat"] > current] + [s for s in seats if s["seat"] <= current]
            nxt = next((s for s in ring if not s.get("afk")), ring[0])
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
        return _zone_card(cid, c)

    # ---- o que cada jogador vê -----------------------------------------------------------

    def _shared_view(self, gen: int | None) -> dict:
        """
        Parte da visão que é igual para todos os jogadores: montada uma vez por atualização
        (`gen` muda a cada envio para a mesa) e reaproveitada na visão de cada jogador. Tudo aqui é
        cópia (nada aponta para a mesa, que muda depois): a conexão guarda a última visão enviada
        para calcular o próximo delta sem precisar copiar de novo.
        """
        if gen is not None and self._share_gen == gen and self._share is not None:
            return self._share
        found = {}  # id → (dono, item)
        for s in self.data["seats"].values():
            for item in s["zones"]["battlefield"]:
                found[item["id"]] = (s, item)

        def board(owner, item, depth=0):
            host = item.get("attached_to")
            if host in found and depth < 3:
                return board(*found[host], depth + 1)
            return item.get("controller") or owner["user_id"]

        # Cartas do campo agrupadas pelo campo onde aparecem: o de quem controla, ou o da carta em
        # que estão presas. Virada para baixo: a versão com a frente (dono e quem controla) e a
        # escondida (os outros).
        boards: dict[int, list[tuple]] = {}
        for owner, item in found.values():
            c = owner["cards"][item["id"]]
            controller = item.get("controller")
            shown = _field_card(item, c, owner, controller, found, hidden=False)
            hidden = _field_card(item, c, owner, controller, found, hidden=True) if item.get("face_down") else None
            boards.setdefault(board(owner, item), []).append((shown, hidden, owner["user_id"], controller))

        players = []
        for seat in sorted(self.data["seats"].values(), key=lambda s: s["seat"]):
            cards, zones = seat["cards"], seat["zones"]

            def card(cid, cards=cards):
                c = cards[cid]
                return _zone_card(cid, c)

            p = {
                "id": seat["user_id"],
                "name": seat["name"],
                "seat": seat["seat"],
                "life": seat["life"],
                "online": self.online.get(seat["user_id"], 0) > 0,
                "afk": bool(seat.get("afk")),
                # Para quem a mão está sendo mostrada (todos sabem; só eles veem as cartas)
                "hand_shown": list(seat.get("hand_shown") or []),
                "deck": dict(seat["deck"]) if seat["deck"] else None,
                "counts": {z: len(zones[z]) for z in ZONES},
                "poison": seat["poison"],
                "opening": seat["opening"],
                # Topo do grimório sempre revelado: todos veem a carta de cima
                "top_revealed": bool(seat.get("top_revealed")),
                "top": card(zones["library"][0]) if seat.get("top_revealed") and zones["library"] else None,
                "cmd_damage": dict(seat["cmd_damage"]),
                "tax": {cid: n for cid, n in seat["tax"].items() if n},
                # Vagas da zona do comandante (quantos comandantes o deck tem)
                "commanders": min(MAX_CMD_SLOTS, sum(1 for c in cards.values() if c.get("commander") and not c.get("token"))),
            }
            for z in ("graveyard", "exile", "command"):
                p[z] = [card(cid) for cid in zones[z]]
            players.append((seat, p))
        dealt = [
            {"position": e["position"], "player": e["player"], "deck": e["deck"], "claimed": bool(e.get("claimed"))}
            for e in self.data["dealt"]
        ]
        share = {
            "boards": boards,
            "players": players,
            "dealt": dealt,
            "log": list(self.data["log"][-100:]),  # registros não mudam depois de escritos
            "turn": dict(self.data["turn"]),
            "result": dict(self.data["result"]) if self.data["result"] else None,
            "spectators": sorted((name for name, _ in self.spectators.values()), key=str.casefold),
        }
        self._share, self._share_gen = share, gen
        return share

    def view(self, viewer_id: int, gen: int | None = None) -> dict:
        """
        O que este jogador vê: a mão e a pilha virada só dele; cartas viradas para baixo dos outros
        sem a frente. `gen` (número da atualização) reaproveita a parte comum entre os jogadores.
        """
        sh = self._shared_view(gen)
        field = {
            b: [
                hidden if hidden is not None and viewer_id not in (owner, controller) else shown
                for shown, hidden, owner, controller in items
            ]
            for b, items in sh["boards"].items()
        }
        players = []
        for seat, base in sh["players"]:
            mine = seat["user_id"] == viewer_id
            p = {**base, "battlefield": field.get(seat["user_id"], [])}
            # A mão também aparece para quem o dono escolheu mostrar (a pilha virada, só para ele)
            sees_hand = mine or viewer_id in (seat.get("hand_shown") or ())
            for z in PRIVATE_ZONES:
                allowed = sees_hand if z == "hand" else mine
                p[z] = [self._card_obj(seat, cid) for cid in seat["zones"][z]] if allowed else None
            players.append(p)
        return {
            "code": self.code,
            "max_seats": MAX_SEATS,
            "players": players,
            "log": sh["log"],
            "dealt": sh["dealt"],
            "turn": sh["turn"],
            "result": sh["result"],
            "spectators": sh["spectators"],
            "undo": self.undo_view(viewer_id),
            "control": self.control_view(viewer_id),
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
            "spectators": len(self.spectators),
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


@functools.lru_cache(maxsize=512)
def _stat_int_text(value: str) -> int | None:
    if not value.strip():
        return None
    digits = "".join(ch for ch in value.split("+")[0] if ch.isdigit() or ch == "-")
    try:
        return int(digits)
    except ValueError:
        return 0


def _stat_int(value) -> int | None:
    """"3" → 3, "*" ou "1+*" → só a parte numérica (0 se não houver); vazio → None. (Com cache: roda
    para cada carta do campo a cada atualização.)"""
    return _stat_int_text(value) if isinstance(value, str) else None


def _base_stats(card: dict) -> dict | None:
    p, t = _stat_int(card.get("power")), _stat_int(card.get("toughness"))
    return {"p": p, "t": t} if p is not None and t is not None else None


def _field_card(item: dict, c: dict, owner: dict, controller, found: dict, hidden: bool) -> dict:
    """Uma carta do campo como os jogadores veem (cópia: nada aponta para a mesa)."""
    if hidden:
        face = {"id": item["id"], "name": "", "image": "", "back": ""}
    elif item.get("flipped") and c["back"]:
        face = {"id": item["id"], "name": c["name"], "image": c["back"], "back": c["image"]}
    else:
        face = {"id": item["id"], "name": c["name"], "image": c["image"], "back": c["back"]}
    stats = item.get("stats")
    return {
        **face,
        "x": item["x"],
        "y": item["y"],
        "tapped": item["tapped"],
        "counters": dict(item["counters"]),
        "stats": dict(stats) if stats else stats,
        "base": None if hidden else _base_stats(c),
        "token": bool(c.get("token")),
        "helper": bool(c.get("helper")),
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
        "attach": None if hidden else c.get("attach"),
        "symbols": _symbols(item),
        "slot": item.get("slot"),
    }


def _short(value) -> str:
    return value[:8] if isinstance(value, str) else ""


def _symbols(item: dict) -> list[str]:
    """Símbolos da carta (mesas antigas guardavam um só, em "symbol")."""
    if "symbols" in item:
        return list(item["symbols"])
    return [item["symbol"]] if item.get("symbol") else []


def _is_num(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _card_kind(type_line: str) -> str | None:
    """Terreno, criatura (inclui veículo, que costuma ir para a linha de frente) ou outra permanente."""
    if not type_line:
        return None  # sem o tipo: adivinha depois pela força/resistência
    front = type_line.split(" // ")[0]
    if "Creature" in front or "Vehicle" in front:
        return "creature"
    if "Land" in front:
        return "land"
    return "other"


CARD_TYPES = ("Creature", "Artifact", "Enchantment", "Planeswalker", "Instant", "Sorcery", "Land", "Battle")


def _card_types(type_line: str) -> list[str]:
    """Tipos da frente da carta (para filtrar o cemitério, o exílio...): ["creature", "artifact"]."""
    front = (type_line or "").split(" // ")[0].split(" — ")[0]
    return [t.lower() for t in CARD_TYPES if t in front]


def _zone_card(cid: str, c: dict) -> dict:
    """Carta numa zona pública (cemitério, exílio, comando) ou revelada."""
    obj = {"id": cid, "name": c["name"], "image": c["image"], "back": c["back"], "attach": c.get("attach")}
    if c.get("types"):
        obj["types"] = list(c["types"])
    return obj


def _kind_of(card: dict | None, item: dict | None = None) -> str:
    """Tipo guardado na carta; mesas antigas (sem o tipo) adivinham pela força/resistência."""
    if not card:
        return "other"
    if card.get("kind"):
        return card["kind"]
    if (item and item.get("stats")) or _base_stats(card):
        return "creature"
    if card.get("name") in BASIC_LANDS:
        return "land"
    return "other"


def _attach_kind(type_line: str) -> str | None:
    """Equipamento ou aura (pelo tipo da carta): dá para prender em outra carta do campo."""
    front = (type_line or "").split(" // ")[0]
    if "Equipment" in front:
        return "equipment"
    if "Aura" in front:
        return "aura"
    return None


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
    """Comandantes na zona do comandante (o quadro no canto do campo), parceiros lado a lado."""
    items = [_field_item(cid, CMD_X, 0.0, (cards or {}).get(cid)) for cid in ids]
    for k, item in enumerate(items):
        item["slot"] = min(k, MAX_CMD_SLOTS - 1)
    return items


def _clamp01(value, default: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return round(max(0.0, min(1.0, float(value))), 4)


TABLES: dict[str, Table] = {}
