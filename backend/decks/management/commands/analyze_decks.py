from django.core.management.base import BaseCommand

from decks.models import Deck
from decks.services.analysis import refresh_power
from pools.models import UserDeck


class Command(BaseCommand):
    help = "Recalcula o nível de poder estimado de todos os decks (rápido, não acessa a internet)."

    def add_arguments(self, parser):
        parser.add_argument("--missing", action="store_true", help="Só os decks ainda sem nível de poder")

    def handle(self, *args, **opts):
        total = 0
        for model in (Deck, UserDeck):
            qs = model.objects.all()
            if opts["missing"]:
                qs = qs.filter(power__isnull=True)
            for deck in qs.iterator():
                refresh_power(deck)
                total += 1
        self.stdout.write(self.style.SUCCESS(f"Nível de poder recalculado em {total} decks."))
