"""
Mesas em andamento, guardadas na memória do processo (Fase 0 do roadmap da mesa virtual).

No Render gratuito roda um processo só (uvicorn), então todas as conexões de uma mesa caem
no mesmo processo e um dicionário basta: sem Redis. Tudo aqui é síncrono e roda no loop de
eventos sem `await` no meio, então cada operação é atômica.

Se o servidor reiniciar, as mesas somem: salvar no Postgres entra na Fase 1.
"""

import re
import time
from dataclasses import dataclass, field

MAX_SEATS = 4
STARTING_LIFE = 40
LIFE_LIMIT = 999
IDLE_TTL = 2 * 60 * 60  # mesa sem ninguém conectado some depois de 2 horas
CODE_RE = re.compile(r"^[A-Z0-9]{4,12}$")


@dataclass
class Seat:
    user_id: int
    name: str
    seat: int
    life: int = STARTING_LIFE
    connections: int = 0  # o mesmo jogador pode estar em duas abas


@dataclass
class Table:
    code: str
    seats: dict[int, Seat] = field(default_factory=dict)  # por user_id
    touched: float = field(default_factory=time.monotonic)

    def snapshot(self) -> dict:
        players = sorted(self.seats.values(), key=lambda s: s.seat)
        return {
            "code": self.code,
            "max_seats": MAX_SEATS,
            "players": [
                {"id": s.user_id, "name": s.name, "seat": s.seat, "life": s.life, "online": s.connections > 0}
                for s in players
            ],
        }

    def online(self) -> bool:
        return any(s.connections for s in self.seats.values())


TABLES: dict[str, Table] = {}


class TableFull(Exception):
    pass


def valid_code(code: str) -> bool:
    return bool(CODE_RE.match(code))


def prune(now: float | None = None) -> None:
    now = now if now is not None else time.monotonic()
    for code in [c for c, t in TABLES.items() if not t.online() and now - t.touched > IDLE_TTL]:
        del TABLES[code]


def join(code: str, user_id: int, name: str) -> Table:
    """Senta o jogador (ou devolve a cadeira que já era dele). Levanta TableFull sem lugar."""
    prune()
    table = TABLES.setdefault(code, Table(code))
    seat = table.seats.get(user_id)
    if seat is None:
        taken = {s.seat for s in table.seats.values()}
        free = [n for n in range(1, MAX_SEATS + 1) if n not in taken]
        if not free:
            raise TableFull
        seat = table.seats[user_id] = Seat(user_id=user_id, name=name, seat=free[0])
    seat.connections += 1
    table.touched = time.monotonic()
    return table


def leave(code: str, user_id: int) -> Table | None:
    """Marca o jogador como desconectado. A cadeira continua dele, para poder voltar."""
    table = TABLES.get(code)
    if table and (seat := table.seats.get(user_id)):
        seat.connections = max(0, seat.connections - 1)
        table.touched = time.monotonic()
    return table


def change_life(code: str, user_id: int, delta: int) -> Table | None:
    """Cada jogador mexe só na própria vida, como numa mesa física."""
    table = TABLES.get(code)
    if table and (seat := table.seats.get(user_id)):
        seat.life = max(-LIFE_LIMIT, min(LIFE_LIMIT, seat.life + delta))
        table.touched = time.monotonic()
    return table
