"""
Quem está online e convites para mesa. Fica só na memória do processo (o servidor roda um processo
só; ver Procfile): some num reinício, o que é aceitável para "online agora" e para convites que
valem por poucos minutos. Nada disso vai para o banco.

Online: a conta usou o site há pouco (o menu do site consulta os amigos a cada 30 s, o que já
conta) ou está conectada a uma mesa.
"""

import itertools
import time

ONLINE_FOR = 90  # segundos sem sinal até deixar de aparecer online
INVITE_TTL = 10 * 60  # convite some depois de 10 minutos
MAX_INVITES = 20  # por pessoa (os mais velhos saem)

_seen: dict[int, float] = {}
_invites: dict[int, list[dict]] = {}
_ids = itertools.count(1)


def touch(user_id: int) -> None:
    _seen[user_id] = time.time()


def _tables():
    from tables import state

    return [t for t in list(state.TABLES.values()) if not t.expired() and not t.data.get("closed")]


def table_of(user_id: int) -> str | None:
    """Mesa aberta em que a conta está sentada e conectada agora."""
    for t in _tables():
        if t.seat_of(user_id) and t.online.get(user_id, 0) > 0:
            return t.data["code"]
    return None


def is_online(user_id: int) -> bool:
    return time.time() - _seen.get(user_id, 0) < ONLINE_FOR or table_of(user_id) is not None


def invite(from_user, to_id: int, code: str) -> dict:
    now = time.time()
    items = [i for i in _invites.get(to_id, []) if now - i["at"] < INVITE_TTL]
    # Um convite por pessoa e mesa: convidar de novo só renova
    items = [i for i in items if not (i["from_id"] == from_user.id and i["code"] == code)]
    item = {"id": next(_ids), "from_id": from_user.id, "from": from_user.username, "code": code, "at": now}
    _invites[to_id] = (items + [item])[-MAX_INVITES:]
    return item


def invites_for(user_id: int) -> list[dict]:
    """Convites ainda valendo (mais novo primeiro), só para mesas que continuam abertas."""
    now = time.time()
    open_codes = {t.data["code"] for t in _tables()}
    items = [i for i in _invites.get(user_id, []) if now - i["at"] < INVITE_TTL and i["code"] in open_codes]
    _invites[user_id] = items
    return [
        {"id": i["id"], "from": i["from"], "code": i["code"], "age": int(now - i["at"])} for i in reversed(items)
    ]


def dismiss(user_id: int, invite_id: int) -> None:
    _invites[user_id] = [i for i in _invites.get(user_id, []) if i["id"] != invite_id]


def reset() -> None:
    """Testes."""
    _seen.clear()
    _invites.clear()
