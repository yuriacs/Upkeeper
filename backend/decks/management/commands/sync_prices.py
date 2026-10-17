from datetime import timedelta

from django.core.management.base import BaseCommand

from django.utils import timezone

from decks.models import Card, Deck, TagSync
from decks.services.prices import refresh_card_prices, stale_cards, update_deck_price
from pools.models import UserDeck


# Marca (na tabela de sincronização das tags) de que os preços já seguem a regra atual. Ao mudar a
# regra (ex.: edição mais barata em vez da edição do deck), troque o nome: o próximo deploy
# recalcula todas as cartas de uma vez, sem esperar elas envelhecerem.
PRICE_RULE = "~prices:cheapest"


class Command(BaseCommand):
    help = "Atualiza o preço das cartas no Scryfall e recalcula o valor estimado dos decks."

    def add_arguments(self, parser):
        parser.add_argument(
            "--older-than", type=int, default=3, help="Só cartas com preço mais velho que N dias (0 = todas)."
        )

    def handle(self, *args, **opts):
        days = opts["older_than"]
        rule_new = not TagSync.objects.filter(tag=PRICE_RULE).exists()
        if rule_new:
            days = 0
            self.stdout.write("Regra de preço nova: recalculando todas as cartas.")
        qs = Card.objects.all() if days <= 0 else stale_cards(Card.objects.all(), timedelta(days=days))
        cards = list(qs)
        self.stdout.write(f"Atualizando o preço de {len(cards)} cartas no Scryfall…")
        done = refresh_card_prices(cards)
        self.stdout.write(f"  {done} cartas com preço atualizado")
        if rule_new:
            TagSync.objects.update_or_create(tag=PRICE_RULE, defaults={"synced_at": timezone.now(), "cards": done})
        decks = list(Deck.objects.all()) + list(UserDeck.objects.all())
        for deck in decks:
            update_deck_price(deck, refresh=False)
        self.stdout.write(self.style.SUCCESS(f"Pronto: valor de {len(decks)} decks recalculado."))
