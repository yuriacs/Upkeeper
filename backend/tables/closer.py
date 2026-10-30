"""
Fechamento das mesas: por inatividade (10 minutos sem nenhuma alteração) ou por um jogador.

Uma tarefa de fundo olha as mesas da memória a cada 30 s enquanto houver alguma; quando não
sobra nenhuma ela para (o banco só é consultado quando uma mesa fecha, para o Neon poder dormir).
Mesas salvas que expiraram com o servidor parado são apagadas ao serem abertas ou listadas
(tables/store.py).
"""

import asyncio
import time

from channels.layers import get_channel_layer

from . import state, store

SWEEP_EVERY = 30  # segundos
CLOSE_CODE = 4410  # código de fechamento do WebSocket: mesa encerrada

_sweeper: asyncio.Task | None = None


def ensure_sweeper() -> None:
    global _sweeper
    if _sweeper is None or _sweeper.done():
        _sweeper = asyncio.ensure_future(_loop())


async def _loop() -> None:
    while state.TABLES:
        await asyncio.sleep(SWEEP_EVERY)
        await sweep()


async def sweep(now: float | None = None) -> list[str]:
    """Fecha as mesas da memória paradas há 10 minutos. Devolve os códigos fechados."""
    now = now if now is not None else time.time()
    closed = [code for code, table in list(state.TABLES.items()) if table.expired(now)]
    for code in closed:
        await close_table(code, "idle")
    return closed


async def close_table(code: str, reason: str, by: str | None = None) -> None:
    """Tira a mesa da memória e do banco e avisa quem está conectado (eles saem com o código 4410)."""
    table = state.TABLES.pop(code, None)
    if table is not None:
        # Uma gravação que já esteja rodando em outra thread salva a marca e a mesa não volta
        table.data["closed"] = True
        # Cópia da mesa para dar para restaurar a partida depois (só sem vencedor; antes de take_replay)
        resume = table.resume_data()
        # Partida que não foi encerrada com vencedor: o tempo conta até a última jogada
        await store.save_play_time(table.take_play_time(end=table.data.get("changed_at")))
        await store.save_achievements(table.game_summary(end=table.data.get("changed_at")))
        await store.save_replay(table.take_replay(), resume)
    store.cancel_save(code)
    await store.delete_table(code)
    await get_channel_layer().group_send(f"table-{code}", {"type": "table.closed", "reason": reason, "by": by})
