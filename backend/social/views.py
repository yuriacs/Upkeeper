"""
API do painel das redes (/painel/social), só para quem administra o site:

GET  feed/                  dados da semana e o precon do dia (social/feed.py)
GET  posts/?status=draft    a fila de posts
POST posts/                 post escrito à mão ({network, kind, lang, text, slides})
POST posts/generate/        rascunhos a partir do feed ({kind, network: instagram|x|both, lang})
PATCH/DELETE posts/<id>/    editar (texto, imagens, agendamento, estado) ou apagar
"""

from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from . import drafts
from .feed import week_feed
from .models import SocialPost


class SocialPostSerializer(serializers.ModelSerializer):
    class Meta:
        model = SocialPost
        fields = [
            "id", "network", "kind", "lang", "status", "text", "slides",
            "scheduled_for", "published_at", "created_at", "updated_at",
        ]  # fmt: skip
        read_only_fields = ["published_at", "created_at", "updated_at"]

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
        qs = SocialPost.objects.all()
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
