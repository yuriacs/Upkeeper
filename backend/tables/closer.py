"""
Fechamento das mesas: por inatividade (10 minutos sem nenhuma alteração) ou por um jogador.

Uma tarefa de fundo olha as mesas da memória a cada 30 s enquanto houver alguma; quando não
sobra nenhuma ela para (o banco só é consultado quando uma mesa fecha, para o Neon poder dormir).
Mesas salvas que expiraram com o servidor parado são apagadas ao serem abertas ou listadas
(tables/store.py).
"""

import asyncio
import time

from channels.db import database_sync_to_async
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
        # Treino não conta para nada (horas, rever); conquistas só numa partida com vencedor (finish_game)
        if not table.practice:
            # Cópia da mesa para dar para restaurar a partida depois (só sem vencedor; antes de take_replay)
            resume = table.resume_data()
            # Partida que não foi encerrada com vencedor: o tempo conta até a última jogada
            await store.save_play_time(table.take_play_time(end=table.data.get("changed_at")))
            await store.save_replay(table.take_replay(), resume)
    store.cancel_save(code)
    await store.delete_table(code)
    await get_channel_layer().group_send(f"table-{code}", {"type": "table.closed", "reason": reason, "by": by})


async def broadcast(code: str, table) -> None:
    """Manda a mesa de novo para todos os conectados (o mesmo que o consumer faz após uma ação)."""
    table.gen += 1
    await get_channel_layer().group_send(f"table-{code}", {"type": "table.state"})


async def finish_game(code: str, table, by: int | None, winner: int | None, placings=None, admin: str | None = None) -> str:
    """
    Partida encerrada (confirmada por outro jogador, ou pelo admin): o resultado aparece para todos
    na hora e depois vai para o banco (sorteio de origem ou ranking das mesas, torneio, horas
    jogadas, conquistas, rever), com a mesa parada. Devolve o nome do vencedor ("" sem vencedor).
    A mesa ainda precisa ser fechada (close_table "finished").
    """
    from achievements import services as achievements

    previous = (table.data.get("result") or {}).get("record")
    position = table.end_game(by, winner, admin=admin)
    table.finishing = True
    table.mark_changed()
    await broadcast(code, table)
    try:
        if table.data["dealt"]:
            await store.save_draw_result(code, position)
        else:
            table.data["result"]["record"] = await store.save_table_result(table.data, previous)
        if (tour := table.data.get("tournament")) and winner is not None:
            # Mesa de torneio: o resultado avança a chave ou soma na classificação da liga
            await store.save_tournament_result(tour["match"], winner, placings)
        await store.save_play_time(table.take_play_time())
        # Conquistas do fim da partida: aparecem no registro antes de a mesa fechar
        table.announce(await database_sync_to_async(achievements.record_game)(table.game_summary()))
        await store.save_replay(table.take_replay())
    finally:
        table.finishing = False
    return table.data["result"]["winner_name"] or ""
