"""
Coleção do jogador (pools/services/collection.py) e a organização do "Meu pool" (pasta e etiquetas
dos decks montados e dos precons). Tudo só para o dono.
"""

from django.db.models import Count, F, Q, Sum
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from config.throttles import CollectionImportThrottle
from decks.models import Deck

from .models import CollectionCard, OwnedPrecon, UserDeck
from .services import collection

PAGE_SIZE = 60
FOLDER_MAX = 40
TAG_MAX = 24
TAGS_MAX = 8
SORTS = {
    "name": ("card__name", "foil"),
    "-quantity": ("-quantity", "card__name"),
    "-price": (F("card__price_usd").desc(nulls_last=True), "card__name"),
    "set": ("card__set_code", "card__collector_number"),
    "-updated": ("-updated_at", "card__name"),
}
CATEGORIES = {"land", "creature", "planeswalker", "battle", "artifact", "enchantment", "instant", "sorcery", "other"}


def _error(code: str, http=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": code, "code": code}, status=http)


def _row(c: CollectionCard) -> dict:
    card = c.card
    return {
        "id": c.pk,
        "quantity": c.quantity,
        "foil": c.foil,
        "name": card.name,
        "set": card.set_code,
        "number": card.collector_number,
        "image": card.image_normal,
        "image_small": card.image_small or card.image_normal,
        "type_line": card.type_line,
        "category": card.category,
        "color_identity": card.color_identity,
        "rarity": card.rarity,
        "price_usd": str(card.price_usd) if card.price_usd is not None else None,
    }


def _totals(user) -> dict:
    qs = CollectionCard.objects.filter(user=user)
    agg = qs.aggregate(entries=Count("id"), copies=Sum("quantity"))
    value = sum(
        float(price) * qty for price, qty in qs.exclude(card__price_usd=None).values_list("card__price_usd", "quantity")
    )
    unique = qs.values("card__name").distinct().count()
    return {"entries": agg["entries"] or 0, "copies": agg["copies"] or 0, "unique": unique, "value_usd": round(value, 2)}


@api_view(["GET", "DELETE"])
@permission_classes([IsAuthenticated])
def my_collection(request):
    """
    GET: a coleção, paginada (?q= nome, ?colors=WU (dentro dessas cores; C = incolores), ?category=,
    ?foil=1, ?sort=name|-quantity|-price|set|-updated, ?page=). DELETE: apaga a coleção inteira.
    """
    user = request.user
    if request.method == "DELETE":
        CollectionCard.objects.filter(user=user).delete()
        return Response(_totals(user))
    p = request.query_params
    qs = CollectionCard.objects.filter(user=user).select_related("card")
    q = " ".join(p.get("q", "").split())[:100]
    if q:
        qs = qs.filter(Q(card__name__icontains=q) | Q(card__type_line__icontains=q))
    colors = p.get("colors")
    if colors is not None and colors != "":
        allowed = {c for c in colors.upper() if c in "WUBRG"}
        for c in set("WUBRG") - allowed:
            qs = qs.exclude(card__color_identity__contains=c)
    category = p.get("category", "")
    if category in CATEGORIES:
        qs = qs.filter(card__category=category)
    if p.get("foil") == "1":
        qs = qs.filter(foil=True)
    qs = qs.order_by(*SORTS.get(p.get("sort", ""), SORTS["name"]))
    count = qs.count()
    try:
        page = max(1, int(p.get("page", 1)))
    except ValueError:
        page = 1
    pages = max(1, -(-count // PAGE_SIZE))
    page = min(page, pages)
    rows = qs[(page - 1) * PAGE_SIZE : page * PAGE_SIZE]
    return Response({
        "results": [_row(c) for c in rows],
        "count": count,
        "page": page,
        "pages": pages,
        "totals": _totals(user),
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([CollectionImportThrottle])
def import_collection(request):
    """
    POST {"rows": [{"quantity", "name", "set", "number", "scryfall_id", "foil"}], "replace": bool}:
    um lote da importação (até 400 linhas; o navegador manda o arquivo em vários). replace=true
    (só no primeiro lote) troca a coleção inteira pela do arquivo.
    """
    data = request.data if isinstance(request.data, dict) else {}
    try:
        rows = collection.parse_rows(data.get("rows"))
    except ValueError:
        return _error("bad_rows")
    pairs, missing = collection.resolve(rows) if rows else ([], [])
    added = collection.add_to_collection(request.user, pairs, replace=data.get("replace") is True)
    return Response({"added": added, "matched": len(pairs), "missing": missing, "totals": _totals(request.user)})


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def my_collection_card(request, pk: int):
    """PATCH {"quantity": n} (0 apaga) ou {"foil": bool}. DELETE: tira a carta da coleção."""
    row = get_object_or_404(CollectionCard, pk=pk, user=request.user)
    if request.method == "DELETE":
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    if "quantity" in request.data:
        try:
            qty = int(request.data["quantity"])
        except (TypeError, ValueError):
            return _error("bad_quantity")
        if qty <= 0:
            row.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        row.quantity = min(collection.MAX_QUANTITY, qty)
        row.save(update_fields=["quantity", "updated_at"])
    return Response(_row(CollectionCard.objects.select_related("card").get(pk=row.pk)))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_collection_names(request):
    """Nomes das cartas da coleção (minúsculas): o deckbuilder marca o que você tem."""
    return Response({"names": collection.owned_names(request.user)})


# --- Organização do Meu pool -----------------------------------------------------------------


def _clean_organize(data) -> dict | Response:
    out = {}
    if "folder" in data:
        out["folder"] = " ".join(str(data.get("folder") or "").split())[:FOLDER_MAX]
    if "tags" in data:
        raw = data.get("tags")
        if not isinstance(raw, list):
            return _error("bad_tags")
        tags = []
        for tag in raw:
            tag = " ".join(str(tag or "").split())[:TAG_MAX]
            if tag and tag.casefold() not in {t.casefold() for t in tags}:
                tags.append(tag)
        out["tags"] = tags[:TAGS_MAX]
    return out


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def organize_deck(request, pk: int):
    """PATCH {"folder": "...", "tags": [...]} num deck montado."""
    deck = get_object_or_404(UserDeck, pk=pk, owner=request.user)
    changes = _clean_organize(request.data)
    if isinstance(changes, Response):
        return changes
    for key, value in changes.items():
        setattr(deck, key, value)
    if changes:
        deck.save(update_fields=list(changes))
    return Response({"folder": deck.folder, "tags": deck.tags})


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def organize_precon(request, slug: str):
    """PATCH {"folder", "tags"} num precon que você marcou como seu."""
    deck = get_object_or_404(Deck, slug=slug)
    owned = get_object_or_404(OwnedPrecon, user=request.user, deck=deck)
    changes = _clean_organize(request.data)
    if isinstance(changes, Response):
        return changes
    for key, value in changes.items():
        setattr(owned, key, value)
    if changes:
        owned.save(update_fields=list(changes))
    return Response({"folder": owned.folder, "tags": owned.tags})
