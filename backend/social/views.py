"""
API do painel das redes (/painel/social), só para quem administra o site:

GET  feed/                  dados da semana e o precon do dia (social/feed.py)
GET  posts/?status=draft    a fila de posts
POST posts/                 post escrito à mão ({network, kind, lang, text, slides})
POST posts/generate/        rascunhos a partir do feed ({kind, network: instagram|x|both, lang})
PATCH/DELETE posts/<id>/    editar (texto, imagens, agendamento, estado) ou apagar

Curadoria do Instagram (social/curation.py):
GET  creators/              perfis monitorados
POST creators/              cadastrar ({handles: "@a, @b c"}: vários de uma vez, separados por vírgula ou espaço)
PATCH/DELETE creators/<id>/ monitorar, autorizou repost, como autorizou; ou remover
GET  requests/              posts bons de quem ainda não autorizou, com a mensagem pronta para a DM
POST requests/<id>/grant/   o autor autorizou: legenda, mídia no Cloudinary e repost na fila
POST requests/<id>/skip/    descartar o pedido
"""

import re


from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from . import curation, drafts
from .clients import ServiceError
from .feed import week_feed
from .models import Creator, SocialPost, SourcePost


class SocialPostSerializer(serializers.ModelSerializer):
    # Repost da curadoria: de onde veio (para conferir antes de aprovar)
    source_url = serializers.CharField(source="source.url", read_only=True, default="")
    source_handle = serializers.CharField(source="source.creator.handle", read_only=True, default="")

    class Meta:
        model = SocialPost
        fields = [
            "id", "network", "kind", "lang", "status", "text", "slides", "media_url", "media_type",
            "source_url", "source_handle", "error", "scheduled_for", "published_at", "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["media_url", "media_type", "error", "published_at", "created_at", "updated_at"]

    def validate_slides(self, value):
        if not isinstance(value, list) or len(value) > 10 or not all(isinstance(s, dict) for s in value):
            raise serializers.ValidationError("up to 10 slides")
        return value

    def validate_lang(self, value):
        if value not in ("pt", "en"):
            raise serializers.ValidationError("pt or en")
        return value


@api_view(["GET"])
@permission_classes([IsAdminUser])
def feed(request):
    days = request.query_params.get("days", "7")
    return Response(week_feed(int(days) if days.isdigit() and 1 <= int(days) <= 90 else 7))


@api_view(["GET", "POST"])
@permission_classes([IsAdminUser])
def posts(request):
    if request.method == "GET":
        qs = SocialPost.objects.select_related("source__creator")
        wanted = request.query_params.get("status")
        if wanted in SocialPost.Status.values:
            qs = qs.filter(status=wanted)
        return Response(SocialPostSerializer(qs[:100], many=True).data)
    ser = SocialPostSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    ser.save(created_by=request.user)
    return Response(ser.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAdminUser])
def generate(request):
    kind = request.data.get("kind")
    network = request.data.get("network", "both")
    lang = "en" if request.data.get("lang") == "en" else "pt"
    if kind not in drafts.KINDS or network not in ("instagram", "x", "both"):
        return Response({"detail": "bad_request"}, status=status.HTTP_400_BAD_REQUEST)
    data = week_feed()
    created = []
    for net in ("instagram", "x") if network == "both" else (network,):
        try:
            text, slides = drafts.build(kind, net, lang, data)
        except drafts.NothingToPost:
            return Response({"detail": "nothing_to_post", "code": "nothing_to_post"}, status=status.HTTP_409_CONFLICT)
        created.append(
            SocialPost.objects.create(network=net, kind=kind, lang=lang, text=text, slides=slides, created_by=request.user)
        )
    return Response(SocialPostSerializer(created, many=True).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAdminUser])
def post_detail(request, pk: int):
    post = SocialPost.objects.filter(pk=pk).first()
    if post is None:
        return Response(status=status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        post.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    ser = SocialPostSerializer(post, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    new_status = ser.validated_data.get("status")
    extra = {}
    if new_status == SocialPost.Status.PUBLISHED and post.status != SocialPost.Status.PUBLISHED:
        extra["published_at"] = timezone.now()
    elif new_status and new_status != SocialPost.Status.PUBLISHED:
        extra["published_at"] = None
    ser.save(**extra)
    return Response(ser.data)


class CreatorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Creator
        fields = ["id", "handle", "active", "followers", "authorized", "authorized_at", "authorization_note"]
        read_only_fields = ["handle", "followers", "authorized_at"]


class RequestSerializer(serializers.ModelSerializer):
    handle = serializers.CharField(source="creator.handle")

    class Meta:
        model = SourcePost
        fields = [
            "id", "handle", "url", "media_type", "caption", "likes", "comments", "engagement", "outlier",
            "posted_at", "note", "permission_message",
        ]  # fmt: skip


@api_view(["GET", "POST"])
@permission_classes([IsAdminUser])
def creators(request):
    if request.method == "POST":
        handles = {Creator.clean_handle(h) for h in re.split(r"[\s,;]+", str(request.data.get("handles", "")))}
        handles = {h for h in handles if re.fullmatch(r"[a-z0-9._]{1,30}", h)}
        if not handles:
            return Response({"detail": "bad_request"}, status=status.HTTP_400_BAD_REQUEST)
        for h in handles:
            Creator.objects.get_or_create(handle=h)
    return Response(CreatorSerializer(Creator.objects.all(), many=True).data)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAdminUser])
def creator_detail(request, pk: int):
    creator = Creator.objects.filter(pk=pk).first()
    if creator is None:
        return Response(status=status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        creator.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    ser = CreatorSerializer(creator, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    if "authorized" in ser.validated_data:
        creator.set_authorized(ser.validated_data.pop("authorized"))
    ser.save()
    return Response(ser.data)


@api_view(["GET"])
@permission_classes([IsAdminUser])
def requests(request):
    qs = SourcePost.objects.filter(status=SourcePost.Status.ASK).select_related("creator").order_by("-outlier")
    return Response(RequestSerializer(qs[:50], many=True).data)


@api_view(["POST"])
@permission_classes([IsAdminUser])
def request_action(request, pk: int, action: str):
    sp = SourcePost.objects.filter(pk=pk, status=SourcePost.Status.ASK).select_related("creator").first()
    if sp is None:
        return Response(status=status.HTTP_404_NOT_FOUND)
    if action == "skip":
        sp.status, sp.note = SourcePost.Status.SKIPPED, "descartado no painel"
        sp.save(update_fields=["status", "note"])
        return Response(status=status.HTTP_204_NO_CONTENT)
    try:
        post = curation.grant(sp)
    except ServiceError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    return Response(SocialPostSerializer(post).data, status=status.HTTP_201_CREATED)
