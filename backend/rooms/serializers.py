from django.utils import timezone
from rest_framework import serializers

from decks.models import Draw
from decks.serializers import DrawFiltersSerializer, DrawSerializer

from .models import Room, RoomPlayer


class RoomPlayerSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", default=None, read_only=True)

    class Meta:
        model = RoomPlayer
        fields = ["id", "name", "username"]


class RoomSerializer(serializers.ModelSerializer):
    players = RoomPlayerSerializer(many=True)
    host_id = serializers.IntegerField(source="host.pk", default=None)
    draw = serializers.SerializerMethodField()
    you = serializers.SerializerMethodField()
    server_time = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = [
            "code", "mode", "filters", "host_id", "players", "round", "draw", "draw_seats", "reveal_at",
            "you", "server_time",
        ]

    def get_draw(self, room):
        draw = self.context.get("draw")
        if not draw:
            return None
        data = DrawSerializer(draw).data
        # Qualquer jogador da sala pode marcar o vencedor do sorteio da sala
        data["can_set_result"] = self.context.get("player") is not None
        return data

    def get_you(self, room):
        player = self.context.get("player")
        return player.pk if player else None

    def get_server_time(self, room):
        return timezone.now().isoformat()


class CreateRoomSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=40, required=False, allow_blank=True, trim_whitespace=True)
    mode = serializers.ChoiceField(choices=Draw.Mode.choices, default=Draw.Mode.PRECON)
    filters = DrawFiltersSerializer(required=False, default=dict)


class JoinSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=40, required=False, allow_blank=True, trim_whitespace=True)


class UpdateRoomSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=Draw.Mode.choices, required=False)
    filters = DrawFiltersSerializer(required=False)


class KickSerializer(serializers.Serializer):
    player_id = serializers.IntegerField()
