"""Helper HTTP mínimo (sem dependências extras) com User-Agent identificado."""

import gzip
import json
import urllib.request

USER_AGENT = "ChooseAtRandom/0.1 (+https://github.com/)"


def fetch_json(url: str, *, data: dict | None = None, timeout: int = 60):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if body else {}),
        },
        method="POST" if body else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        raw = res.read()
    if url.endswith(".gz"):
        raw = gzip.decompress(raw)
    return json.loads(raw)
