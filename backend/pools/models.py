import uuid

from django.conf import settings
from django.db import models

from decks.models import BracketFields, Card, Deck


class OwnedPrecon(models.Model):
    """Um precon oficial que o usuário tem (entra na deckpool dele)."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_precons")
    deck = models.ForeignKey(Deck, on_delete=models.CASCADE, related_name="owners")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "deck"], name="unique_owned_precon")]
        verbose_name = "precon do usuário"
        verbose_name_plural = "precons dos usuários"

    def __str__(self):
        return f"{self.user} — {self.deck}"


class UserDeck(BracketFields):
    """Deck montado pelo usuário, importado a partir de uma lista colada."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="user_decks")
    name = models.CharField("nome", max_length=100)
    face_commander = models.ForeignKey(Card, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    color_identity = models.CharField("identidade de cor", max_length=5, blank=True)
    decklist_text = models.TextField("lista original", blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    cards = models.ManyToManyField(Card, through="UserDeckCard", related_name="user_decks")

    class Meta:
        ordering = ["name"]
        verbose_name = "deck de usuário"
        verbose_name_plural = "decks de usuários"

    def __str__(self):
        return f"{self.name} ({self.owner})"


class UserDeckCard(models.Model):
    deck = models.ForeignKey(UserDeck, on_delete=models.CASCADE, related_name="deck_cards")
    card = models.ForeignKey(Card, on_delete=models.PROTECT, related_name="user_deck_cards")
    quantity = models.PositiveSmallIntegerField(default=1)
    is_commander = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["deck", "card", "is_commander"], name="unique_card_per_user_deck_zone"),
        ]


class FavoriteCard(models.Model):
    """
    Carta favorita do usuário no deckbuilder (as que ele mais usa). Guarda só o oracle id (a carta,
    qualquer edição): o navegador busca nome, imagem e preço no Scryfall.
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="favorite_cards")
    oracle_id = models.UUIDField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "oracle_id"], name="unique_favorite_card")]
        ordering = ["-created_at"]
        verbose_name = "carta favorita"
        verbose_name_plural = "cartas favoritas"

    def __str__(self):
        return f"{self.user} — {self.oracle_id}"


class CardArt(models.Model):
    """
    Arte personalizada enviada pelo usuário (alter, proxy, arte de fã) para usar nas cartas dos
    decks dele. A imagem fica no próprio banco, já tratada pelo servidor (pools/services/card_art.py):
    sem metadados, recortada na proporção da carta e em WebP pequeno. O endereço usa uma chave
    aleatória (não dá para listar as artes dos outros).
    """

    ART, TOKEN = "art", "token"

    key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="card_arts")
    # "token": ficha personalizada montada no site (a imagem é a carta inteira da ficha); com nome
    # e força/resistência para criar na mesa
    kind = models.CharField(max_length=8, choices=[(ART, "arte"), (TOKEN, "ficha")], default=ART)
    name = models.CharField(max_length=80, blank=True)
    power = models.CharField(max_length=4, blank=True)
    toughness = models.CharField(max_length=4, blank=True)
    image = models.BinaryField(editable=False)
    width = models.PositiveSmallIntegerField(default=0)
    height = models.PositiveSmallIntegerField(default=0)
    size = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "arte personalizada"
        verbose_name_plural = "artes personalizadas"

    def __str__(self):
        return f"arte {self.key} de {self.owner}"


class DeckCardArt(models.Model):
    """
    Qual arte personalizada uma carta usa num deck montado. Ligada pela carta (oracle id), não pela
    linha da lista: sobrevive a salvar o deck de novo e vale para qualquer edição da carta.
    """

    deck = models.ForeignKey(UserDeck, on_delete=models.CASCADE, related_name="card_arts")
    oracle_id = models.UUIDField()
    art = models.ForeignKey(CardArt, on_delete=models.CASCADE, related_name="uses")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["deck", "oracle_id"], name="unique_deck_card_art")]
        verbose_name = "arte de carta no deck"
        verbose_name_plural = "artes de cartas nos decks"
