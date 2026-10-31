"""
API do painel das redes (/admin/social), só para quem administra o site:

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
POST repost/                repostar um post escolhido ({url}), de perfil que autorizou: vai para a fila
POST posts/<id>/media/      sobe uma imagem desenhada no painel ({image}: data URI JPEG/PNG) -> {url}
POST posts/<id>/publish/    publicar agora no Instagram ({text} e {media_urls} opcionais): aprova e sobe em
                            segundo plano (o vídeo leva uns minutos). Post do painel manda as imagens em
                            media_urls (1 = imagem, 2 a 10 = carrossel); repost usa a mídia que já tem
"""

import re
import threading


from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from . import curation, drafts
from . import clients
from .clients import ServiceError
from .feed import week_feed
from .models import Creator, SocialPost, SourcePost


class SocialPostSerializer(serializers.ModelSerializer):
    # Repost da curadoria: de onde veio (para conferir antes de aprovar)
    source_url = serializers.CharField(source="source.url", read_only=True, default="")
    source_handle = serializers.CharField(source="source.creator.handle", read_only=True, default="")
    source_caption = serializers.CharField(source="source.caption", read_only=True, default="")

    class Meta:
        model = SocialPost
        fields = [
            "id", "network", "kind", "lang", "status", "text", "slides", "media_url", "media_urls", "media_type",
            "source_url", "source_handle", "source_caption", "error", "scheduled_for", "published_at", "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["media_url", "media_urls", "media_type", "error", "published_at", "created_at", "updated_at"]

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
    if kind == "champion":
        from .feed import month_champion

        data["champion"] = month_champion()
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
    if new_status == SocialPost.Status.APPROVED and curation.needs_caption(ser.validated_data.get("text", post.text)):
        return Response({"detail": "write_caption", "code": "write_caption"}, status=status.HTTP_400_BAD_REQUEST)
    if new_status in (SocialPost.Status.DRAFT, SocialPost.Status.APPROVED):
        extra["error"] = ""  # voltar a rascunho ou aprovar de novo limpa o erro da última tentativa
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


@api_view(["POST"])
@permission_classes([IsAdminUser])
def repost(request):
    try:
        post = curation.repost_link(str(request.data.get("url", "")))
    except ServiceError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(SocialPostSerializer(post).data, status=status.HTTP_201_CREATED)


def _publish_in_background(pk: int):
    from django.db import close_old_connections

    try:
        post = SocialPost.objects.filter(pk=pk, status=SocialPost.Status.APPROVED).first()
        if post:
            curation.publish(post)
    finally:
        close_old_connections()


@api_view(["POST"])
@permission_classes([IsAdminUser])
def publish_now(request, pk: int):
    post = SocialPost.objects.filter(pk=pk).first()
    if post is None:
        return Response(status=status.HTTP_404_NOT_FOUND)
    if post.network != SocialPost.Network.INSTAGRAM or post.status not in (SocialPost.Status.DRAFT, SocialPost.Status.APPROVED):
        return Response({"detail": "only Instagram posts not yet published"}, status=status.HTTP_409_CONFLICT)
    urls = request.data.get("media_urls")
    if urls is not None:
        try:
            prefix = clients.hosted_prefix()
        except ServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        # Só imagens que o próprio painel subiu para o Cloudinary do Upkeeper
        if not (isinstance(urls, list) and 1 <= len(urls) <= 10
                and all(isinstance(u, str) and u.startswith(prefix) for u in urls)):
            return Response({"detail": "bad_media"}, status=status.HTTP_400_BAD_REQUEST)
        post.media_urls, post.media_type = urls, "carousel" if len(urls) > 1 else "image"
    if not (post.media_urls or post.media_url):
        return Response({"detail": "no_media"}, status=status.HTTP_400_BAD_REQUEST)
    if post.error == curation.PUBLISHING:
        return Response({"detail": "already publishing"}, status=status.HTTP_409_CONFLICT)
    text = request.data.get("text")
    text = text if isinstance(text, str) and text.strip() else post.text
    if curation.needs_caption(text):
        return Response({"detail": "write_caption", "code": "write_caption"}, status=status.HTTP_400_BAD_REQUEST)
    post.text, post.status, post.error = text[: curation.CAPTION_LIMIT], SocialPost.Status.APPROVED, ""
    post.save(update_fields=["text", "status", "error", "media_urls", "media_type", "updated_at"])
    threading.Thread(target=_publish_in_background, args=(post.pk,), name="social-publish", daemon=True).start()
    # Com corpo: o painel lê a resposta como JSON (só o 204 vem vazio)
    return Response({"detail": "publishing"}, status=status.HTTP_202_ACCEPTED)


MAX_IMAGE = 3 * 1024 * 1024  # data URI de uma imagem 1080x1350 em JPEG fica bem abaixo disso


@api_view(["POST"])
@permission_classes([IsAdminUser])
def upload_media(request, pk: int):
    post = SocialPost.objects.filter(pk=pk).first()
    if post is None:
        return Response(status=status.HTTP_404_NOT_FOUND)
    image = request.data.get("image")
    index = request.data.get("index", 0)
    if not (isinstance(image, str) and re.match(r"data:image/(jpeg|png);base64,", image) and len(image) <= MAX_IMAGE
            and isinstance(index, int) and 0 <= index < 10):
        return Response({"detail": "bad_image"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        url = clients.host_media(image, "image", f"post-{post.pk}-{index + 1}")
    except ServiceError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    return Response({"url": url}, status=status.HTTP_201_CREATED)
