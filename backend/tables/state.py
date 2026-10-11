"""
Estado das mesas virtuais (Fase 1 do roadmap).

Cada mesa é um dicionário simples (vira JSON para salvar no Postgres a cada ação, ver
tables/store.py). Ele fica na memória do processo: no Render gratuito roda um processo só,
então todas as conexões de uma mesa caem no mesmo lugar e não precisa de Redis.

Tudo aqui é síncrono e roda no loop de eventos sem `await` no meio: cada ação é atômica.

O servidor não conhece as regras do Magic. Ele só garante que cada jogador mexe nas próprias
cartas e que ninguém vê o que não deve (mão, grimório e pilha virada dos outros).
"""

import re
import secrets
import time

MAX_SEATS = 4
STARTING_LIFE = 40
LIFE_LIMIT = 999
IDLE_TTL = 2 * 60 * 60  # mesa sem ninguém conectado sai da memória depois de 2 horas
LOG_SIZE = 80
CODE_RE = re.compile(r"^[A-Z0-9]{4,12}$")

ZONES = ("library", "hand", "battlefield", "graveyard", "exile", "command", "facedown")
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


def new_table(code: str) -> dict:
    return {"code": code, "next_id": 1, "seats": {}, "log": []}


def empty_zones() -> dict:
    return {z: [] for z in ZONES}


class Table:
    """Envolve o dicionário da mesa com as ações. `online` (conexões abertas) não é salvo."""

    def __init__(self, data: dict):
        self.data = data
        self.online: dict[int, int] = {}
        # Mesas salvas antes de existir o comandante no campo: tira da zona de comando
        for seat in data["seats"].values():
            if seat["zones"]["command"]:
                seat["zones"]["battlefield"].extend(_commanders_on_field(seat["zones"]["command"]))
                seat["zones"]["command"] = []
        self.touched = time.monotonic()

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

    def _log(self, seat: dict, kind: str, **extra) -> None:
        entry = {"kind": kind, "who": seat["name"], "seat": seat["seat"], **extra}
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
            seat = seats[str(user_id)] = {
                "user_id": user_id,
                "name": name,
                "seat": free[0],
                "life": STARTING_LIFE,
                "deck": None,
                "cards": {},
                "zones": empty_zones(),
            }
            self._log(seat, "joined")
        self.online[user_id] = self.online.get(user_id, 0) + 1
        self.touched = time.monotonic()
        return seat

    def leave(self, user_id: int) -> None:
        if user_id in self.online:
            self.online[user_id] = max(0, self.online[user_id] - 1)
        self.touched = time.monotonic()

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
                cid = f"c{self.data['next_id']}"
                self.data["next_id"] += 1
                cards[cid] = {
                    "name": row["name"],
                    "image": row["image"],
                    "back": row.get("back", ""),
                    "commander": bool(row["is_commander"]),
                }
                (commanders if row["is_commander"] else zones["library"]).append(cid)
        _random.shuffle(zones["library"])
        zones["battlefield"] = _commanders_on_field(commanders)
        seat.update(cards=cards, zones=zones, deck=deck, life=STARTING_LIFE)
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
        seat = self._require(user_id)
        if to not in ZONES:
            raise ActionError("bad_zone")
        frm, idx = self._find(seat, card_id)
        zones = seat["zones"]
        if frm == "battlefield" and to == "battlefield":
            # Só reposiciona no campo (arrastar a carta)
            item = zones["battlefield"][idx]
            item["x"], item["y"] = _clamp01(x, item["x"]), _clamp01(y, item["y"])
            return
        zones[frm].pop(idx)
        if to == "battlefield":
            zones["battlefield"].append({"id": card_id, "x": _clamp01(x, 0.5), "y": _clamp01(y, 0.5), "tapped": False})
        elif to == "library":
            if position == "bottom":
                zones["library"].append(card_id)
            else:
                zones["library"].insert(0, card_id)
        else:
            zones[to].append(card_id)
        # O nome só vai para o log se a carta saiu ou entrou numa zona que todos veem
        public = frm in PUBLIC_ZONES or to in PUBLIC_ZONES
        self._log(
            seat,
            "move",
            card=self._card_name(seat, card_id) if public else None,
            frm=frm,
            to=to,
            position=position if to == "library" else None,
        )

    def tap(self, user_id: int, card_id: str) -> None:
        seat = self._require(user_id)
        frm, idx = self._find(seat, card_id)
        if frm != "battlefield":
            raise ActionError("not_on_battlefield")
        item = seat["zones"]["battlefield"][idx]
        item["tapped"] = not item["tapped"]
        self._log(seat, "tap" if item["tapped"] else "untap", card=self._card_name(seat, card_id))

    def untap_all(self, user_id: int) -> None:
        seat = self._require(user_id)
        for item in seat["zones"]["battlefield"]:
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
        all_ids = [item["id"] if isinstance(item, dict) else item for items in seat["zones"].values() for item in items]
        zones = empty_zones()
        commanders = [cid for cid in all_ids if seat["cards"][cid].get("commander")]
        zones["library"] = [cid for cid in all_ids if cid not in set(commanders)]
        zones["battlefield"] = _commanders_on_field(commanders)
        _random.shuffle(zones["library"])
        seat["zones"], seat["life"] = zones, STARTING_LIFE
        self._log(seat, "restart")

    def change_life(self, user_id: int, delta: int) -> None:
        """Cada jogador mexe só na própria vida, como numa mesa física."""
        seat = self._require(user_id)
        before = seat["life"]
        seat["life"] = max(-LIFE_LIMIT, min(LIFE_LIMIT, before + delta))
        self._log(seat, "life", frm=before, to=seat["life"])

    # ---- o que cada jogador vê -----------------------------------------------------------

    def view(self, viewer_id: int) -> dict:
        players = []
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
                "battlefield": [{**card(i["id"]), "x": i["x"], "y": i["y"], "tapped": i["tapped"]} for i in zones["battlefield"]],
            }
            for z in ("graveyard", "exile", "command"):
                p[z] = [card(cid) for cid in zones[z]]
            for z in PRIVATE_ZONES:
                p[z] = [card(cid) for cid in zones[z]] if mine else None
            players.append(p)
        return {"code": self.code, "max_seats": MAX_SEATS, "players": players, "log": self.data["log"][-50:]}


def _commanders_on_field(ids: list[str]) -> list[dict]:
    """Comandantes no canto de cima à direita do campo, lado a lado (parceiros)."""
    return [{"id": cid, "x": round(1 - i * 0.09, 4), "y": 0.0, "tapped": False} for i, cid in enumerate(ids)]


def _clamp01(value, default: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return round(max(0.0, min(1.0, float(value))), 4)


TABLES: dict[str, Table] = {}


def prune(now: float | None = None) -> None:
    now = now if now is not None else time.monotonic()
    for code in [c for c, t in TABLES.items() if not t.is_online() and now - t.touched > IDLE_TTL]:
        del TABLES[code]
