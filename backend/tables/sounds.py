"""
Soundboard da mesa (como o do Discord): sons fixos que só o admin envia. Na mesa, um jogador toca um
som e ele sai para todos (registro "sound"); cada um pode mutar no próprio navegador.

A lista e os arquivos ficam na memória depois da primeira leitura: tocar um som na mesa não consulta
o banco (o Neon pode dormir). Mudou algo pelo painel do admin, o cache é jogado fora. O arquivo sai
por /api/sounds/<chave>/ com cache de um ano: trocar o áudio = enviar outro som (chave nova).
"""

import threading

MAX_BYTES = 512 * 1024  # como no Discord
MAX_SOUNDS = 120
NAME_MAX = 32
EMOJI_MAX = 16

_lock = threading.Lock()
_catalog: list[dict] | None = None
_audio: dict[str, tuple[bytes, str]] = {}


def sniff(data: bytes) -> str | None:
    """Tipo do áudio pelos primeiros bytes (não confia no que o navegador diz)."""
    if data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        return "audio/mpeg"
    if data[:4] == b"OggS":
        return "audio/ogg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav"
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return "audio/webm"
    if data[4:8] == b"ftyp":
        return "audio/mp4"
    return None


def url(key) -> str:
    return f"/api/sounds/{key}/"


def catalog() -> list[dict]:
    """Os sons, na ordem do admin: [{"id", "name", "emoji", "url"}]."""
    global _catalog
    with _lock:
        if _catalog is not None:
            return _catalog
    from .models import SoundClip

    rows = [
        {"id": str(s["key"]), "name": s["name"], "emoji": s["emoji"], "url": url(s["key"])}
        for s in SoundClip.objects.order_by("position", "name", "id").values("key", "name", "emoji")
    ]
    with _lock:
        _catalog = rows
    return rows


def entry(key) -> dict | None:
    key = str(key or "")
    return next((s for s in catalog() if s["id"] == key), None)


def audio(key) -> tuple[bytes, str] | None:
    key = str(key)
    with _lock:
        if key in _audio:
            return _audio[key]
    from .models import SoundClip

    row = SoundClip.objects.filter(key=key).values_list("audio", "content_type").first()
    if row is None:
        return None
    found = (bytes(row[0]), row[1])
    with _lock:
        _audio[key] = found
    return found


def forget() -> None:
    """O admin mudou a lista: relê na próxima vez."""
    global _catalog
    with _lock:
        _catalog = None
        _audio.clear()
