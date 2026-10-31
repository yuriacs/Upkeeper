"""
Fila "Achar partida": quem entra escolhe o tamanho (2 ou 4 jogadores), o bracket e o estilo de
jogo ("qualquer" vale para os dois). Quando juntam jogadores compatíveis para uma mesa, ela abre
sozinha com todos já sentados (cheia: ninguém de fora senta) e cada um vai para ela na próxima
consulta da página (tables/views.py, queue).

Fica só na memória do processo, como a presença (accounts/presence.py): o servidor roda um
processo só e a fila vale por poucos minutos; um reinício a esvazia. Quem para de consultar (fechou
o site) sai sozinho depois de STALE segundos.
"""

import threading
import time

from . import state

SIZES = (2, 4)
BRACKETS = (1, 2, 3, 4, 5)
STALE = 45  # sem consultar há isso: saiu do site, sai da fila
MATCH_KEEP = 5 * 60  # a mesa achada fica avisada por esse tempo

_lock = threading.Lock()
_waiting: dict[int, dict] = {}  # conta → {"name", "size", "bracket", "style", "since", "seen"}
_matched: dict[int, tuple[str, float]] = {}  # conta → (código da mesa, quando)


def _clean(now: float) -> None:
    for uid in [u for u, e in _waiting.items() if now - e["seen"] > STALE]:
        del _waiting[uid]
    for uid in [u for u, (_, at) in _matched.items() if now - at > MATCH_KEEP]:
        del _matched[uid]


def _fits(want, have) -> bool:
    return want is None or have is None or want == have


def _group(entries: list[tuple[int, dict]], size: int) -> list[int] | None:
    """O primeiro grupo de `size` compatíveis, a partir de quem espera há mais tempo."""
    for i, (first, entry) in enumerate(entries):
        bracket, style, members = entry["bracket"], entry["style"], [first]
        for other, e in entries[i + 1:]:
            if _fits(bracket, e["bracket"]) and _fits(style, e["style"]):
                members.append(other)
                bracket, style = bracket or e["bracket"], style or e["style"]
                if len(members) == size:
                    return members
    return None


def _open_table(members: list[int]) -> str:
    """Abre a mesa com todos sentados (mesma ordem da fila) e grava no banco, como a restaurada."""
    from .models import TableGame, TableSeat
    from .views import _new_code

    first = _waiting[members[0]]
    bracket = next((_waiting[u]["bracket"] for u in members if _waiting[u]["bracket"]), None)
    style = next((_waiting[u]["style"] for u in members if _waiting[u]["style"]), None)
    setup = state.table_setup({"players": first["size"], "style": style, "max_bracket": bracket}, members[0])
    code = _new_code()
    data = state.new_table(code, None, setup)
    for n, uid in enumerate(members, start=1):
        data["seats"][str(uid)] = state.new_seat(uid, _waiting[uid]["name"], n)
    TableGame.objects.filter(code=code).delete()
    TableGame.objects.create(code=code, data=data)
    TableSeat.objects.bulk_create(TableSeat(table_id=code, user_id=uid) for uid in members)
    return code


def _match(now: float) -> None:
    for size in SIZES:
        while True:
            entries = sorted(((u, e) for u, e in _waiting.items() if e["size"] == size), key=lambda x: x[1]["since"])
            members = _group(entries, size)
            if members is None:
                break
            try:
                state.check_new_table(members[0], own=False)  # mesa da fila não conta como de ninguém
            except state.ServerFull:
                return  # servidor cheio: continuam na fila até abrir lugar
            code = _open_table(members)
            for uid in members:
                del _waiting[uid]
                _matched[uid] = (code, now)


def join(user, size, bracket, style) -> None:
    """Entra (ou troca as escolhas) na fila. Escolha inválida vira "qualquer"; tamanho inválido, 4."""
    size = size if size in SIZES else 4
    bracket = bracket if bracket in BRACKETS and not isinstance(bracket, bool) else None
    style = style if style in state.PLAYSTYLES else None
    now = time.time()
    with _lock:
        _clean(now)  # quem já saiu do site não entra em mesa nova
        _matched.pop(user.id, None)
        old = _waiting.get(user.id)
        _waiting[user.id] = {"name": user.username, "size": size, "bracket": bracket, "style": style,
                             "since": old["since"] if old else now, "seen": now}
        _match(now)


def leave(user_id: int) -> None:
    with _lock:
        _waiting.pop(user_id, None)
        _matched.pop(user_id, None)


def status(user_id: int | None) -> dict:
    """
    Para a página: a sua entrada na fila (ou a mesa achada) e quantos esperam em cada combinação
    (sem nomes), para avisar no site que tem gente procurando partida.
    """
    now = time.time()
    with _lock:
        _clean(now)
        mine = _waiting.get(user_id) if user_id else None
        if mine:
            mine["seen"] = now
        match = _matched.get(user_id)[0] if user_id in _matched else None
        groups: dict[tuple, int] = {}
        for uid, e in _waiting.items():
            if uid != user_id:
                key = (e["size"], e["bracket"], e["style"])
                groups[key] = groups.get(key, 0) + 1
    return {
        "mine": {k: mine[k] for k in ("size", "bracket", "style")} | {"waited": int(now - mine["since"])} if mine else None,
        "match": match,
        "waiting": [
            {"size": size, "bracket": bracket, "style": style, "count": n}
            for (size, bracket, style), n in sorted(groups.items(), key=lambda x: -x[1])
        ],
    }


def reset() -> None:
    """Testes."""
    with _lock:
        _waiting.clear()
        _matched.clear()
