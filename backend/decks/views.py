from django.db.models import Count, Prefetch
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.filters import OrderingFilter
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from config.throttles import DrawThrottle

from .filters import DeckFilter
from .models import Deck, DeckCard, Draw, DrawEntry, Edition
from .services.draw import DrawError, create_draw
from .serializers import (
    DeckDetailSerializer,
    DeckListSerializer,
    DrawRequestSerializer,
    DrawSerializer,
    EditionSerializer,
)


@api_view(["GET"])
def health(request):
    """Usado pelo frontend (e pelo host de deploy) para saber se a API está de pé."""
    return Response({"status": "ok", "service": "choose-at-random-api"})


class DeckPagination(PageNumberPagination):
    page_size = 24
    page_size_query_param = "page_size"
    max_page_size = 200


class EditionViewSet(viewsets.ReadOnlyModelViewSet):
    """Edições que têm pelo menos um precon (para os filtros do catálogo)."""

    serializer_class = EditionSerializer
    pagination_class = None
    lookup_field = "code"

    def get_queryset(self):
        return (
            Edition.objects.annotate(deck_count=Count("decks"))
            .filter(deck_count__gt=0)
            .order_by("-release_date", "name")
        )


class DeckViewSet(viewsets.ReadOnlyModelViewSet):
    lookup_field = "slug"
    pagination_class = DeckPagination
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_class = DeckFilter
    ordering_fields = ["release_date", "name"]
    ordering = ["-release_date", "name"]

    def get_queryset(self):
        qs = Deck.objects.select_related("edition", "face_commander")
        if self.action == "retrieve":
            qs = qs.prefetch_related(
                Prefetch("deck_cards", queryset=DeckCard.objects.select_related("card"))
            )
        return qs

    def get_serializer_class(self):
        return DeckDetailSerializer if self.action == "retrieve" else DeckListSerializer


def _draw_queryset():
    return Draw.objects.prefetch_related(
        Prefetch(
            "entries",
            queryset=DrawEntry.objects.select_related(
                "deck__edition", "deck__face_commander", "owner",
                "user_deck__owner", "user_deck__face_commander",
            ),
        )
    )


@api_view(["POST"])
@throttle_classes([DrawThrottle])
def draw(request):
    """
    Sorteia decks distintos e salva o resultado com um código curto para compartilhar.

    Corpo: {"names": ["Ana", "Beto", "Caio"], "filters": {"year_from": 2020, "color_rule": "distinct",
            "same_edition": false, "editions": ["C21"], "deck_slugs": [...], "no_repeat": false}}
    Também aceita {"players": 3} sem nomes (vira "Jogador 1", "Jogador 2"...).
    O modo deckpool só existe nas salas (/api/rooms/).
    """
    req = DrawRequestSerializer(data=request.data)
    req.is_valid(raise_exception=True)
    data = req.validated_data
    creator = request.user if request.user.is_authenticated else None
    if data["mode"] == Draw.Mode.POOL:
        # Na deckpool, cada jogador entra na sala com a própria conta — ninguém coloca outra
        # pessoa na mesa (nem mexe no histórico dela) sem ela participar.
        return Response(
            {"detail": "O sorteio por deckpool acontece nas salas online: crie uma sala e chame os jogadores."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        result = create_draw(data["names"], data["filters"], creator=creator)
    except DrawError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(DrawSerializer(_draw_queryset().get(pk=result.pk)).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def draw_detail(request, code):
    """Resultado salvo de um sorteio (link compartilhável)."""
    obj = _draw_queryset().filter(code=code.lower()).first()
    if obj is None:
        return Response({"detail": "Sorteio não encontrado."}, status=status.HTTP_404_NOT_FOUND)
    return Response(DrawSerializer(obj).data)
