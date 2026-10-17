from datetime import timedelta

from django.core.management.base import BaseCommand

from decks.models import Card, Deck
from decks.services.prices import refresh_card_prices, stale_cards, update_deck_price
from pools.models import UserDeck


class Command(BaseCommand):
    help = "Atualiza o preço das cartas no Scryfall e recalcula o valor estimado dos decks."

    def add_arguments(self, parser):
        parser.add_argument(
            "--older-than", type=int, default=3, help="Só cartas com preço mais velho que N dias (0 = todas)."
        )

    def handle(self, *args, **opts):
        days = opts["older_than"]
        qs = Card.objects.all() if days <= 0 else stale_cards(Card.objects.all(), timedelta(days=days))
        cards = list(qs)
        self.stdout.write(f"Atualizando o preço de {len(cards)} cartas no Scryfall…")
        done = refresh_card_prices(cards)
        self.stdout.write(f"  {done} cartas com preço atualizado")
        decks = list(Deck.objects.all()) + list(UserDeck.objects.all())
        for deck in decks:
            update_deck_price(deck, refresh=False)
        self.stdout.write(self.style.SUCCESS(f"Pronto: valor de {len(decks)} decks recalculado."))
