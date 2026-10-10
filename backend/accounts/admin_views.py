"""
Painel de administração do site (só contas com is_staff): números gerais e lista de contas.
Somente leitura.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, F, IntegerField, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from decks.models import Deck, Draw, DrawEntry
from pools.models import OwnedPrecon, UserDeck
from rooms.models import Room

User = get_user_model()
DAYS = 30


def _per_day(qs, field: str, since) -> list[dict]:
    """
    Contagem por dia no fuso do site, com os dias sem nada preenchidos com zero.
    Agrupa em Python (são só 30 dias) para não depender das tabelas de fuso do banco.
    """
    counts: dict = {}
    for moment in qs.filter(**{f"{field}__gte": since}).values_list(field, flat=True).iterator():
        day = timezone.localdate(moment)
        counts[day] = counts.get(day, 0) + 1
    start = timezone.localdate(since)
    return [
        {"date": (start + timedelta(days=i)).isoformat(), "count": counts.get(start + timedelta(days=i), 0)}
        for i in range(DAYS)
    ]


@api_view(["GET"])
@permission_classes([IsAdminUser])
def overview(request):
    now = timezone.now()
    since = timezone.localtime(now - timedelta(days=DAYS - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    users = User.objects.all()
    with_pool = users.filter(Q(owned_precons__isnull=False) | Q(user_decks__isnull=False)).distinct()

    top_owned = (
        Deck.objects.annotate(n=Count("owners")).filter(n__gt=0).order_by("-n", "name").values("slug", "name", "n")[:8]
    )
    return Response({
        "days": DAYS,
        "users": {
            "total": users.count(),
            "new_7d": users.filter(date_joined__gte=now - timedelta(days=7)).count(),
            "new_30d": users.filter(date_joined__gte=now - timedelta(days=30)).count(),
            "active_30d": users.filter(last_login__gte=now - timedelta(days=30)).count(),
            "with_pool": with_pool.count(),
        },
        "content": {
            "owned_precons": OwnedPrecon.objects.count(),
            "imported_decks": UserDeck.objects.count(),
            "draws": Draw.objects.count(),
            "draws_7d": Draw.objects.filter(created_at__gte=now - timedelta(days=7)).count(),
            "room_draws": Draw.objects.filter(room__isnull=False).count(),
            "games": Draw.objects.filter(winner_position__isnull=False).count(),
            "open_rooms": Room.objects.count(),
        },
        "signups_by_day": _per_day(User.objects.all(), "date_joined", since),
        "draws_by_day": _per_day(Draw.objects.all(), "created_at", since),
        "top_owned": [{"slug": d["slug"], "name": d["name"], "owners": d["n"]} for d in top_owned],
    })


def _count(qs):
    """Subconsulta "quantos registros desta conta", sem multiplicar linhas com vários JOINs."""
    return Coalesce(
        Subquery(qs.values("k").annotate(c=Count("*")).values("c")[:1], output_field=IntegerField()),
        Value(0),
    )


ORDERING = {
    "recent": "-date_joined",
    "oldest": "date_joined",
    "last_login": F("last_login").desc(nulls_last=True),
    "username": "username",
    "draws": "-n_draws",
    "wins": "-n_wins",
    "pool": "-n_pool",
}


class UsersPagination(PageNumberPagination):
    page_size = 25


@api_view(["GET"])
@permission_classes([IsAdminUser])
def users(request):
    # Prefixo n_ porque o modelo de usuário já tem um campo "draws" (sorteios que ele criou)
    entries = DrawEntry.objects.filter(player=OuterRef("pk")).annotate(k=F("player"))
    qs = User.objects.annotate(
        n_precons=_count(OwnedPrecon.objects.filter(user=OuterRef("pk")).annotate(k=F("user"))),
        n_decks=_count(UserDeck.objects.filter(owner=OuterRef("pk")).annotate(k=F("owner"))),
        n_draws=_count(entries),
        n_games=_count(entries.filter(draw__winner_position__isnull=False)),
        n_wins=_count(entries.filter(position=F("draw__winner_position"))),
    ).annotate(n_pool=F("n_precons") + F("n_decks"))

    search = request.query_params.get("search", "").strip()
    if search:
        qs = qs.filter(Q(username__icontains=search) | Q(email__icontains=search))
    order = ORDERING.get(request.query_params.get("ordering", "recent"), "-date_joined")
    qs = qs.order_by(order, "pk")

    paginator = UsersPagination()
    page = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response([
        {
            "id": u.pk,
            "username": u.username,
            "email": u.email,
            "date_joined": u.date_joined,
            "last_login": u.last_login,
            "is_admin": u.is_staff,
            "precons": u.n_precons,
            "decks": u.n_decks,
            "draws": u.n_draws,
            "games": u.n_games,
            "wins": u.n_wins,
        }
        for u in page
    ])
