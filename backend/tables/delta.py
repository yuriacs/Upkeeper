"""
Atualizações menores pela rede: em vez de mandar a mesa inteira a cada ação (~90 KB com 4
jogadores e o campo cheio), cada conexão recebe só o que mudou desde a última mensagem dela.

A conexão guarda a última visão enviada; `diff(antes, depois)` devolve um "delta":
- campos do topo que mudaram (turno, resultado, desfazer...);
- `log_add`: registros novos do log (os registros nunca mudam depois de escritos);
- `players`: por jogador, só os campos que mudaram; no campo de batalha, só as cartas
  alteradas (`bf_set`), as que saíram (`bf_del`) e a ordem nova (`bf_order`) quando muda;
- `order`: a ordem dos jogadores, quando alguém senta.

O cliente aplica o delta sobre o estado que já tem (frontend/src/hooks/useTableSocket.ts).
`rev` numera as mensagens da conexão: se o cliente perder a conta, pede a mesa inteira de novo.
"""

TOP_SKIP = {"players", "log"}
# Vai sempre, mesmo igual ao anterior: o cliente usa para recomeçar a contagem até fechar a mesa
# (depois de cada ação o tempo volta a 600 s, que é o mesmo valor já enviado antes)
ALWAYS = {"idle_left"}


def diff(before: dict, after: dict) -> dict:
    out: dict = {}
    for key, value in after.items():
        if key in TOP_SKIP:
            continue
        if key in ALWAYS or before.get(key) != value:
            out[key] = value

    last = before["log"][-1]["id"] if before.get("log") else 0
    added = [e for e in after["log"] if e["id"] > last]
    if added:
        out["log_add"] = added

    prev = {p["id"]: p for p in before.get("players", [])}
    order = [p["id"] for p in after["players"]]
    if order != [p["id"] for p in before.get("players", [])]:
        out["order"] = order
    players = {}
    for p in after["players"]:
        old = prev.get(p["id"])
        if old is None:
            players[str(p["id"])] = {"full": p}
            continue
        change = _player_diff(old, p)
        if change:
            players[str(p["id"])] = change
    if players:
        out["players"] = players
    return out


def _player_diff(old: dict, new: dict) -> dict:
    change: dict = {}
    for key, value in new.items():
        if key == "battlefield":
            continue
        if old.get(key) != value:
            change[key] = value
    old_bf = {c["id"]: c for c in old.get("battlefield", [])}
    new_ids = [c["id"] for c in new["battlefield"]]
    changed = [c for c in new["battlefield"] if old_bf.get(c["id"]) != c]
    still = set(new_ids)
    removed = [cid for cid in old_bf if cid not in still]
    if changed:
        change["bf_set"] = changed
    if removed:
        change["bf_del"] = removed
    if new_ids != [c["id"] for c in old.get("battlefield", [])]:
        change["bf_order"] = new_ids
    return change
