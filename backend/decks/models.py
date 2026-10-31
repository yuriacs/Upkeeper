import secrets

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

# Ordem das cores no padrão WUBRG (usada para normalizar a identidade de cor)
WUBRG = "WUBRG"


def normalize_colors(colors) -> str:
    """Converte ['G', 'W'] ou 'GW' em 'WG' (ordem WUBRG). Incolor = ''."""
    found = {c.upper() for c in colors}
    return "".join(c for c in WUBRG if c in found)


class Edition(models.Model):
    """Coleção/produto (ex.: C21 = Commander 2021)."""

    code = models.CharField("código", max_length=10, unique=True)
    name = models.CharField("nome", max_length=200)
    release_date = models.DateField("lançamento", null=True, blank=True)
    icon_svg_uri = models.URLField("ícone (SVG)", blank=True)

    class Meta:
        ordering = ["-release_date", "code"]
        verbose_name = "edição"
        verbose_name_plural = "edições"

    def __str__(self):
        return f"{self.name} ({self.code})"


class Card(models.Model):
    """Uma impressão específica de carta (identificada pelo scryfall_id)."""

    class Category(models.TextChoices):
        LAND = "land", _("Lands")
        CREATURE = "creature", _("Creatures")
        PLANESWALKER = "planeswalker", _("Planeswalkers")
        BATTLE = "battle", _("Battles")
        ARTIFACT = "artifact", _("Artifacts")
        ENCHANTMENT = "enchantment", _("Enchantments")
        INSTANT = "instant", _("Instants")
        SORCERY = "sorcery", _("Sorceries")
        OTHER = "other", _("Other")

    scryfall_id = models.UUIDField(unique=True)
    oracle_id = models.UUIDField(null=True, blank=True, db_index=True)
    name = models.CharField("nome", max_length=255, db_index=True)
    mana_cost = models.CharField("custo", max_length=100, blank=True)
    cmc = models.DecimalField("valor de mana", max_digits=5, decimal_places=1, default=0)
    type_line = models.CharField("tipo", max_length=255, blank=True)
    oracle_text = models.TextField("texto", blank=True)
    colors = models.CharField("cores", max_length=5, blank=True)
    color_identity = models.CharField("identidade de cor", max_length=5, blank=True)
    category = models.CharField(
        "categoria", max_length=20, choices=Category.choices, default=Category.OTHER, db_index=True
    )
    layout = models.CharField(max_length=30, blank=True)
    rarity = models.CharField("raridade", max_length=20, blank=True)
    set_code = models.CharField("set", max_length=10, blank=True)
    collector_number = models.CharField("número", max_length=20, blank=True)
    # Força/resistência e lealdade impressas (texto: pode ser "*" ou "1+*"); vazio se a carta não tem
    power = models.CharField("força", max_length=8, blank=True)
    toughness = models.CharField("resistência", max_length=8, blank=True)
    loyalty = models.CharField("lealdade", max_length=8, blank=True)

    # Preenchidos pelo sync_scryfall
    image_normal = models.URLField("imagem", max_length=500, blank=True)
    image_small = models.URLField("imagem pequena", max_length=500, blank=True)
    image_art_crop = models.URLField("arte recortada", max_length=500, blank=True)
    image_back = models.URLField("imagem do verso", max_length=500, blank=True)
    scryfall_synced_at = models.DateTimeField(null=True, blank=True)
    # Preço desta edição no Scryfall (USD: TCGplayer; EUR: Cardmarket), para estimar o valor dos decks
    price_usd = models.DecimalField("preço (US$)", max_digits=10, decimal_places=2, null=True, blank=True)
    price_eur = models.DecimalField("preço (€)", max_digits=10, decimal_places=2, null=True, blank=True)
    price_at = models.DateTimeField("preço atualizado em", null=True, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "carta"
        verbose_name_plural = "cartas"

    def __str__(self):
        return self.name


class BracketFields(models.Model):
    """Bracket estimado (sistema oficial de Commander), calculado em decks.services.brackets."""

    bracket = models.PositiveSmallIntegerField("bracket estimado", null=True, blank=True, db_index=True)
    # Motivos: Game Changers, destruição de terrenos em massa, turnos extras, combos de 2 cartas
    bracket_details = models.JSONField("motivos do bracket", default=dict, blank=True)
    bracket_checked_at = models.DateTimeField("bracket calculado em", null=True, blank=True)
    # Nível de poder estimado (1 a 10), ver decks.services.analysis
    power = models.FloatField("nível de poder estimado", null=True, blank=True, db_index=True)
    # Valor estimado: soma dos preços das cartas no Scryfall (decks.services.prices)
    price_usd = models.DecimalField("valor estimado (US$)", max_digits=10, decimal_places=2, null=True, blank=True, db_index=True)
    price_eur = models.DecimalField("valor estimado (€)", max_digits=10, decimal_places=2, null=True, blank=True)
    price_at = models.DateTimeField("valor calculado em", null=True, blank=True)

    class Meta:
        abstract = True


class Deck(BracketFields):
    name = models.CharField("nome", max_length=200)
    slug = models.SlugField(max_length=220, unique=True)
    edition = models.ForeignKey(Edition, on_delete=models.PROTECT, related_name="decks")
    release_date = models.DateField("lançamento", null=True, blank=True)
    color_identity = models.CharField("identidade de cor", max_length=5, blank=True, db_index=True)
    face_commander = models.ForeignKey(
        Card,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="comandante de capa",
    )
    mtgjson_file = models.CharField("arquivo MTGJSON", max_length=200, unique=True, null=True, blank=True)
    source_url = models.URLField("fonte oficial", max_length=500, blank=True)
    is_active = models.BooleanField(
        "entra no sorteio", default=True, help_text="Desmarque para tirar o deck do sorteio sem apagá-lo."
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    cards = models.ManyToManyField(Card, through="DeckCard", related_name="decks")

    class Meta:
        ordering = ["-release_date", "name"]

    def __str__(self):
        return f"{self.name} ({self.edition.code})"


class DeckCard(models.Model):
    deck = models.ForeignKey(Deck, on_delete=models.CASCADE, related_name="deck_cards")
    card = models.ForeignKey(Card, on_delete=models.PROTECT, related_name="deck_cards")
    quantity = models.PositiveSmallIntegerField("quantidade", default=1)
    is_commander = models.BooleanField("comandante", default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["deck", "card", "is_commander"], name="unique_card_per_deck_zone"),
        ]
        verbose_name = "carta do deck"
        verbose_name_plural = "cartas do deck"

    def __str__(self):
        return f"{self.quantity}x {self.card.name}"


class Draw(models.Model):
    """Um sorteio salvo, acessível por link curto (/draw/<code>)."""

    class Mode(models.TextChoices):
        PRECON = "precon", _("Official precons")
        POOL = "pool", _("Players' deck pool")

    code = models.CharField("código", max_length=12, unique=True)
    mode = models.CharField("modo", max_length=10, choices=Mode.choices, default=Mode.PRECON)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="draws"
    )
    filters = models.JSONField("filtros", default=dict, blank=True)
    room = models.ForeignKey(
        "rooms.Room", on_delete=models.SET_NULL, null=True, blank=True, related_name="draws", verbose_name="sala"
    )
    pool_size = models.PositiveIntegerField("decks elegíveis", default=0)
    created_at = models.DateTimeField("criado em", auto_now_add=True)
    # Resultado da partida: a posição (DrawEntry.position) de quem ganhou
    winner_position = models.PositiveSmallIntegerField("vencedor (posição)", null=True, blank=True)
    result_at = models.DateTimeField("resultado registrado em", null=True, blank=True)
    # Segredo devolvido só para quem criou o sorteio sem conta: permite marcar o vencedor depois
    manage_token = models.CharField(max_length=32, blank=True, default="", editable=False)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "sorteio"
        verbose_name_plural = "sorteios"

    def __str__(self):
        return self.code

    def save(self, *args, **kwargs):
        if not self.manage_token:
            self.manage_token = secrets.token_urlsafe(16)[:32]
        super().save(*args, **kwargs)


class DrawEntry(models.Model):
    draw = models.ForeignKey(Draw, on_delete=models.CASCADE, related_name="entries")
    position = models.PositiveSmallIntegerField("posição")
    player_name = models.CharField("jogador", max_length=40)
    player = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Um dos dois: precon oficial ou deck montado por um usuário (modo deckpool)
    deck = models.ForeignKey(Deck, on_delete=models.PROTECT, null=True, blank=True, related_name="draw_entries")
    user_deck = models.ForeignKey(
        "pools.UserDeck", on_delete=models.SET_NULL, null=True, blank=True, related_name="draw_entries"
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="dono do deck",
    )
    # Desligado quando o jogador (ou o anfitrião da sala) zera o histórico de "não repetir deck".
    # O sorteio continua existindo; só deixa de contar como "já jogou".
    in_history = models.BooleanField("conta no histórico", default=True)
    # Sala: o jogador pode resortear o próprio deck uma vez; guarda o nome do deck anterior
    rerolled_from = models.CharField("resorteado (deck anterior)", max_length=200, blank=True, default="")

    class Meta:
        ordering = ["position"]
        constraints = [models.UniqueConstraint(fields=["draw", "position"], name="unique_draw_position")]
        verbose_name = "resultado"
        verbose_name_plural = "resultados"

    def __str__(self):
        deck = self.deck or self.user_deck
        return f"{self.player_name}: {deck.name if deck else '(deck removido)'}"


class OracleTag(models.Model):
    """
    Função de uma carta (tutor, ramp, compra, remoção...), vinda das tags do Scryfall.
    Guardada por oracle_id, para valer para qualquer impressão — inclusive cartas que só
    aparecem depois, em decks importados. Atualizada por `manage.py sync_card_tags`.
    """

    oracle_id = models.UUIDField(db_index=True)
    tag = models.CharField(max_length=30, db_index=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["oracle_id", "tag"], name="unique_oracle_tag")]
        verbose_name = "função de carta"
        verbose_name_plural = "funções de cartas"

    def __str__(self):
        return f"{self.oracle_id} {self.tag}"


class TagSync(models.Model):
    """Quando cada tag foi baixada do Scryfall pela última vez."""

    tag = models.CharField(max_length=30, primary_key=True)
    synced_at = models.DateTimeField()
    cards = models.PositiveIntegerField(default=0)

    def __str__(self):
        return f"{self.tag} ({self.cards})"


class RankingRow(models.Model):
    """
    Vitórias e partidas já somadas de cada deck e jogador, por ranking (sorteios ou mesas) e
    tamanho de partida: a página do ranking só lê as primeiras linhas. Refeitas a cada resultado
    só para quem jogou aquela partida (decks/services/stats.py, touch) e inteiras uma vez por dia.
    Só números: o nome de quem jogou vem da conta na hora de ler.
    """

    SOURCE_DRAWS, SOURCE_TABLES = 1, 2
    KIND_PRECON, KIND_USER_DECK, KIND_PLAYER, KIND_TOTAL = 1, 2, 3, 4

    source = models.PositiveSmallIntegerField()
    size = models.PositiveSmallIntegerField()  # 0 = todas as partidas; 4 = 4 ou mais jogadores
    kind = models.PositiveSmallIntegerField()
    ref = models.PositiveIntegerField()  # id do deck ou da conta; 0 no total de partidas
    games = models.PositiveIntegerField(default=0)
    wins = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["source", "size", "kind", "ref"], name="unique_ranking_row")]
        indexes = [models.Index(fields=["source", "size", "kind", "-wins"], name="ranking_wins")]
        verbose_name = "linha do ranking"
        verbose_name_plural = "linhas do ranking"


class PlayerRating(models.Model):
    """
    Rating de cada conta no estilo Elo, por ranking (sorteios ou mesas) e tamanho de partida (0 =
    todas): além de quantas vezes ganhou, conta contra quem. Refeito do zero, na ordem das
    partidas, a cada resultado (decks/services/ratings.py).
    """

    source = models.PositiveSmallIntegerField()  # RankingRow.SOURCE_*
    size = models.PositiveSmallIntegerField()
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ratings")
    rating = models.FloatField()
    games = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["source", "size", "user"], name="unique_player_rating")]
        indexes = [models.Index(fields=["source", "size", "-rating"], name="rating_order")]
        verbose_name = "rating de jogador"
        verbose_name_plural = "ratings de jogadores"


class SeasonChampion(models.Model):
    """
    Campeão de cada mês (temporada): quem mais ganhou partidas no mês, somando sorteios e mesas
    (decks/services/seasons.py). Gravado quando o mês acaba; sem conta (ninguém chegou ao mínimo
    de vitórias, ou a conta foi apagada): user vazio.
    """

    month = models.DateField("mês", unique=True)  # dia 1
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="season_titles"
    )
    wins = models.PositiveIntegerField(default=0)
    games = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-month"]
        verbose_name = "campeão do mês"
        verbose_name_plural = "campeões do mês"
