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
    Arte personalizada (alter, proxy, arte de fã) de uma carta ou ficha. Fica ligada à carta (oracle
    id, qualquer edição): todo mundo vê as artes daquela carta e pode usar qualquer uma nos próprios
    decks e fichas. Quem enviou não aparece para os outros; só essa pessoa pode apagá-la. A imagem
    fica no próprio banco, já tratada pelo servidor (pools/services/card_art.py): sem metadados,
    recortada na proporção da carta e em WebP pequeno.
    """

    key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="card_arts")
    # Carta da arte. Vazio: arte enviada antes das artes serem por carta e usada em mais de uma
    # carta (ou em nenhuma); ela ganha a carta na primeira vez que o dono a escolhe para uma
    oracle_id = models.UUIDField(null=True, blank=True, db_index=True)
    image = models.BinaryField(editable=False)
    width = models.PositiveSmallIntegerField(default=0)
    height = models.PositiveSmallIntegerField(default=0)
    size = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    # Escondida pelo admin depois de denúncia (accounts/moderation.py): o endereço dá 404 e as
    # cartas e fichas voltam à imagem original
    hidden_at = models.DateTimeField(null=True, blank=True)

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


class TokenArt(models.Model):
    """
    Arte personalizada que o usuário escolheu para uma ficha do Scryfall (Treasure, Soldier...):
    a ficha continua a mesma (nome, força/resistência), só a imagem muda, em toda mesa. Ligada
    pela ficha (oracle id): vale para qualquer impressão dela.
    """

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="token_arts")
    oracle_id = models.UUIDField()
    art = models.ForeignKey(CardArt, on_delete=models.CASCADE, related_name="token_uses")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "oracle_id"], name="unique_token_art")]
        verbose_name = "arte de ficha"
        verbose_name_plural = "artes de fichas"
