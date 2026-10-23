"""
Moderação das imagens que os jogadores enviam e os outros veem: foto de perfil (accounts/avatar.py),
artes personalizadas de cartas e fichas (pools/services/card_art.py), fundo da mesa dos apoiadores
e sleeve com imagem dos Fundadores (accounts/supporter.py).

Qualquer jogador denuncia a imagem de outra pessoa pelo endereço dela; as denúncias abertas
formam uma fila no painel de admin (uma linha por imagem). O admin descarta ou esconde a imagem:
escondida, o endereço dá 404 e as cartas voltam à imagem original (a cadeira, ao ícone). Junto,
pode bloquear novos envios daquela conta (UploadBlock).
"""

import re

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from .models import Avatar, ImageReport, Playmat, SleeveArt, UploadBlock

_UUID = r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
_URL = re.compile(re.escape(settings.PUBLIC_API_BASE) + r"/api/(avatar|card-art|playmat|sleeve)/" + _UUID + "/")
_KINDS = {
    "avatar": ImageReport.Kind.AVATAR,
    "card-art": ImageReport.Kind.ART,
    "playmat": ImageReport.Kind.PLAYMAT,
    "sleeve": ImageReport.Kind.SLEEVE,
}


def parse_url(url) -> tuple[int, str] | None:
    """Endereço de uma imagem enviada → (tipo, chave). None se não for imagem de jogador deste site."""
    m = _URL.fullmatch(url) if isinstance(url, str) else None
    return (_KINDS[m.group(1)], m.group(2)) if m else None


def url_for(kind: int, key) -> str:
    from pools.services.card_art import art_url

    from . import avatar, supporter

    if kind == ImageReport.Kind.PLAYMAT:
        return supporter.playmat_url_for(key)
    if kind == ImageReport.Kind.SLEEVE:
        return supporter.sleeve_url_for(key)
    return avatar.url_for(key) if kind == ImageReport.Kind.AVATAR else art_url(key)


def owner_id(kind: int, key) -> int | None:
    """Dono da imagem (se ela existe e não foi escondida)."""
    if kind == ImageReport.Kind.AVATAR:
        qs = Avatar.objects.filter(key=key, hidden_at__isnull=True).values_list("user_id", flat=True)
    elif kind == ImageReport.Kind.PLAYMAT:
        qs = Playmat.objects.filter(key=key, hidden_at__isnull=True).values_list("user_id", flat=True)
    elif kind == ImageReport.Kind.SLEEVE:
        qs = SleeveArt.objects.filter(key=key, hidden_at__isnull=True).values_list("user_id", flat=True)
    else:
        from pools.models import CardArt

        qs = CardArt.objects.filter(key=key, hidden_at__isnull=True).values_list("owner_id", flat=True)
    return qs.first()


def hide(kind: int, key) -> None:
    """Esconde a imagem para todos (404) e tira dos caches em memória."""
    now = timezone.now()
    if kind == ImageReport.Kind.AVATAR:
        from . import avatar

        for user_id in Avatar.objects.filter(key=key).values_list("user_id", flat=True):
            cache.delete(f"profile:{user_id}")
        Avatar.objects.filter(key=key).update(hidden_at=now)
        avatar.forget(key)
    elif kind == ImageReport.Kind.PLAYMAT:
        from . import supporter

        Playmat.objects.filter(key=key).update(hidden_at=now)
        supporter.forget_playmat(key)
    elif kind == ImageReport.Kind.SLEEVE:
        from . import supporter

        SleeveArt.objects.filter(key=key).update(hidden_at=now)
        supporter.forget_sleeve(key)
    else:
        from pools.models import CardArt
        from pools.views import forget_art

        CardArt.objects.filter(key=key).update(hidden_at=now)
        forget_art(key)


def uploads_blocked(user) -> bool:
    return UploadBlock.objects.filter(user=user).exists()
