from django.conf import settings
from django.db import models


class TableGame(models.Model):
    """Mesa virtual salva a cada ação, para sobreviver a um reinício do servidor (tables/state.py)."""

    code = models.CharField("código", max_length=12, primary_key=True)
    data = models.JSONField("estado")
    updated_at = models.DateTimeField("atualizada em", auto_now=True, db_index=True)

    class Meta:
        verbose_name = "mesa virtual"
        verbose_name_plural = "mesas virtuais"

    def __str__(self):
        return self.code


class TableResult(models.Model):
    """
    Partida encerrada numa mesa que não veio de um sorteio (as de sorteio vão para o próprio
    sorteio): alimenta o ranking das mesas. Só partidas com vencedor e com 2 ou mais jogadores
    com deck. Sem texto: quem jogou, com qual deck e quem ganhou ficam nas entradas.
    """

    finished_at = models.DateTimeField("encerrada em", auto_now_add=True, db_index=True)
    turns = models.PositiveIntegerField("turnos", default=0)

    class Meta:
        verbose_name = "partida de mesa"
        verbose_name_plural = "partidas de mesa"

    def __str__(self):
        return f"partida {self.pk}"


class TableResultEntry(models.Model):
    """Um jogador da partida: a conta, o deck (precon ou da pool) e se ganhou."""

    result = models.ForeignKey(TableResult, on_delete=models.CASCADE, related_name="entries")
    # Conta excluída: a partida continua contando para o deck, sem ligação com a pessoa
    player = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="table_games")
    deck = models.ForeignKey("decks.Deck", null=True, blank=True, on_delete=models.SET_NULL, related_name="table_games")
    user_deck = models.ForeignKey("pools.UserDeck", null=True, blank=True, on_delete=models.SET_NULL, related_name="table_games")
    won = models.BooleanField("ganhou", default=False)

    class Meta:
        verbose_name = "jogador da partida"
        verbose_name_plural = "jogadores da partida"


class PlayTime(models.Model):
    """
    Horas jogadas de cada conta (aparece no perfil): soma da duração das partidas, do primeiro
    turno até o fim (confirmado ou a mesa fechar), com pelo menos 2 jogadores com deck.
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="play_time")
    seconds = models.PositiveBigIntegerField(default=0)
    games = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "tempo de jogo"
        verbose_name_plural = "tempo de jogo"

    def __str__(self):
        return f"{self.user_id}: {self.seconds // 3600} h"
