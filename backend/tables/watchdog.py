"""
Vigia da fila de banco da mesa virtual.

O Channels roda toda mensagem do WebSocket passando antes por uma única thread de banco
(close_old_connections, "thread_sensitive"). Se uma consulta ficar pendurada nessa thread (ex.:
conexão com o Neon que caiu sem avisar), nenhuma mesa responde mais: todo mundo fica em
"Conectando…", enquanto o resto do site (HTTP, em outras threads) segue normal.

A cada 20 s o vigia manda uma tarefa vazia para essa thread. Se ela não voltar:
- depois de STUCK_UNHEALTHY segundos, /api/health/ passa a responder 503 (o Render reinicia o
  serviço se o health check estiver configurado);
- depois de STUCK_EXIT segundos, o processo sai e o Render sobe outro na hora (as mesas voltam do
  banco; perde-se no máximo o que não foi gravado nos últimos segundos).
"""

import asyncio
import logging
import os
import time

from asgiref.sync import sync_to_async

log = logging.getLogger(__name__)

EVERY = 20
PROBE_TIMEOUT = 15
STUCK_UNHEALTHY = 45
STUCK_EXIT = int(os.environ.get("TABLE_STUCK_EXIT", "90"))

_task: asyncio.Task | None = None
# Desde quando a thread de banco não responde (None = respondendo)
stuck_since: float | None = None


def _noop() -> None:
    return None


def ensure_watchdog() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.ensure_future(_loop())


async def probe() -> bool:
    """True se a thread de banco respondeu a tempo."""
    global stuck_since
    try:
        await asyncio.wait_for(sync_to_async(_noop, thread_sensitive=True)(), PROBE_TIMEOUT)
    except asyncio.TimeoutError:
        if stuck_since is None:
            stuck_since = time.time() - PROBE_TIMEOUT
            log.error("Fila de banco da mesa virtual sem responder")
        return False
    if stuck_since is not None:
        log.warning("Fila de banco da mesa virtual voltou depois de %.0f s", time.time() - stuck_since)
    stuck_since = None
    return True


def healthy(now: float | None = None) -> bool:
    now = now if now is not None else time.time()
    return stuck_since is None or now - stuck_since < STUCK_UNHEALTHY


async def _loop() -> None:
    while True:
        await asyncio.sleep(EVERY)
        if not await probe() and stuck_since is not None and time.time() - stuck_since >= STUCK_EXIT:
            log.critical("Fila de banco travada há %.0f s: reiniciando o processo", time.time() - stuck_since)
            os._exit(3)  # o Render sobe o serviço de novo
