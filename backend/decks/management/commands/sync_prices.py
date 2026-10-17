from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
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
        qs = Card.objects.all() if days <= 0 else stale_cards(Card.objects.all(), timedelta(days=days))
        # Regra nova (ou a troca ainda não terminou): também as cartas com preço de antes dela.
        # A marca guarda quando a troca começou; "cards" > 0 quando ela terminou.
        rule, _ = TagSync.objects.get_or_create(tag=PRICE_RULE, defaults={"synced_at": timezone.now(), "cards": 0})
        if not rule.cards:
            qs = Card.objects.filter(Q(price_at__isnull=True) | Q(price_at__lt=rule.synced_at)) | qs
            self.stdout.write("Regra de preço nova: atualizando as cartas com preço de antes dela.")
        cards = list(qs.distinct())
        self.stdout.write(f"Atualizando o preço de {len(cards)} cartas no Scryfall…")
        try:
            done = refresh_card_prices(cards, keep_going=True)
            self.stdout.write(f"  {done} cartas com preço atualizado")
            left = Card.objects.filter(Q(price_at__isnull=True) | Q(price_at__lt=rule.synced_at)).count()
            if not rule.cards and not left:
                rule.cards = max(done, 1)
                rule.save(update_fields=["cards"])
            elif left:
                self.stdout.write(self.style.WARNING(f"  {left} cartas ficaram para o próximo deploy"))
        finally:
            # Mesmo se o Scryfall falhar no meio, o valor dos decks (precons e dos jogadores)
            # acompanha os preços que as cartas já têm
            decks = list(Deck.objects.all()) + list(UserDeck.objects.all())
            for deck in decks:
                update_deck_price(deck, refresh=False)
            self.stdout.write(self.style.SUCCESS(f"Pronto: valor de {len(decks)} decks recalculado."))
