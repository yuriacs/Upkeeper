"""Helper HTTP mínimo (sem dependências extras) com User-Agent identificado."""

import gzip
import json
import urllib.request

USER_AGENT = "Upkeeper/0.1 (+https://www.upkeeper.online)"
GZIP_MAGIC = bytes([0x1F, 0x8B])


def fetch_json(url: str, *, data: dict | None = None, timeout: int = 60):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            # Sem isso o Scryfall manda o JSON cru: compactado, cada lote vem várias vezes menor
            "Accept-Encoding": "gzip",
            **({"Content-Type": "application/json"} if body else {}),
        },
        method="POST" if body else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        raw = res.read()
        encoding = res.headers.get("Content-Encoding", "")
    if encoding == "gzip":
        raw = gzip.decompress(raw)
    if url.endswith(".gz") and raw.startswith(GZIP_MAGIC):  # arquivo .gz do MTGJSON
        raw = gzip.decompress(raw)
    return json.loads(raw)
