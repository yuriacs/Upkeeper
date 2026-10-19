from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from config.throttles import DeckImportThrottle
from decks.models import Deck

from .models import OwnedPrecon, UserDeck, UserDeckCard
from .serializers import SlugListSerializer, UserDeckDetailSerializer, UserDeckSummarySerializer, UserDeckWriteSerializer
from .services.decklist import DecklistError
from decks.services.analysis import refresh_power
from decks.services.brackets import ensure_bracket, refresh_bracket
from decks.services.prices import ensure_price, update_deck_price

from .services.import_deck import save_user_deck


def _detail_qs():
    return UserDeck.objects.select_related("owner", "face_commander").prefetch_related(
        Prefetch("deck_cards", queryset=UserDeckCard.objects.select_related("card"))
    )


def _owned_slugs(user):
    return list(OwnedPrecon.objects.filter(user=user).values_list("deck__slug", flat=True))


# --- Precons que o usuário tem --------------------------------------------------------------

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def my_precons(request):
    """GET: slugs dos precons do usuário. POST {"slugs": [...]}: adiciona vários (ex.: migrar do navegador)."""
    if request.method == "POST":
        ser = SlugListSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        decks = Deck.objects.filter(slug__in=ser.validated_data["slugs"])
        OwnedPrecon.objects.bulk_create(
            [OwnedPrecon(user=request.user, deck=d) for d in decks], ignore_conflicts=True
        )
    return Response({"slugs": _owned_slugs(request.user)})


@api_view(["PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def my_precon(request, slug):
    deck = get_object_or_404(Deck, slug=slug)
    if request.method == "PUT":
        OwnedPrecon.objects.get_or_create(user=request.user, deck=deck)
    else:
        OwnedPrecon.objects.filter(user=request.user, deck=deck).delete()
    return Response({"slugs": _owned_slugs(request.user)})


# --- Decks montados pelo usuário -----------------------------------------------------------

def _save(request, deck=None):
    ser = UserDeckWriteSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    try:
        saved, warnings = save_user_deck(
            request.user,
            ser.validated_data["name"],
            ser.validated_data["decklist"],
            commanders=ser.validated_data.get("commanders"),
            deck=deck,
        )
    except DecklistError as exc:
        return Response({"detail": str(exc), "errors": exc.details}, status=status.HTTP_400_BAD_REQUEST)
    # Fora da transação da importação; se o Spellbook falhar, o bracket fica para depois,
    # mas o nível de poder sai na hora (sem bracket, conta como 2)
    if not refresh_bracket(saved):
        refresh_power(saved)
    # Cartas novas vêm com o preço da própria edição: busca já a edição mais barata de cada uma
    update_deck_price(saved)
    data = UserDeckDetailSerializer(_detail_qs().get(pk=saved.pk)).data
    return Response({**data, "warnings": warnings}, status=status.HTTP_200_OK if deck else status.HTTP_201_CREATED)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([DeckImportThrottle])
def my_decks(request):
    if request.method == "POST":
        return _save(request)
    decks = UserDeck.objects.filter(owner=request.user).select_related("owner", "face_commander")
    return Response(UserDeckSummarySerializer(decks, many=True).data)


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
@throttle_classes([DeckImportThrottle])
def my_deck(request, pk):
    deck = get_object_or_404(UserDeck, pk=pk, owner=request.user)
    if request.method == "DELETE":
        deck.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    if request.method == "PUT":
        return _save(request, deck)
    deck = _detail_qs().get(pk=deck.pk)
    ensure_bracket(deck)
    if ensure_price(deck):
        deck = _detail_qs().get(pk=deck.pk)
    return Response(UserDeckDetailSerializer(deck).data)


@api_view(["GET"])
@permission_classes([AllowAny])
def user_deck_public(request, pk):
    """Qualquer pessoa pode ver um deck de usuário (ele aparece nos resultados de sorteio)."""
    deck = get_object_or_404(_detail_qs(), pk=pk)
    ensure_bracket(deck)
    if ensure_price(deck):
        deck = _detail_qs().get(pk=deck.pk)
    data = UserDeckDetailSerializer(deck).data
    data.pop("decklist_text", None)
    return Response(data)


MAX_FAVORITES = 500


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_favorites(request):
    """Cartas favoritas do deckbuilder (oracle ids, a mais recente primeiro)."""
    from .models import FavoriteCard

    ids = FavoriteCard.objects.filter(user=request.user).values_list("oracle_id", flat=True)
    return Response({"oracle_ids": [str(i) for i in ids], "max": MAX_FAVORITES})


@api_view(["PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def my_favorite(request, oracle_id):
    """PUT marca a carta como favorita; DELETE tira."""
    from .models import FavoriteCard

    if request.method == "DELETE":
        FavoriteCard.objects.filter(user=request.user, oracle_id=oracle_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    mine = FavoriteCard.objects.filter(user=request.user)
    if not mine.filter(oracle_id=oracle_id).exists():
        if mine.count() >= MAX_FAVORITES:
            return Response({"detail": "too_many", "code": "too_many"}, status=status.HTTP_400_BAD_REQUEST)
        FavoriteCard.objects.get_or_create(user=request.user, oracle_id=oracle_id)
    return Response(status=status.HTTP_204_NO_CONTENT)
