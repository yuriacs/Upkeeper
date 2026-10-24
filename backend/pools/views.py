from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from config.throttles import DeckEstimateThrottle, DeckImportThrottle
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
    # Só se as cartas mudaram (renomear ou trocar categorias não muda bracket nem preço). Fora da
    # transação da importação; se o Spellbook falhar, o bracket fica para depois, mas o nível de
    # poder sai na hora (sem bracket, conta como 2). O Spellbook costuma responder do cache: o
    # deckbuilder já perguntou pela mesma lista enquanto o deck era montado.
    if saved.cards_changed:
        if not refresh_bracket(saved, cached=True):
            refresh_power(saved)
        # Cartas que entraram vêm com o preço da própria edição: busca a edição mais barata só delas
        update_deck_price(saved, only=saved.added_cards)
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


# ---- artes personalizadas das cartas (pools/services/card_art.py) ------------------------------


def _art_item(art, user=None):
    from .services.card_art import art_url

    item = {"id": str(art.key), "url": art_url(art.key), "created_at": art.created_at.isoformat()}
    if art.kind == art.TOKEN:
        item.update(name=art.name, power=art.power, toughness=art.toughness)
    if user is not None:
        item["mine"] = art.owner_id == user.pk  # só quem enviou apaga (quem foi não aparece)
    return item


def _oracle_id(value):
    import uuid as _uuid

    try:
        return _uuid.UUID(str(value))
    except ValueError:
        return None


def _usable_art(user, key, oracle_id):
    """
    A arte que alguém pode pôr numa carta: qualquer arte (de qualquer pessoa) daquela carta, ou
    uma arte sua ainda sem carta (enviada antes das artes serem por carta), que fica com ela.
    """
    from django.db.models import Q

    from .models import CardArt

    if not _is_uuid(key):
        return None
    art = (
        CardArt.objects.filter(key=str(key), kind=CardArt.ART, hidden_at__isnull=True)
        .filter(Q(oracle_id=oracle_id) | Q(owner=user, oracle_id__isnull=True))
        .first()
    )
    if art and art.oracle_id is None:
        art.oracle_id = oracle_id
        art.save(update_fields=["oracle_id"])
    return art


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def card_arts(request, oracle_id):
    """
    As artes de uma carta (de todos os usuários), as mais usadas primeiro. Junto, as suas antigas
    ainda sem carta, para poder escolhê-las.
    """
    from django.db.models import Count

    from .models import CardArt
    from .services import card_art

    shown = CardArt.objects.filter(kind=CardArt.ART, hidden_at__isnull=True).only("key", "created_at", "owner_id", "kind")
    arts = (
        shown.filter(oracle_id=oracle_id)
        .annotate(n=Count("uses", distinct=True) + Count("token_uses", distinct=True))
        .order_by("-n", "-created_at")[: card_art.MAX_PER_CARD]
    )
    loose = shown.filter(owner=request.user, oracle_id__isnull=True)
    return Response({
        "arts": [_art_item(a, request.user) for a in arts],
        "loose": [_art_item(a, request.user) for a in loose],
        "mine": shown.filter(owner=request.user).count(),
        "max": card_art.MAX_PER_USER,
    })


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([DeckImportThrottle])
def my_card_arts(request):
    """
    GET: as artes que você enviou (?kind=token: as fichas personalizadas). POST (multipart, campos
    "file" e "oracle_id"): envia uma arte nova para uma carta (todo mundo poderá usá-la nessa
    carta). Com kind=token, uma ficha que não existe no Scryfall (imagem da carta inteira, montada
    no site), com name, power e toughness e sem carta.
    """
    from .models import CardArt
    from .services import card_art

    from accounts.moderation import uploads_blocked

    kind = CardArt.TOKEN if (request.query_params.get("kind") or request.data.get("kind")) == "token" else CardArt.ART
    # Artes escondidas pelo admin somem da sua biblioteca e não contam no limite (um de cada tipo)
    mine = CardArt.objects.filter(owner=request.user, kind=kind, hidden_at__isnull=True)
    if request.method == "GET":
        rows = mine.only("key", "created_at", "kind", "name", "power", "toughness")
        return Response({"arts": [_art_item(a) for a in rows], "max": card_art.MAX_PER_USER})
    if uploads_blocked(request.user):
        return Response({"detail": "uploads_blocked", "code": "uploads_blocked"}, status=status.HTTP_403_FORBIDDEN)
    if mine.count() >= card_art.MAX_PER_USER:
        return Response({"detail": "too_many", "code": "too_many"}, status=status.HTTP_400_BAD_REQUEST)
    if kind == CardArt.TOKEN:
        name = str(request.data.get("name") or "").strip()
        if not 1 <= len(name) <= 80:
            return Response({"detail": "bad_name", "code": "bad_name"}, status=status.HTTP_400_BAD_REQUEST)
        oracle_id = None
        extra = {
            "name": name,
            "power": str(request.data.get("power") or "").strip()[:4],
            "toughness": str(request.data.get("toughness") or "").strip()[:4],
        }
    else:
        oracle_id = _oracle_id(request.data.get("oracle_id"))
        if oracle_id is None:
            return Response({"detail": "bad_card", "code": "bad_card"}, status=status.HTTP_400_BAD_REQUEST)
        extra = {}
    upload = request.FILES.get("file")
    if upload is None or upload.size > card_art.MAX_UPLOAD:
        return Response({"detail": "too_big", "code": "too_big"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        data, w, h = card_art.process(upload.read())
    except card_art.BadImage as exc:
        return Response({"detail": str(exc), "code": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    art = CardArt.objects.create(
        owner=request.user, kind=kind, oracle_id=oracle_id, image=data, width=w, height=h, size=len(data), **extra
    )
    return Response(_art_item(art, request.user), status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def my_token_arts(request):
    """
    Artes que você escolheu para as fichas do Scryfall. GET: {"arts": {oracle_id: url}}.
    PUT {"oracle_id", "art": <id da arte> | null}: define (ou tira) a arte de uma ficha (qualquer
    arte daquela ficha, de qualquer pessoa).
    """
    from .models import TokenArt
    from .services.card_art import token_arts

    if request.method == "PUT":
        oracle_id = _oracle_id(request.data.get("oracle_id"))
        if oracle_id is None:
            return Response({"detail": "bad_card"}, status=status.HTTP_400_BAD_REQUEST)
        key = request.data.get("art")
        if key in (None, ""):
            TokenArt.objects.filter(owner=request.user, oracle_id=oracle_id).delete()
        else:
            art = _usable_art(request.user, key, oracle_id)
            if art is None:
                return Response({"detail": "art_not_found"}, status=status.HTTP_404_NOT_FOUND)
            TokenArt.objects.update_or_create(owner=request.user, oracle_id=oracle_id, defaults={"art": art})
    return Response({"arts": token_arts(request.user)})


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def my_card_art(request, key):
    """Apaga uma arte sua (as cartas que a usavam, de qualquer pessoa, voltam à imagem normal)."""
    from .models import CardArt

    CardArt.objects.filter(owner=request.user, key=key).delete()
    forget_art(key)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["PUT"])
@permission_classes([IsAuthenticated])
def my_deck_art(request, pk):
    """
    PUT {"oracle_id", "art": <id da arte> | null}: define (ou tira) a arte personalizada de uma
    carta num deck seu: qualquer arte daquela carta, de qualquer pessoa.
    """
    from .models import DeckCardArt
    from .services.card_art import deck_arts

    deck = get_object_or_404(UserDeck, pk=pk, owner=request.user)
    oracle_id = _oracle_id(request.data.get("oracle_id"))
    if oracle_id is None:
        return Response({"detail": "bad_card"}, status=status.HTTP_400_BAD_REQUEST)
    key = request.data.get("art")
    if key in (None, ""):
        DeckCardArt.objects.filter(deck=deck, oracle_id=oracle_id).delete()
    else:
        art = _usable_art(request.user, key, oracle_id)
        if art is None:
            return Response({"detail": "art_not_found"}, status=status.HTTP_404_NOT_FOUND)
        DeckCardArt.objects.update_or_create(deck=deck, oracle_id=oracle_id, defaults={"art": art})
    return Response({"arts": deck_arts(deck)})


def _is_uuid(value) -> bool:
    import uuid as _uuid

    try:
        _uuid.UUID(str(value))
    except ValueError:
        return False
    return True


# Imagens já lidas do banco (as mesmas aparecem para todos na mesa): poupa idas ao banco. Cada
# processo guarda as próprias cópias: com validade curta, uma arte escondida pelo admin
# (accounts/moderation.py) para de sair também pelos outros workers
_ART_CACHE: dict[str, tuple[float, bytes]] = {}
_ART_CACHE_MAX = 300
_ART_CACHE_SECONDS = 600


def forget_art(key) -> None:
    _ART_CACHE.pop(str(key), None)


def card_art_image(request, key):
    """A imagem de uma arte (pública: aparece para os outros jogadores na mesa e no deck)."""
    import time

    from django.http import Http404, HttpResponse

    from .models import CardArt

    k = str(key)
    hit = _ART_CACHE.get(k)
    if hit and time.monotonic() - hit[0] < _ART_CACHE_SECONDS:
        data = hit[1]
    else:
        art = CardArt.objects.filter(key=key, hidden_at__isnull=True).only("image").first()
        if art is None:
            forget_art(k)
            raise Http404
        data = bytes(art.image)
        if k not in _ART_CACHE and len(_ART_CACHE) >= _ART_CACHE_MAX:
            _ART_CACHE.pop(next(iter(_ART_CACHE)))
        _ART_CACHE[k] = (time.monotonic(), data)
    response = HttpResponse(data, content_type="image/webp")
    # Cada arte tem endereço próprio e nunca muda: o navegador guarda por um ano
    response["Cache-Control"] = "public, max-age=31536000, immutable"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'"
    return response


# ---- bracket e nível de poder ao vivo no deckbuilder -------------------------------------------

MAX_ESTIMATE_CARDS = 250


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([DeckEstimateThrottle])
def deck_estimate(request):
    """
    Bracket e nível de poder de uma lista que ainda está sendo montada (sem salvar). Corpo:
    {"cards": [{"name", "oracle_id", "qty", "cmc", "land", "commander"}]}. O bracket vem do
    Commander Spellbook (guardado por algumas horas para a mesma lista); fora do ar, vem null e a
    análise sai sem ele.
    """
    import urllib.error
    import uuid
    from types import SimpleNamespace

    from django.conf import settings

    from decks.services.analysis import analyze
    from decks.services.brackets import cached_estimate, classify

    raw = request.data.get("cards")
    if not isinstance(raw, list) or len(raw) > MAX_ESTIMATE_CARDS:
        return Response({"detail": "bad_cards"}, status=status.HTTP_400_BAD_REQUEST)
    rows = []
    for item in raw:
        if not isinstance(item, dict):
            return Response({"detail": "bad_cards"}, status=status.HTTP_400_BAD_REQUEST)
        name = str(item.get("name") or "").strip()[:200]
        try:
            oracle_id = uuid.UUID(str(item.get("oracle_id")))
        except ValueError:
            oracle_id = None
        try:
            qty = max(1, min(99, int(item.get("qty") or 1)))
            cmc = max(0.0, min(20.0, float(item.get("cmc") or 0)))
        except (TypeError, ValueError):
            return Response({"detail": "bad_cards"}, status=status.HTTP_400_BAD_REQUEST)
        if not name:
            continue
        card = SimpleNamespace(name=name, oracle_id=oracle_id, cmc=cmc, category="land" if item.get("land") else "")
        rows.append(SimpleNamespace(card=card, quantity=qty, is_commander=item.get("commander") is True))

    bracket, details = None, {}
    if rows and settings.BRACKETS_ENABLED:
        commanders = [r.card.name for r in rows if r.is_commander]
        main = [(r.card.name, r.quantity) for r in rows if not r.is_commander]
        try:
            bracket, details = classify(cached_estimate(commanders, main))
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError, OSError):
            bracket, details = None, {}
    return Response({"bracket": bracket, "bracket_details": details, "analysis": analyze(rows, bracket, details)})
