"""
Soundboard: a lista e os arquivos (públicos, para quem está na mesa) e o painel do admin, que é o
único lugar onde se envia, renomeia, reordena e apaga som (tables/sounds.py).
"""

import uuid

from django.db import transaction
from django.db.models import Max
from django.http import Http404, HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response

from . import sounds
from .models import SoundClip


def _error(code: str, http=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": code, "code": code}, status=http)


@api_view(["GET"])
@permission_classes([AllowAny])
def sound_list(request):
    return Response({"sounds": sounds.catalog()})


def sound_file(request, key):
    found = sounds.audio(key)
    if found is None:
        raise Http404
    data, content_type = found
    response = HttpResponse(data, content_type=content_type)
    response["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


def _clean_name(value) -> str:
    return " ".join(str(value or "").split())[: sounds.NAME_MAX]


def _clean_emoji(value) -> str:
    return str(value or "").strip()[: sounds.EMOJI_MAX]


def _admin_row(s: SoundClip) -> dict:
    return {
        "id": str(s.key),
        "name": s.name,
        "emoji": s.emoji,
        "url": sounds.url(s.key),
        "size": s.size,
        "position": s.position,
        "created_at": s.created_at.isoformat(),
    }


@api_view(["GET", "POST"])
@permission_classes([IsAdminUser])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def admin_sounds(request):
    """GET: todos os sons. POST (multipart: file, name, emoji): envia um som novo, no fim da lista."""
    if request.method == "GET":
        return Response({"sounds": [_admin_row(s) for s in SoundClip.objects.order_by("position", "name", "id")]})
    upload = request.FILES.get("file")
    name = _clean_name(request.data.get("name"))
    if upload is None:
        return _error("no_file")
    if not name:
        return _error("no_name")
    if upload.size > sounds.MAX_BYTES:
        return _error("too_big")
    if SoundClip.objects.count() >= sounds.MAX_SOUNDS:
        return _error("too_many")
    data = upload.read(sounds.MAX_BYTES + 1)
    content_type = sounds.sniff(data)
    if len(data) > sounds.MAX_BYTES:
        return _error("too_big")
    if content_type is None:
        return _error("not_audio")
    with transaction.atomic():
        last = SoundClip.objects.aggregate(m=Max("position"))["m"]
        clip = SoundClip.objects.create(
            key=uuid.uuid4(),
            name=name,
            emoji=_clean_emoji(request.data.get("emoji")),
            audio=data,
            content_type=content_type,
            size=len(data),
            position=(last or 0) + 1,
        )
    sounds.forget()
    return Response(_admin_row(clip), status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAdminUser])
def admin_sound(request, key):
    """PATCH {name?, emoji?, position?}: muda o som. DELETE: apaga."""
    clip = SoundClip.objects.filter(key=key).first()
    if clip is None:
        raise Http404
    if request.method == "DELETE":
        clip.delete()
        sounds.forget()
        return Response(status=status.HTTP_204_NO_CONTENT)
    fields = []
    if "name" in request.data:
        name = _clean_name(request.data["name"])
        if not name:
            return _error("no_name")
        clip.name = name
        fields.append("name")
    if "emoji" in request.data:
        clip.emoji = _clean_emoji(request.data["emoji"])
        fields.append("emoji")
    if "position" in request.data:
        try:
            clip.position = max(0, min(10_000, int(request.data["position"])))
        except (TypeError, ValueError):
            return _error("bad_position")
        fields.append("position")
    if fields:
        clip.save(update_fields=fields)
        sounds.forget()
    return Response(_admin_row(clip))
