"""
Foto de perfil: aparece para os outros jogadores (mesa, perfil público), então fica legível no
servidor, como o nome de usuário (PRIVACIDADE.md, "Adicionando um dado novo ao perfil", item 2).
É opcional e some com "Remover foto" ou ao excluir a conta.

O arquivo nunca é guardado como veio: o Pillow confere que é imagem, descarta os metadados (EXIF
pode ter a localização da foto), recorta um quadrado no centro (256 px) e salva em WebP. Cada envio
ganha um endereço novo (chave aleatória), então o navegador pode guardar a imagem para sempre.
"""

from django.conf import settings

SIZE = 256
_CACHE: dict[str, bytes] = {}
_CACHE_MAX = 300


def avatar_url(user) -> str | None:
    """Endereço público da foto do usuário (None sem foto)."""
    from .models import Avatar

    key = Avatar.objects.filter(user=user).values_list("key", flat=True).first()
    return url_for(key) if key else None


def url_for(key) -> str:
    return f"{settings.PUBLIC_API_BASE}/api/avatar/{key}/"


def forget(key) -> None:
    _CACHE.pop(str(key), None)


def cached_image(key) -> bytes | None:
    from .models import Avatar

    k = str(key)
    data = _CACHE.get(k)
    if data is None:
        row = Avatar.objects.filter(key=key).only("image").first()
        if row is None:
            return None
        data = bytes(row.image)
        if len(_CACHE) >= _CACHE_MAX:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[k] = data
    return data
