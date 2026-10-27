from django.core.cache import cache
import datetime
import uuid

from django.db.models import Count, Prefetch, Q, F
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.filters import OrderingFilter
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from config.throttles import DrawThrottle

from .filters import DeckFilter
from django.utils import timezone

from .models import Deck, DeckCard, Draw, DrawEntry, Edition
from .permissions import can_set_result
from .services import stats
from .services.brackets import ensure_bracket
from .services.prices import ensure_price
from .services.draw import DrawError, create_draw, random_precon
from .serializers import (
    DeckDetailSerializer,
    DeckListSerializer,
    DrawRequestSerializer,
    DrawResultSerializer,
    DrawSerializer,
    EditionSerializer,
)
from django.utils.translation import gettext as _

# Artes de capa: só precons a partir desta data
ARTS_SINCE = datetime.date(2020, 1, 1)


@api_view(["GET"])
def health(request):
    """Usado pelo frontend (e pelo host de deploy) para saber se a API está de pé."""
    # table_version: versão do protocolo da mesa virtual (ajuda a conferir se o deploy subiu).
    # Mesa virtual travada (fila de banco sem responder, ver tables/watchdog.py): 503, para o
    # health check do Render reiniciar o serviço.
    from tables import watchdog

    ok = watchdog.healthy()
    return Response(
        {"status": "ok" if ok else "tables_stuck", "service": "upkeeper-api", "table_version": 2},
        status=200 if ok else 503,
    )


@api_view(["GET"])
def commander_arts(request):
    """
    Só as artes dos comandantes, para a roleta e o topo da página inicial.
    Bem mais leve que a lista de decks (~200 URLs) e guardado em cache por 10 minutos.
    Só entram precons de 2020 em diante: as artes antigas destoam do visual do site.
    """
    data = cache.get("commander-arts:v3")
    if data is None:
        base = (
            Deck.objects.filter(is_active=True)
            .exclude(face_commander__image_art_crop="")
            .exclude(face_commander__isnull=True)
        )
        recent = base.filter(
            Q(release_date__gte=ARTS_SINCE) | Q(release_date__isnull=True, edition__release_date__gte=ARTS_SINCE)
        )
        fields = ("face_commander__image_art_crop", "face_commander__name")
        # Sem nenhum deck recente com data (banco novo), usa todos para a página não ficar sem arte
        rows = list(recent.values_list(*fields)) or list(base.values_list(*fields))
        data = {
            "arts": [art for art, _ in rows],
            # Para o crédito da arte no topo da página inicial
            "items": [{"art": art, "commander": name.split(" // ")[0]} for art, name in rows],
        }
        cache.set("commander-arts:v3", data, 600)
    return Response(data)


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


class NullsLastOrdering(OrderingFilter):
    """Ordenação em que decks sem valor (preço, nível de poder ainda não calculados) vão para o fim."""

    def filter_queryset(self, request, queryset, view):
        ordering = self.get_ordering(request, queryset, view)
        if not ordering:
            return queryset
        return queryset.order_by(
            *[F(o[1:]).desc(nulls_last=True) if o.startswith("-") else F(o).asc(nulls_last=True) for o in ordering]
        )


class DeckViewSet(viewsets.ReadOnlyModelViewSet):
    lookup_field = "slug"
    pagination_class = DeckPagination
    filter_backends = [DjangoFilterBackend, NullsLastOrdering]
    filterset_class = DeckFilter
    ordering_fields = ["release_date", "name", "power", "price_usd"]
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

    def retrieve(self, request, *args, **kwargs):
        deck = self.get_object()
        ensure_bracket(deck)
        if ensure_price(deck):  # preços atualizados: recarrega as cartas com os valores novos
            deck = self.get_object()
        return Response(self.get_serializer(deck).data)


def _int_param(params, name: str, low: int, high: int) -> int | None:
    value = params.get(name, "")
    return int(value) if value.isdigit() and low <= int(value) <= high else None


@api_view(["GET"])
@permission_classes([AllowAny])
@throttle_classes([DrawThrottle])
def random_deck(request):
    """
    Um precon ao acaso para jogar na mesa virtual. Parâmetros (todos opcionais): bracket, price e
    tutors (as regras da mesa), colors (WUBRG: o deck tem pelo menos essas cores) e exclude (slugs
    separados por vírgula). Nenhum serve: 404 {"detail": "no_deck"}.
    """
    p = request.query_params
    colors = "".join(c for c in "WUBRG" if c in p.get("colors", "").upper())
    exclude = [s.strip() for s in p.get("exclude", "").split(",") if s.strip()][:50]
    found = random_precon(
        max_bracket=_int_param(p, "bracket", 1, 5),
        max_price=_int_param(p, "price", 1, 100_000),
        max_tutors=_int_param(p, "tutors", 0, 99),
        colors=colors,
        exclude=exclude,
    )
    if found is None:
        return Response({"detail": "no_deck"}, status=status.HTTP_404_NOT_FOUND)
    deck, pool = found
    return Response({"deck": DeckListSerializer(deck).data, "pool": pool})


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


def my_draws_queryset(user):
    """Entradas do jogador com o sorteio e toda a mesa já carregados (para MyDrawSerializer)."""
    return (
        DrawEntry.objects.filter(player=user)
        .select_related("draw", "deck__edition", "deck__face_commander", "user_deck__owner", "user_deck__face_commander")
        .prefetch_related(
            Prefetch(
                "draw__entries",
                queryset=DrawEntry.objects.select_related(
                    "deck__edition", "deck__face_commander", "owner", "user_deck__owner", "user_deck__face_commander"
                ),
            )
        )
        .order_by("-draw__created_at", "-pk")
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
            {"detail": _("Deck pool deals happen in online rooms: create a room and invite the players.")},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        result = create_draw(data["names"], data["filters"], creator=creator)
    except DrawError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    data = DrawSerializer(_draw_queryset().get(pk=result.pk), context={"request": request}).data
    # Sem conta, este token é o que permite marcar o vencedor depois (o navegador guarda)
    return Response({**data, "manage_token": result.manage_token}, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def draw_detail(request, code):
    """Resultado salvo de um sorteio (link compartilhável)."""
    obj = _draw_queryset().filter(code=code.lower()).first()
    if obj is None:
        return Response({"detail": _("Deal not found.")}, status=status.HTTP_404_NOT_FOUND)
    return Response(DrawSerializer(obj, context={"request": request}).data)


@api_view(["POST"])
@throttle_classes([DrawThrottle])
def draw_result(request, code):
    """
    Marca (ou desfaz) o vencedor da partida: {"winner": <posição>} ou {"winner": null}.
    Ver decks.permissions.can_set_result para quem pode.
    """
    obj = _draw_queryset().filter(code=code.lower()).first()
    if obj is None:
        return Response({"detail": "Sorteio não encontrado."}, status=status.HTTP_404_NOT_FOUND)
    if not can_set_result(request, obj):
        return Response(
            {"detail": _("Only players at the table (or whoever created the deal) can mark the winner.")},
            status=status.HTTP_403_FORBIDDEN,
        )
    ser = DrawResultSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    winner = ser.validated_data["winner"]
    if winner is not None and winner not in {e.position for e in obj.entries.all()}:
        return Response({"winner": [_("Invalid player.")]}, status=status.HTTP_400_BAD_REQUEST)
    obj.winner_position = winner
    obj.result_at = timezone.now() if winner is not None else None
    obj.save(update_fields=["winner_position", "result_at"])
    stats.invalidate()
    return Response(DrawSerializer(obj, context={"request": request}).data)


@api_view(["POST"])
@permission_classes([AllowAny])
def card_roles(request):
    """
    Função das cartas (ramp, compra, remoção...) para o deckbuilder agrupar a lista.
    POST {"cards": [{"oracle_id", "name"}]} (até 300) → {"roles": {oracle_id: ["ramp", "draw"]}}.
    Vem das tags do Scryfall (OracleTag) e da lista de mana rápida da análise.
    """
    from .models import OracleTag
    from .services.analysis import FAST_MANA

    cards = request.data.get("cards") if isinstance(request.data, dict) else None
    if not isinstance(cards, list) or len(cards) > 300:
        return Response({"detail": "bad_request"}, status=status.HTTP_400_BAD_REQUEST)
    ids, names = set(), {}
    for c in cards:
        oid = str(c.get("oracle_id") or "") if isinstance(c, dict) else ""
        try:
            uuid.UUID(oid)
        except ValueError:
            continue
        ids.add(oid)
        names[oid] = str(c.get("name") or "")
    roles: dict[str, list[str]] = {oid: [] for oid in ids}
    for oid, tag in OracleTag.objects.filter(oracle_id__in=ids).values_list("oracle_id", "tag"):
        roles[str(oid)].append(tag)
    for oid, name in names.items():
        if name.split(" // ")[0] in FAST_MANA:
            roles[oid].append("fast_mana")
    return Response({"roles": roles})


@api_view(["GET"])
def stats_overview(request):
    """
    Rankings gerais: decks com mais vitórias, melhores taxas, mais azarados e jogadores.
    ?source=draws (partidas de decks sorteados, o padrão) ou ?source=tables (mesas sem sorteio).
    """
    return Response(stats.global_stats(request.query_params.get("source", "draws")))
