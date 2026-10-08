import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from decks.models import Draw
from decks.services.draw import CODE_ALPHABET, DrawError, create_draw, create_pool_draw

from .models import MAX_PLAYERS, Room, RoomPlayer

# Tempo até a roleta começar em todos os navegadores (cobre o intervalo de atualização)
REVEAL_DELAY = timedelta(seconds=2.5)


class RoomError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _new_code() -> str:
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
        if not Room.objects.filter(code=code).exists():
            return code


def _check_name(room: Room, name: str, exclude: RoomPlayer | None = None):
    qs = room.players.filter(name__iexact=name)
    if exclude:
        qs = qs.exclude(pk=exclude.pk)
    if qs.exists():
        raise RoomError(f'Já tem alguém chamado "{name}" na sala.')


@transaction.atomic
def create_room(name: str, user, mode: str, filters: dict) -> tuple[Room, RoomPlayer]:
    if mode == Draw.Mode.POOL and user is None:
        raise RoomError("Entre na sua conta para criar uma sala com deckpool.", 401)
    room = Room.objects.create(code=_new_code(), mode=mode, filters=filters)
    player = RoomPlayer.objects.create(room=room, name=user.username if mode == Draw.Mode.POOL else name, user=user)
    room.host = player
    room.save(update_fields=["host"])
    return room, player


@transaction.atomic
def join_room(room: Room, name: str, user) -> RoomPlayer:
    room = Room.objects.select_for_update().get(pk=room.pk)
    if user is not None:
        existing = room.players.filter(user=user).first()
        if existing:
            return existing  # mesmo usuário em outro navegador: reaproveita o lugar
    if room.mode == Draw.Mode.POOL:
        if user is None:
            raise RoomError("Esta sala usa a deckpool dos jogadores: entre na sua conta para participar.", 401)
        name = user.username
    if room.players.count() >= MAX_PLAYERS:
        raise RoomError(f"A sala está cheia ({MAX_PLAYERS} jogadores).")
    _check_name(room, name)
    return RoomPlayer.objects.create(room=room, name=name, user=user)


def leave_room(player: RoomPlayer):
    room_id = player.room_id
    was_host = player.room.host_id == player.pk
    player.delete()
    room = Room.objects.get(pk=room_id)
    if was_host:
        # A sala passa para quem entrou primeiro entre os que ficaram
        room.host = room.players.first()
        room.save(update_fields=["host", "updated_at"])


def update_settings(room: Room, mode: str | None, filters: dict | None):
    if mode and mode != room.mode:
        if mode == Draw.Mode.POOL:
            anonymous = [p.name for p in room.players.all() if p.user_id is None]
            if anonymous:
                raise RoomError(f"Para usar a deckpool, todos precisam de conta ({', '.join(anonymous)} não tem).")
        room.mode = mode
    if filters is not None:
        room.filters = filters
    room.save()


def draw_for_room(room: Room, creator) -> Room:
    players = list(room.players.select_related("user"))
    if not 2 <= len(players) <= MAX_PLAYERS:
        raise RoomError("A sala precisa de 2 a 4 jogadores para sortear.")
    try:
        if room.mode == Draw.Mode.POOL:
            users = [p.user for p in players]
            if any(u is None for u in users):
                raise RoomError("No modo deckpool, todos os jogadores precisam de conta.")
            filters = {
                "color_rule": room.filters.get("color_rule", "any"),
                "no_repeat": room.filters.get("no_repeat", False),
            }
            draw = create_pool_draw(creator, users, filters, room=room)
        else:
            draw = create_draw(
                [p.name for p in players], room.filters, creator=creator, users=[p.user for p in players], room=room
            )
    except DrawError as exc:
        raise RoomError(str(exc)) from exc
    room.draw = draw
    room.draw_seats = [p.pk for p in players]
    room.reveal_at = timezone.now() + REVEAL_DELAY
    room.round += 1
    room.save()
    return room
