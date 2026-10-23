"""
Painel de administração do site (só contas com is_staff): números gerais, lista de contas e a fila
de denúncias de imagens. Sem e-mails: nem o admin consegue ler (accounts/privacy.py).
"""

from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Count, F, IntegerField, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.authentication import SessionAuthentication, TokenAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
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
        qs = qs.filter(username__icontains=search)  # e-mail não: o servidor não sabe ler
    order = ORDERING.get(request.query_params.get("ordering", "recent"), "-date_joined")
    qs = qs.order_by(order, "pk")

    paginator = UsersPagination()
    page = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response([
        {
            "id": u.pk,
            "username": u.username,
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


@api_view(["GET"])
@authentication_classes([SessionAuthentication, TokenAuthentication])
@permission_classes([IsAdminUser])
def request_info(request):
    """
    Cabeçalhos de IP que chegam ao servidor (só admin): para acertar TRUSTED_PROXIES. Entre no
    admin do Django pelo navegador e abra este endereço na mesma aba (vale o login do admin);
    compare o seu IP com os valores do X-Forwarded-For.
    """
    from config.throttles import client_ip

    meta = request.META
    xff = meta.get("HTTP_X_FORWARDED_FOR", "")
    return Response(
        {
            "remote_addr": meta.get("REMOTE_ADDR"),
            "x_forwarded_for": [p.strip() for p in xff.split(",") if p.strip()],
            "cf_connecting_ip": meta.get("HTTP_CF_CONNECTING_IP"),
            "true_client_ip": meta.get("HTTP_TRUE_CLIENT_IP"),
            "x_real_ip": meta.get("HTTP_X_REAL_IP"),
            "trusted_proxies": settings.TRUSTED_PROXIES,
            "ip_used_for_limits": client_ip(request),
        }
    )


# ---- denúncias de imagens (accounts/moderation.py) ----------------------------------------------


@api_view(["GET"])
@permission_classes([IsAdminUser])
def reports(request):
    """Fila de denúncias abertas: uma linha por imagem, as mais denunciadas primeiro."""
    from django.db.models import Max, Min

    from . import moderation
    from .models import ImageReport, UploadBlock

    rows = (
        ImageReport.objects.filter(status=ImageReport.Status.OPEN)
        .values("kind", "key", "owner_id", "owner__username")
        .annotate(n=Count("id"), first=Min("created_at"), last=Max("created_at"))
        .order_by("-n", "first")[:100]
    )
    blocked = set(
        UploadBlock.objects.filter(user_id__in=[r["owner_id"] for r in rows]).values_list("user_id", flat=True)
    )
    return Response({
        "reports": [
            {
                "key": str(r["key"]),
                "kind": {ImageReport.Kind.AVATAR: "avatar", ImageReport.Kind.PLAYMAT: "playmat"}.get(r["kind"], "art"),
                "url": moderation.url_for(r["kind"], r["key"]),
                "owner": r["owner__username"],
                "owner_blocked": r["owner_id"] in blocked,
                "count": r["n"],
                "first_at": r["first"],
                "last_at": r["last"],
            }
            for r in rows
        ]
    })


@api_view(["POST"])
@permission_classes([IsAdminUser])
def resolve_report(request, key):
    """
    POST {"action": "hide" | "dismiss", "block": bool}: decide todas as denúncias abertas de uma
    imagem. "hide" esconde a imagem para todos; "block" também impede a conta de enviar imagens novas.
    """
    from . import moderation
    from .models import ImageReport, UploadBlock

    action = request.data.get("action")
    if action not in ("hide", "dismiss"):
        return Response({"detail": "bad_action"}, status=400)
    open_reports = ImageReport.objects.filter(key=key, status=ImageReport.Status.OPEN)
    first = open_reports.first()
    if first is None:
        return Response({"detail": "not_found"}, status=404)
    if action == "hide":
        moderation.hide(first.kind, key)
    if request.data.get("block") is True:
        UploadBlock.objects.get_or_create(user_id=first.owner_id)
    decided = ImageReport.Status.HIDDEN if action == "hide" else ImageReport.Status.DISMISSED
    open_reports.update(status=decided, resolved_at=timezone.now())
    return Response(status=204)


@api_view(["DELETE"])
@permission_classes([IsAdminUser])
def upload_block(request, username):
    """Libera de novo os envios de imagem de uma conta bloqueada."""
    from .models import UploadBlock

    UploadBlock.objects.filter(user__username__iexact=username).delete()
    return Response(status=204)


# ---- apoiadores (accounts/supporter.py) ----------------------------------------------------------


def _supporter_row(row) -> dict:
    return {
        "username": row.user.username,
        "until": row.until,
        "since": row.since,
        "times": row.times,
        "active": row.until > timezone.now(),
        "total_cents": row.total_cents,
        "founder": row.founder_at is not None,
    }


def _amount(data):
    """Valor da doação em centavos (o admin digita ao ativar); 0 se vier vazio, None se for inválido."""
    from .supporter import MAX_AMOUNT_CENTS

    value = data.get("amount", 0) or 0
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= MAX_AMOUNT_CENTS:
        return None
    return value


def _find_user(name: str):
    """
    Conta pelo nome que veio na doação. O identificador do Pix só aceita letras e números, então
    "nihil_magic" pode chegar como "NIHILMAGIC": sem achar o nome exato, compara só letras e números
    (e só aceita se uma conta bater).
    """
    import re

    user = User.objects.filter(username__iexact=name).first()
    if user:
        return user
    key = re.sub(r"[^a-z0-9]", "", name.lower())
    if not key:
        return None
    hits = [
        u for u in User.objects.filter(username__istartswith=name[:1]).only("id", "username")
        if re.sub(r"[^a-z0-9]", "", u.username.lower()) == key
    ]
    return hits[0] if len(hits) == 1 else None


@api_view(["GET", "POST"])
@permission_classes([IsAdminUser])
def supporters(request):
    """
    GET: apoiadores ativos e os que venceram nos últimos 60 dias (para lembrar de renovar).
    POST {"username", "days"?, "amount"?}: ativa ou renova (padrão 30 dias, somados ao que faltava);
    "amount" (centavos) entra no total doado, que conta para o selo de Fundador.
    """
    from . import supporter
    from .models import Supporter

    if request.method == "POST":
        name = str(request.data.get("username") or "").strip().lstrip("@")[:150]
        if name.lower().startswith("upkeeper "):
            name = name[9:].strip()  # colou a descrição inteira do Pix ("Upkeeper ana")
        user = _find_user(name) if name else None
        if user is None:
            return Response({"detail": "not_found"}, status=404)
        days = request.data.get("days", supporter.DAYS)
        if not isinstance(days, int) or isinstance(days, bool) or not 1 <= days <= 366:
            return Response({"detail": "bad_days"}, status=400)
        amount = _amount(request.data)
        if amount is None:
            return Response({"detail": "bad_amount"}, status=400)
        row = supporter.grant(user, days, amount)
        return Response(_supporter_row(row), status=201)
    since = timezone.now() - timedelta(days=60)
    rows = Supporter.objects.filter(until__gte=since).select_related("user").order_by("-until")[:200]
    return Response({
        "days": supporter.DAYS,
        "active": Supporter.objects.filter(until__gt=timezone.now()).count(),
        "supporters": [_supporter_row(r) for r in rows],
    })


@api_view(["GET"])
@permission_classes([IsAdminUser])
def donations(request):
    """Fila de avisos "Já doei" (Pix): conferir os centavos no extrato e ativar ou recusar."""
    from . import supporter

    return Response({
        "days": supporter.CLAIM_DAYS,
        "donations": [
            {
                "id": r.pk,
                "username": r.user.username,
                "gift": r.gift_to.username if r.gift_to_id else None,
                "cents": r.cents,
                "reserved_at": r.created_at,
                "claimed_at": r.claimed_at,
            }
            for r in supporter.pending_claims()
        ],
    })


@api_view(["POST"])
@permission_classes([IsAdminUser])
def resolve_donation(request, pk):
    """
    POST {"action": "grant" | "reject", "amount"?}: ativa os 30 dias (de quem pagou ou do presenteado)
    ou recusa. "amount" (centavos) entra no total de quem pagou.
    """
    from . import supporter

    row = supporter.pending_claims().filter(pk=pk).first()
    if row is None:
        return Response({"detail": "not_found"}, status=404)
    action = request.data.get("action")
    if action not in ("grant", "reject"):
        return Response({"detail": "bad_action"}, status=400)
    amount = _amount(request.data)
    if amount is None:
        return Response({"detail": "bad_amount"}, status=400)
    granted = supporter.resolve_claim(row, action == "grant", amount)
    if granted is None:
        return Response(status=204)
    return Response(_supporter_row(granted), status=201)


@api_view(["DELETE"])
@permission_classes([IsAdminUser])
def supporter_revoke(request, username):
    """Encerra o apoio de uma conta agora (ativado por engano, estorno)."""
    from . import supporter

    user = User.objects.filter(username__iexact=username).first()
    if user is None:
        return Response({"detail": "not_found"}, status=404)
    supporter.revoke(user)
    return Response(status=204)
