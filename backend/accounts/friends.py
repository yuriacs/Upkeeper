"""
Amigos: pedido pelo nome de usuário, o outro aceita (ou recusa). Serve para as mesas "só amigos"
(tables/consumers.py). Nomes de usuário já são públicos (aparecem nas mesas); nada mais é exposto.
"""

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from config.throttles import FriendThrottle

from .models import Friendship

User = get_user_model()
MAX_FRIENDS = 300  # amizades + pedidos de uma conta (contra robô mandando pedido para todo mundo)


def are_friends(a: int, b: int) -> bool:
    return Friendship.objects.filter(accepted=True).filter(
        Q(from_user_id=a, to_user_id=b) | Q(from_user_id=b, to_user_id=a)
    ).exists()


def friend_ids(user_id: int) -> set[int]:
    rows = Friendship.objects.filter(accepted=True).filter(Q(from_user_id=user_id) | Q(to_user_id=user_id))
    return {r.to_user_id if r.from_user_id == user_id else r.from_user_id for r in rows.only("from_user_id", "to_user_id")}


def _error(code: str, http=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": code, "code": code}, status=http)


def _listing(user) -> dict:
    rows = Friendship.objects.filter(Q(from_user=user) | Q(to_user=user)).select_related("from_user", "to_user")
    friends, incoming, outgoing = [], [], []
    for r in rows.order_by("-accepted_at", "-created_at"):
        other = r.to_user if r.from_user_id == user.id else r.from_user
        item = {"id": r.id, "username": other.username}
        if r.accepted:
            friends.append(item)
        elif r.to_user_id == user.id:
            incoming.append(item)
        else:
            outgoing.append(item)
    friends.sort(key=lambda f: f["username"].casefold())
    return {"friends": friends, "incoming": incoming, "outgoing": outgoing}


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([FriendThrottle])
def friends(request):
    """
    GET: amigos, pedidos recebidos e enviados. POST {"username"}: manda o pedido (se a outra
    pessoa já tinha pedido, vira amizade na hora).
    """
    me = request.user
    if request.method == "GET":
        return Response(_listing(me))
    name = str(request.data.get("username", "")).strip()[:150]
    other = User.objects.filter(username__iexact=name, is_active=True).first() if name else None
    if other is None:
        return _error("user_not_found", status.HTTP_404_NOT_FOUND)
    if other.id == me.id:
        return _error("self")
    existing = Friendship.objects.filter(
        Q(from_user=me, to_user=other) | Q(from_user=other, to_user=me)
    ).first()
    if existing:
        if existing.accepted:
            return _error("already_friends")
        if existing.from_user_id == me.id:
            return _error("already_sent")
        existing.accepted, existing.accepted_at = True, timezone.now()  # ela já tinha pedido: aceita
        existing.save(update_fields=["accepted", "accepted_at"])
        return Response(_listing(me))
    if Friendship.objects.filter(Q(from_user=me) | Q(to_user=me)).count() >= MAX_FRIENDS:
        return _error("too_many")
    try:
        with transaction.atomic():
            Friendship.objects.create(from_user=me, to_user=other)
    except IntegrityError:
        pass  # dois cliques ao mesmo tempo: o pedido já existe
    return Response(_listing(me), status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([FriendThrottle])
def accept_friend(request, pk: int):
    """Aceita um pedido recebido."""
    row = Friendship.objects.filter(pk=pk, to_user=request.user, accepted=False).first()
    if row is None:
        return _error("not_found", status.HTTP_404_NOT_FOUND)
    row.accepted, row.accepted_at = True, timezone.now()
    row.save(update_fields=["accepted", "accepted_at"])
    return Response(_listing(request.user))


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
@throttle_classes([FriendThrottle])
def remove_friend(request, pk: int):
    """Recusa um pedido recebido, cancela um enviado ou desfaz uma amizade."""
    me = request.user
    Friendship.objects.filter(Q(from_user=me) | Q(to_user=me), pk=pk).delete()
    return Response(_listing(me))
