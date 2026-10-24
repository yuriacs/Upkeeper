from django.conf import settings
from django.db import models


class Tournament(models.Model):
    """
    Torneio de mesa virtual: chave eliminatória (1v1 ou 2x2, duplas sorteadas ao começar) ou liga
    em pods de até 4 jogadores, com pontos por colocação (tournaments/services.py). Cada partida
    tem o código de uma mesa (Match.code): a mesa abre já com os jogadores certos.
    """

    BRACKET, LEAGUE = "bracket", "league"
    KINDS = [(BRACKET, "chave"), (LEAGUE, "liga")]
    OPEN, RUNNING, FINISHED = "open", "running", "finished"
    STATUSES = [(OPEN, "inscrições abertas"), (RUNNING, "em andamento"), (FINISHED, "encerrado")]

    name = models.CharField("nome", max_length=60)
    kind = models.CharField("modo", max_length=10, choices=KINDS)
    # Chave: 1 (um contra um) ou 2 (duplas, 2x2). Liga: sempre 1
    team_size = models.PositiveSmallIntegerField("jogadores por lado", default=1)
    # Liga: número de rodadas (cada jogador joga uma partida por rodada). Chave: calculado ao começar
    rounds = models.PositiveSmallIntegerField("rodadas", default=0)
    round = models.PositiveSmallIntegerField("rodada atual", default=0)
    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="organized_tournaments"
    )
    friends_only = models.BooleanField("só amigos", default=False)
    # Regras para os decks das mesas, como ao abrir uma mesa: {"bracket", "tutors", "price"}
    rules = models.JSONField("regras", default=dict, blank=True)
    status = models.CharField("situação", max_length=10, choices=STATUSES, default=OPEN, db_index=True)
    champion = models.ForeignKey("Entry", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField("criado em", auto_now_add=True)
    started_at = models.DateTimeField("começou em", null=True, blank=True)
    finished_at = models.DateTimeField("terminou em", null=True, blank=True)

    class Meta:
        verbose_name = "torneio"
        verbose_name_plural = "torneios"

    def __str__(self):
        return self.name


class Entry(models.Model):
    """Um inscrito: o jogador e, no 2x2, a dupla (sorteada ao começar). `dropped`: saiu ou foi tirado."""

    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name="entries")
    # Conta excluída: o lugar na chave continua, sem ligação com a pessoa
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    partner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    dropped = models.BooleanField("saiu", default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "inscrito"
        verbose_name_plural = "inscritos"
        ordering = ["created_at", "id"]

    def user_ids(self) -> list[int]:
        return [u for u in (self.user_id, self.partner_id) if u is not None]


class Match(models.Model):
    """
    Uma partida: na chave, `slot` é a posição na rodada (o vencedor vai para slot // 2 da próxima);
    na liga, o número do pod. `code`: o código da mesa da partida.
    """

    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name="matches")
    round = models.PositiveSmallIntegerField("rodada")
    slot = models.PositiveSmallIntegerField("posição")
    code = models.CharField("código da mesa", max_length=12, unique=True)
    winner = models.ForeignKey(Entry, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    done = models.BooleanField("encerrada", default=False)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "partida do torneio"
        verbose_name_plural = "partidas do torneio"
        ordering = ["round", "slot"]
        constraints = [models.UniqueConstraint(fields=["tournament", "round", "slot"], name="unique_match_slot")]


class MatchSeat(models.Model):
    """
    Um lado da partida: na chave, `side` 0 (de cima) ou 1; na liga, a ordem no pod. `place`: a
    colocação na liga (1º, 2º...); None em partida encerrada = não apareceu (0 ponto).
    """

    match = models.ForeignKey(Match, on_delete=models.CASCADE, related_name="seats")
    entry = models.ForeignKey(Entry, on_delete=models.CASCADE, related_name="seats")
    side = models.PositiveSmallIntegerField("lado")
    place = models.PositiveSmallIntegerField("colocação", null=True, blank=True)

    class Meta:
        ordering = ["side"]
        constraints = [models.UniqueConstraint(fields=["match", "side"], name="unique_match_side")]
