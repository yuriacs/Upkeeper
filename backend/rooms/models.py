import secrets

from django.conf import settings
from django.db import models

from decks.models import Draw

MAX_PLAYERS = 4


class Room(models.Model):
    """Sala online: cada jogador entra pelo próprio navegador e vê o sorteio ao vivo."""

    code = models.CharField("código", max_length=12, unique=True)
    mode = models.CharField("modo", max_length=10, choices=Draw.Mode.choices, default=Draw.Mode.PRECON)
    filters = models.JSONField("filtros", default=dict, blank=True)
    host = models.ForeignKey(
        "RoomPlayer", on_delete=models.SET_NULL, null=True, blank=True, related_name="+", verbose_name="anfitrião"
    )
    # Sorteio atual: quem está em cada posição e quando a revelação começa (para todos ao mesmo tempo)
    draw = models.ForeignKey(Draw, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    draw_seats = models.JSONField("ordem dos jogadores no sorteio", default=list, blank=True)
    reveal_at = models.DateTimeField("início da revelação", null=True, blank=True)
    round = models.PositiveIntegerField("rodada", default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "sala"
        verbose_name_plural = "salas"

    def __str__(self):
        return self.code


def new_token() -> str:
    return secrets.token_urlsafe(24)


class RoomPlayer(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="players")
    name = models.CharField("nome", max_length=40)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    # Identifica o navegador do jogador (fica no localStorage); não precisa de conta
    token = models.CharField(max_length=64, unique=True, default=new_token)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["joined_at", "id"]
        verbose_name = "jogador na sala"
        verbose_name_plural = "jogadores na sala"

    def __str__(self):
        return f"{self.name} @ {self.room}"
