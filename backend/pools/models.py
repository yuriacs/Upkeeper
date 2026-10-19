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
