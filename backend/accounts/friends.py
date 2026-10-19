"""
Amigos: pedido pelo nome de usuário, o outro aceita (ou recusa). Serve para as mesas "só amigos"
(tables/consumers.py). Nomes de usuário já são públicos (aparecem nas mesas); nada mais é exposto.
Para os amigos aparece também quem está online, em qual mesa, e os convites para mesa
(accounts/presence.py, só na memória).
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

from . import presence
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
            online = presence.is_online(other.id)
            item.update(online=online, table=presence.table_of(other.id) if online else None)
            friends.append(item)
        elif r.to_user_id == user.id:
            incoming.append(item)
        else:
            outgoing.append(item)
    # Online primeiro, depois pelo nome
    friends.sort(key=lambda f: (not f["online"], f["username"].casefold()))
    return {"friends": friends, "incoming": incoming, "outgoing": outgoing, "invites": presence.invites_for(user.id)}


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
        presence.touch(me.id)  # o menu do site consulta isto a cada 30 s: conta como online
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


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([FriendThrottle])
def invite_friend(request):
    """
    POST {"username", "code"}: convida um amigo para a mesa em que você está sentado. O amigo vê
    o aviso no site (GET /friends/ → "invites") e entra pela mesa normalmente.
    """
    from tables import state

    me = request.user
    name = str(request.data.get("username", "")).strip()[:150]
    code = str(request.data.get("code", "")).strip().upper()[:12]
    other = User.objects.filter(username__iexact=name, is_active=True).first() if name else None
    if other is None:
        return _error("user_not_found", status.HTTP_404_NOT_FOUND)
    if not are_friends(me.id, other.id):
        return _error("not_friends", status.HTTP_403_FORBIDDEN)
    table = state.TABLES.get(code)
    if table is None or table.expired() or not table.seat_of(me.id):
        return _error("not_at_table")
    if table.seat_of(other.id) and table.online.get(other.id, 0) > 0:
        return _error("already_at_table")
    presence.invite(me, other.id, code)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def dismiss_invite(request, pk: int):
    """Some com um convite recebido (entrou na mesa ou recusou)."""
    presence.dismiss(request.user.id, pk)
    return Response(_listing(request.user))
