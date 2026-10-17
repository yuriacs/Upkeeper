from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import F, Q
from django.utils import timezone

from decks.models import Card, Deck, TagSync
from decks.services.prices import refresh_card_prices, stale_cards, update_deck_price
from pools.models import UserDeck


# Marca (na tabela de sincronização das tags) de que os preços já seguem a regra atual. Ao mudar a
# regra (ex.: edição mais barata em vez da edição do deck), troque o nome: o próximo deploy
# recalcula todas as cartas de uma vez, sem esperar elas envelhecerem.
PRICE_RULE = "~prices:cheapest"


class Command(BaseCommand):
    help = (
        "Atualiza o preço das cartas no Scryfall (as mais velhas primeiro, até --max-cards cartas por vez; "
        "o resto fica para a próxima) e recalcula o valor estimado dos decks."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--older-than", type=int, default=7, help="Só cartas com preço mais velho que N dias (0 = todas)."
        )
        parser.add_argument(
            "--max-cards", type=int, default=1000,
            help="No máximo tantas cartas diferentes por vez (0 = sem limite). A busca do Scryfall faz "
            "~2 pedidos por segundo: 1000 cartas levam uns 2 minutos.",
        )

    def handle(self, *args, **opts):
        days, limit = opts["older_than"], opts["max_cards"]
        qs = Card.objects.all() if days <= 0 else stale_cards(Card.objects.all(), timedelta(days=days))
        # Regra nova (ou a troca ainda não terminou): também as cartas com preço de antes dela.
        # A marca guarda quando a troca começou; "cards" > 0 quando ela terminou.
        rule, _ = TagSync.objects.get_or_create(tag=PRICE_RULE, defaults={"synced_at": timezone.now(), "cards": 0})
        before_rule = Q(price_at__isnull=True) | Q(price_at__lt=rule.synced_at)
        if not rule.cards:
            qs = Card.objects.filter(before_rule) | qs
            self.stdout.write("Regra de preço nova: atualizando também as cartas com preço de antes dela.")
        # As mais velhas (ou nunca atualizadas) primeiro; cada carta conta uma vez, com todas as edições
        ordered = qs.distinct().order_by(F("price_at").asc(nulls_first=True), "pk")
        keys: set[str] = set()
        cards, skipped = [], set()
        for card in ordered:
            key = str(card.oracle_id) if card.oracle_id else f"id:{card.pk}"
            if key not in keys:
                if limit and len(keys) >= limit:
                    skipped.add(key)
                    continue
                keys.add(key)
            cards.append(card)
        self.stdout.write(f"Atualizando o preço de {len(keys)} cartas ({len(cards)} edições) no Scryfall…")
        try:
            done = refresh_card_prices(cards, keep_going=True)
            self.stdout.write(f"  {done} edições com preço atualizado")
            if skipped:
                self.stdout.write(f"  {len(skipped)} cartas ficaram para o próximo deploy (limite de {limit} por vez)")
            if not rule.cards and not Card.objects.filter(before_rule).exists():
                rule.cards = max(done, 1)
                rule.save(update_fields=["cards"])
        finally:
            # Mesmo se o Scryfall falhar no meio, o valor dos decks (precons e dos jogadores)
            # acompanha os preços que as cartas já têm
            decks = list(Deck.objects.all()) + list(UserDeck.objects.all())
            for deck in decks:
                update_deck_price(deck, refresh=False)
            self.stdout.write(self.style.SUCCESS(f"Pronto: valor de {len(decks)} decks recalculado."))
