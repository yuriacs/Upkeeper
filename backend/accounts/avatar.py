"""
Foto de perfil: aparece para os outros jogadores (mesa, perfil público), então fica legível no
servidor, como o nome de usuário (PRIVACIDADE.md, "Adicionando um dado novo ao perfil", item 2).
É opcional e some com "Remover foto" ou ao excluir a conta.

O arquivo nunca é guardado como veio: o Pillow confere que é imagem, descarta os metadados (EXIF
pode ter a localização da foto), recorta um quadrado no centro (256 px) e salva em WebP. Cada envio
ganha um endereço novo (chave aleatória), então o navegador pode guardar a imagem para sempre.
"""

import time

from django.conf import settings

SIZE = 256
_CACHE: dict[str, tuple[float, bytes]] = {}
_CACHE_MAX = 300
# Cada processo guarda as próprias cópias: com validade curta, uma foto escondida pelo admin
# (accounts/moderation.py) para de sair também pelos outros workers
CACHE_SECONDS = 600


def avatar_url(user) -> str | None:
    """Endereço público da foto do usuário (None sem foto)."""
    from .models import Avatar

    key = Avatar.objects.filter(user=user, hidden_at__isnull=True).values_list("key", flat=True).first()
    return url_for(key) if key else None


def url_for(key) -> str:
    return f"{settings.PUBLIC_API_BASE}/api/avatar/{key}/"


def forget(key) -> None:
    _CACHE.pop(str(key), None)


def cached_image(key) -> bytes | None:
    from .models import Avatar

    k = str(key)
    hit = _CACHE.get(k)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    row = Avatar.objects.filter(key=key, hidden_at__isnull=True).only("image").first()
    if row is None:
        _CACHE.pop(k, None)
        return None
    data = bytes(row.image)
    if k not in _CACHE and len(_CACHE) >= _CACHE_MAX:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[k] = (time.monotonic(), data)
    return data
