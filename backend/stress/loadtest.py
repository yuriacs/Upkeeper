"""
Teste de carga da mesa virtual: abre mesas de 4 jogadores falsos que jogam como gente (comprar,
baixar carta, virar, vida, marcadores, organizar, chat...) e mede quanto tempo cada ação leva para
voltar do servidor, aumentando o número de mesas em etapas.

    python stress/loadtest.py --url ws://127.0.0.1:8000 --origin http://localhost:5199 \\
        --tokens stress_tokens.json --steps 5,10,20,40 --step-seconds 60

`--tokens`: arquivo do `manage.py stress_setup` (contas de teste e o deck). Cada jogador manda uma
ação a cada `--think` segundos em média (gente jogando de verdade: uma a cada 5-15 s; o padrão 4 s
já é uma mesa agitada). Latência = da ação saindo até a resposta dela ("ack") chegar, o que inclui
o servidor montar e mandar a mesa para os 4 jogadores.

Rodando o servidor localmente, `--pid` (processo do uvicorn) mede CPU e memória dele a cada etapa.
"""

import argparse
import asyncio
import json
import os
import random
import statistics
import string
import time

from websockets.asyncio.client import connect

HAND = 7


class Stats:
    def __init__(self):
        self.reset()
        self.disconnects = 0

    def reset(self):
        self.lat: list[float] = []
        self.by_kind: dict[str, list[float]] = {}
        self.sent = 0
        self.errors: dict[str, int] = {}
        self.bytes = 0
        self.msgs = 0
        self.timeouts = 0


STATS = Stats()


def apply_delta(state: dict, d: dict) -> None:
    """Mesmo que o cliente faz (useTableSocket.ts): aplica o delta sobre a mesa que já tem."""
    for key, value in d.items():
        if key in ("type", "rev", "ack", "log_add", "players", "order"):
            continue
        state[key] = value
    if d.get("log_add"):
        state["log"] = (state.get("log") or []) + d["log_add"]
    players = {str(p["id"]): p for p in state.get("players", [])}
    for pid, change in (d.get("players") or {}).items():
        if "full" in change:
            players[pid] = change["full"]
            continue
        p = players.get(pid)
        if p is None:
            continue
        bf = {c["id"]: c for c in p.get("battlefield", [])}
        for c in change.get("bf_set", []):
            bf[c["id"]] = c
        for cid in change.get("bf_del", []):
            bf.pop(cid, None)
        order = change.get("bf_order") or [c["id"] for c in p.get("battlefield", []) if c["id"] in bf] + [
            cid for cid in bf if cid not in {c["id"] for c in p.get("battlefield", [])}
        ]
        p["battlefield"] = [bf[cid] for cid in order if cid in bf]
        for key, value in change.items():
            if key not in ("bf_set", "bf_del", "bf_order"):
                p[key] = value
    order = d.get("order") or [p["id"] for p in state.get("players", []) if str(p["id"]) in players]
    known = {str(i) for i in order}
    state["players"] = [players[str(i)] for i in order if str(i) in players] + [
        p for k, p in players.items() if k not in known
    ]


class Bot:
    def __init__(self, args, code, user, deck):
        self.args, self.code, self.user, self.deck = args, code, user, deck
        self.state: dict | None = None
        self.rev = 0
        self.cid = 0
        self.pending: dict[int, tuple[float, str]] = {}
        self.ws = None
        self.stop = False

    def me(self):
        return next((p for p in (self.state or {}).get("players", []) if p["id"] == self.user["id"]), None)

    async def send(self, msg: dict):
        self.cid += 1
        msg["cid"] = self.cid
        self.pending[self.cid] = (time.monotonic(), msg["type"])
        STATS.sent += 1
        await self.ws.send(json.dumps(msg))

    async def run(self):
        url = f"{self.args.url}/ws/tables/{self.code}/"
        try:
            async with connect(url, origin=self.args.origin, max_size=None, open_timeout=30) as ws:
                self.ws = ws
                await ws.send(json.dumps({"type": "auth", "token": self.user["token"], "delta": True}))
                reader = asyncio.ensure_future(self.read())
                await self.wait_state()
                me = self.me()
                if me and not me.get("deck"):
                    await self.send({"type": "load_deck", "kind": "precon", "ref": self.deck})
                    await asyncio.sleep(1)
                    await self.send({"type": "draw", "n": HAND})
                while not self.stop and not reader.done():
                    await asyncio.sleep(random.expovariate(1 / self.args.think))
                    await self.act()
                reader.cancel()
        except Exception as e:  # conexão caiu, servidor recusou...
            STATS.disconnects += 1
            if self.args.verbose:
                print(f"[{self.code}/{self.user['name']}] {type(e).__name__}: {e}")

    async def wait_state(self):
        for _ in range(600):
            if self.state is not None:
                return
            await asyncio.sleep(0.05)
        raise TimeoutError("a mesa não chegou")

    async def read(self):
        try:
            await self._read()
        except Exception as e:  # conexão fechada pelo servidor (sobrecarga, mesa encerrada...)
            STATS.disconnects += 1
            if self.args.verbose:
                print(f"[{self.code}/{self.user['name']}] leitura: {type(e).__name__}: {e}")

    async def _read(self):
        async for raw in self.ws:
            STATS.bytes += len(raw)
            STATS.msgs += 1
            msg = json.loads(raw)
            kind = msg.get("type")
            ack = msg.get("ack")
            if ack:
                now = time.monotonic()
                for cid in [c for c in self.pending if c <= ack]:
                    sent, kind_sent = self.pending.pop(cid)
                    STATS.lat.append(now - sent)
                    STATS.by_kind.setdefault(kind_sent, []).append(now - sent)
            if kind == "state":
                self.state, self.rev = msg, msg["rev"]
            elif kind == "delta":
                if self.state is None or msg["rev"] != self.rev + 1:
                    self.state = None
                    await self.ws.send(json.dumps({"type": "resync"}))
                    continue
                apply_delta(self.state, msg)
                self.rev = msg["rev"]
            elif kind == "error":
                STATS.errors[msg.get("code", "?")] = STATS.errors.get(msg.get("code", "?"), 0) + 1
            elif kind == "closed":
                return

    async def act(self):
        # Ação sem resposta há muito tempo: conta como perdida (não fica para sempre na conta)
        now = time.monotonic()
        for cid in [c for c, (t, _) in self.pending.items() if now - t > 30]:
            self.pending.pop(cid)
            STATS.timeouts += 1
        me = self.me()
        if me is None or not me.get("deck"):
            return
        hand = me.get("hand") or []
        field = [c for c in me.get("battlefield", []) if (c.get("controller") or c["owner"]) == self.user["id"]]
        creatures = [c for c in field if c.get("stats")]
        r = random.random
        options = [
            (2, lambda: {"type": "draw", "n": 1}) if me["counts"]["library"] else (1, lambda: {"type": "restart"}),
            (4, lambda: {"type": "move", "card": random.choice(hand)["id"], "to": "battlefield", "x": r(), "y": r()})
            if hand
            else None,
            (5, lambda: {"type": "tap", "card": random.choice(field)["id"]}) if field else None,
            (1.5, lambda: {"type": "move", "card": random.choice(field)["id"], "to": "battlefield", "x": r(), "y": r()})
            if field
            else None,
            (0.8, lambda: {"type": "move", "card": random.choice(field)["id"], "to": "graveyard"}) if field else None,
            (2, lambda: {"type": "life", "delta": random.choice([-3, -2, -1, 1])}),
            (1, lambda: {"type": "counter", "card": random.choice(creatures)["id"], "kind": "+1/+1", "delta": 1})
            if creatures
            else None,
            (0.3, lambda: {"type": "arrange"}),
            (0.6, lambda: {"type": "untap_all"}),
            (0.5, lambda: {"type": "pass_turn"}),
            (0.5, lambda: {"type": "chat", "text": "gg " + "".join(random.choices(string.ascii_lowercase, k=12))}),
            (0.3, lambda: {"type": "roll", "sides": 20}),
        ]
        options = [o for o in options if o]
        weight, make = random.choices(options, weights=[o[0] for o in options])[0]
        await self.send(make())


def pct(values, p):
    if not values:
        return float("nan")
    values = sorted(values)
    return values[min(len(values) - 1, int(len(values) * p))]


def proc_stats(pid):
    """CPU (segundos usados) e memória (MB) do processo, lidos do /proc."""
    if not pid:
        return None
    try:
        with open(f"/proc/{pid}/stat") as f:
            parts = f.read().split(")")[-1].split()
        ticks = os.sysconf("SC_CLK_TCK")
        cpu = (int(parts[11]) + int(parts[12])) / ticks
        with open(f"/proc/{pid}/status") as f:
            rss = next(int(line.split()[1]) for line in f if line.startswith("VmRSS")) / 1024
        return cpu, rss
    except (OSError, StopIteration):
        return None


async def main(args):
    data = json.load(open(args.tokens))
    users, deck = data["users"], data["deck"]
    steps = [int(s) for s in args.steps.split(",")]
    if steps[-1] * 4 > len(users):
        raise SystemExit(f"contas insuficientes: {steps[-1]} mesas precisam de {steps[-1] * 4} (há {len(users)})")
    run_id = "".join(random.choices(string.ascii_uppercase, k=3))
    bots: list[Bot] = []
    tasks = []
    rows = []
    print(
        f"{'mesas':>5} {'jog.':>5} {'ações/s':>8} {'p50 ms':>7} {'p95 ms':>7} {'p99 ms':>7} {'máx ms':>7} "
        f"{'erros':>6} {'perdidas':>8} {'quedas':>6} {'KB/s':>7} {'CPU %':>6} {'RAM MB':>7}"
    )
    for n in steps:
        while len(bots) < n * 4:
            t = len(bots) // 4
            code = f"ST{run_id}{t:03d}"
            for seat in range(4):
                bot = Bot(args, code, users[t * 4 + seat], deck)
                bots.append(bot)
                tasks.append(asyncio.ensure_future(bot.run()))
                await asyncio.sleep(args.ramp / 4)
        await asyncio.sleep(args.warmup)  # decks carregando, mãos compradas
        STATS.reset()
        before = proc_stats(args.pid)
        start = time.monotonic()
        await asyncio.sleep(args.step_seconds)
        took = time.monotonic() - start
        after = proc_stats(args.pid)
        cpu = (after[0] - before[0]) / took * 100 if before and after else float("nan")
        rss = after[1] if after else float("nan")
        lat = [x * 1000 for x in STATS.lat]
        row = {
            "tables": n,
            "players": len(bots),
            "actions_per_s": STATS.sent / took,
            "p50": pct(lat, 0.5),
            "p95": pct(lat, 0.95),
            "p99": pct(lat, 0.99),
            "max": max(lat) if lat else float("nan"),
            "mean": statistics.fmean(lat) if lat else float("nan"),
            "errors": dict(STATS.errors),
            "timeouts": STATS.timeouts,
            "disconnects": STATS.disconnects,
            "kb_per_s": STATS.bytes / took / 1024,
            "cpu_pct": cpu,
            "rss_mb": rss,
        }
        rows.append(row)
        print(
            f"{n:>5} {len(bots):>5} {row['actions_per_s']:>8.1f} {row['p50']:>7.0f} {row['p95']:>7.0f} "
            f"{row['p99']:>7.0f} {row['max']:>7.0f} {sum(STATS.errors.values()):>6} {STATS.timeouts:>8} "
            f"{STATS.disconnects:>6} {row['kb_per_s']:>7.0f} {cpu:>6.1f} {rss:>7.0f}",
            flush=True,
        )
        row["by_kind"] = {
            k: {"n": len(v), "p50": pct(v, 0.5) * 1000, "p95": pct(v, 0.95) * 1000} for k, v in STATS.by_kind.items()
        }
        if args.verbose:
            for k, v in sorted(row["by_kind"].items(), key=lambda kv: -kv[1]["p95"]):
                print(f"      {k:<12} n={v['n']:<5} p50={v['p50']:.0f} ms  p95={v['p95']:.0f} ms")
        if args.stop_p95 and row["p95"] > args.stop_p95:
            print(f"p95 passou de {args.stop_p95} ms: parando aqui.")
            break
    for b in bots:
        b.stop = True
    for t in tasks:
        t.cancel()
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rows, f, indent=1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="ws://127.0.0.1:8000")
    ap.add_argument("--origin", default="http://localhost:5173")
    ap.add_argument("--tokens", default="stress_tokens.json")
    ap.add_argument("--steps", default="5,10,20,40", help="número de mesas em cada etapa")
    ap.add_argument("--step-seconds", type=float, default=60)
    ap.add_argument("--warmup", type=float, default=10, help="segundos antes de medir cada etapa")
    ap.add_argument("--ramp", type=float, default=0.5, help="segundos entre abrir uma mesa e a próxima")
    ap.add_argument("--think", type=float, default=4, help="segundos, em média, entre ações de cada jogador")
    ap.add_argument("--pid", type=int, help="PID do servidor (local) para medir CPU e memória")
    ap.add_argument("--stop-p95", type=float, default=3000, help="para quando o p95 passar disso (ms); 0 = nunca")
    ap.add_argument("--out", help="grava os resultados em JSON")
    ap.add_argument("--verbose", action="store_true")
    asyncio.run(main(ap.parse_args()))
