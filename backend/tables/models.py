from django.conf import settings
from django.db import models

from .fields import ZlibJSONField


class TableGame(models.Model):
    """Mesa virtual salva a cada ação, para sobreviver a um reinício do servidor (tables/state.py)."""

    code = models.CharField("código", max_length=12, primary_key=True)
    data = ZlibJSONField("estado (zlib)")
    updated_at = models.DateTimeField("atualizada em", auto_now=True, db_index=True)

    class Meta:
        verbose_name = "mesa virtual"
        verbose_name_plural = "mesas virtuais"

    def __str__(self):
        return self.code


class TableReplayTurn(models.Model):
    """
    Um turno já fechado de uma mesa aberta, para rever a partida: gravado uma vez só, ao fechar o
    turno. Antes os turnos iam dentro do estado da mesa, que crescia a partida inteira e era
    regravado a cada poucos segundos. O turno em andamento continua no estado.
    """

    table = models.ForeignKey(TableGame, on_delete=models.CASCADE, related_name="turns")
    index = models.PositiveIntegerField("ordem")
    data = ZlibJSONField("turno (zlib)")

    class Meta:
        verbose_name = "turno de mesa aberta"
        verbose_name_plural = "turnos de mesas abertas"
        constraints = [models.UniqueConstraint(fields=["table", "index"], name="unique_table_turn")]


class TableSeat(models.Model):
    """
    Quem está sentado em cada mesa salva, para "Suas mesas" e a lista de mesas abertas acharem as
    mesas sem abrir o estado de cada uma. Só o id da conta (sem chave estrangeira: a mesa guarda
    o lugar mesmo de quem apagou a conta, até fechar).
    """

    table = models.ForeignKey(TableGame, on_delete=models.CASCADE, related_name="seated")
    user_id = models.PositiveIntegerField("conta", db_index=True)

    class Meta:
        verbose_name = "lugar em mesa aberta"
        verbose_name_plural = "lugares em mesas abertas"
        constraints = [models.UniqueConstraint(fields=["table", "user_id"], name="unique_table_seat")]


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


class GameReplay(models.Model):
    """
    Uma partida para rever (Histórico → Rever): o resumo de cada turno, compactado (zlib + JSON),
    com os nomes de usuário, os decks e as cartas no campo. Sem coluna de texto: só quem jogou vê
    (GameReplayPlayer). Some depois de REPLAY_DAYS (tables/store.py).
    """

    finished_at = models.DateTimeField("encerrada em", auto_now_add=True, db_index=True)
    turns = models.PositiveIntegerField("turnos", default=0)
    data = models.BinaryField("partida (zlib)", editable=False)
    # A mesa inteira ao fechar sem vencedor (zlib + JSON), para restaurar a partida (tables/views.py)
    resume = models.BinaryField("mesa para restaurar (zlib)", null=True, editable=False)
    # Código da mesa restaurada a partir desta partida (para os outros jogadores voltarem a ela)
    restored_code = models.CharField("restaurada na mesa", max_length=12, blank=True, default="")

    class Meta:
        verbose_name = "partida para rever"
        verbose_name_plural = "partidas para rever"


class GameReplayPlayer(models.Model):
    replay = models.ForeignKey(GameReplay, on_delete=models.CASCADE, related_name="players")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="replays")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["replay", "user"], name="unique_replay_player")]
