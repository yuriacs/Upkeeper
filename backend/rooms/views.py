from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response

from config.throttles import DrawThrottle, RoomCreateThrottle, RoomJoinThrottle
from decks.services.draw import reset_room_history
from decks.services.stats import room_scoreboard
from decks.views import _draw_queryset

from . import services
from .models import Room, RoomPlayer
from .serializers import CreateRoomSerializer, JoinSerializer, KickSerializer, RoomSerializer, UpdateRoomSerializer
from django.utils.translation import gettext as _


def _user(request):
    return request.user if request.user.is_authenticated else None


def _get_room(code: str) -> Room:
    return get_object_or_404(
        Room.objects.select_related("host").prefetch_related(
            Prefetch("players", queryset=RoomPlayer.objects.select_related("user"))
        ),
        code=code.lower(),
    )


def _player(request, room: Room) -> RoomPlayer | None:
    token = request.headers.get("X-Room-Token")
    if not token:
        return None
    return next((p for p in room.players.all() if p.token == token), None)


def _room_response(request, room: Room, player=None, status_code=status.HTTP_200_OK, extra=None, reload=True):
    if reload:
        room = _get_room(room.code)  # recarrega jogadores e sorteio atuais depois de uma mudança
    player = player or _player(request, room)
    draw = _draw_queryset().filter(pk=room.draw_id).first() if room.draw_id else None
    data = RoomSerializer(room, context={"draw": draw, "player": player}).data
    return Response({**data, **(extra or {})}, status=status_code)


def _error(exc: services.RoomError):
    return Response({"detail": str(exc)}, status=exc.status)


def _require_host(request, room):
    player = _player(request, room)
    if player is None or room.host_id != player.pk:
        return None, Response({"detail": _("Only the host can do that.")}, status=status.HTTP_403_FORBIDDEN)
    return player, None


@api_view(["POST"])
@throttle_classes([RoomCreateThrottle])
def create_room(request):
    ser = CreateRoomSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    user = _user(request)
    name = ser.validated_data.get("name") or (user.username if user else "")
    if not name and ser.validated_data["mode"] != "pool":
        return Response({"detail": _("Tell us your name to create the room.")}, status=status.HTTP_400_BAD_REQUEST)
    try:
        room, player = services.create_room(name, user, ser.validated_data["mode"], ser.validated_data["filters"])
    except services.RoomError as exc:
        return _error(exc)
    return _room_response(request, room, player, status.HTTP_201_CREATED, {"token": player.token})


@api_view(["GET", "PATCH"])
def room_detail(request, code):
    room = _get_room(code)
    if request.method == "PATCH":
        _, denied = _require_host(request, room)
        if denied:
            return denied
        ser = UpdateRoomSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            services.update_settings(room, ser.validated_data.get("mode"), ser.validated_data.get("filters"))
        except services.RoomError as exc:
            return _error(exc)
        return _room_response(request, room)
    # GET (a cada 2 s por jogador): a sala acabou de ser lida, não precisa recarregar
    return _room_response(request, room, reload=False)


@api_view(["POST"])
@throttle_classes([RoomJoinThrottle])
def join(request, code):
    room = _get_room(code)
    current = _player(request, room)
    if current:
        return _room_response(request, room, current, extra={"token": current.token})
    ser = JoinSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    user = _user(request)
    name = ser.validated_data.get("name") or (user.username if user else "")
    if not name and room.mode != "pool":
        return Response({"detail": _("Tell us your name to join.")}, status=status.HTTP_400_BAD_REQUEST)
    try:
        player = services.join_room(room, name, user)
    except services.RoomError as exc:
        return _error(exc)
    return _room_response(request, room, player, status.HTTP_201_CREATED, {"token": player.token})


@api_view(["POST"])
def leave(request, code):
    room = _get_room(code)
    player = _player(request, room)
    if player:
        services.leave_room(player)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
def kick(request, code):
    room = _get_room(code)
    host, denied = _require_host(request, room)
    if denied:
        return denied
    ser = KickSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    target = room.players.filter(pk=ser.validated_data["player_id"]).exclude(pk=host.pk).first()
    if target:
        services.leave_room(target)
    return _room_response(request, room, host)


@api_view(["POST"])
@throttle_classes([DrawThrottle])
def draw(request, code):
    room = _get_room(code)
    host, denied = _require_host(request, room)
    if denied:
        return denied
    try:
        services.draw_for_room(room, host.user)
    except services.RoomError as exc:
        return _error(exc)
    return _room_response(request, room, host)


@api_view(["POST"])
@throttle_classes([DrawThrottle])
def reroll(request, code):
    """Resortear: o jogador troca só o próprio deck, uma vez por sorteio."""
    room = _get_room(code)
    player = _player(request, room)
    if player is None:
        return Response({"detail": _("Join the room first.")}, status=status.HTTP_403_FORBIDDEN)
    try:
        services.reroll_for_player(room, player)
    except services.RoomError as exc:
        return _error(exc)
    return _room_response(request, room, player)


@api_view(["POST"])
def reset_history(request, code):
    room = _get_room(code)
    host, denied = _require_host(request, room)
    if denied:
        return denied
    cleared = reset_room_history(room)
    return _room_response(request, room, host, extra={"cleared": cleared})


@api_view(["GET"])
def scoreboard(request, code):
    """Placar da sala: vitórias de cada jogador nas partidas com resultado marcado."""
    room = _get_room(code)
    return Response({"players": room_scoreboard(room)})
