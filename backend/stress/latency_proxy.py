"""
Proxy TCP que atrasa os pacotes: simula a distância entre o Render e o Neon num Postgres local.

    python stress/latency_proxy.py --listen 5434 --target 127.0.0.1:5433 --rtt 20

`--rtt` é o tempo de ida e volta em milissegundos (metade em cada sentido).
"""

import argparse
import asyncio
import time


async def pipe(reader, writer, delay):
    queue: asyncio.Queue = asyncio.Queue()

    async def send():
        while True:
            when, data = await queue.get()
            if data is None:
                break
            wait = when - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            writer.write(data)
            await writer.drain()
        writer.close()

    sender = asyncio.ensure_future(send())
    try:
        while data := await reader.read(65536):
            queue.put_nowait((time.monotonic() + delay, data))
    except ConnectionError:
        pass
    queue.put_nowait((0, None))
    await sender


async def main(listen, target, rtt):
    host, port = target.split(":")
    delay = rtt / 2000

    async def handle(client_r, client_w):
        server_r, server_w = await asyncio.open_connection(host, int(port))
        await asyncio.gather(pipe(client_r, server_w, delay), pipe(server_r, client_w, delay), return_exceptions=True)

    server = await asyncio.start_server(handle, "127.0.0.1", listen)
    print(f"proxy :{listen} → {target} com {rtt} ms de ida e volta", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--listen", type=int, default=5434)
    ap.add_argument("--target", default="127.0.0.1:5433")
    ap.add_argument("--rtt", type=float, default=20)
    a = ap.parse_args()
    asyncio.run(main(a.listen, a.target, a.rtt))
