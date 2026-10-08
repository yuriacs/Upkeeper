from django.core.management.base import BaseCommand

from decks.models import Card
from decks.services.scryfall import sync_cards


class Command(BaseCommand):
    help = "Busca imagens (e texto das cartas de duas faces) no Scryfall, em lotes de 75."

    def add_arguments(self, parser):
        parser.add_argument("--all", action="store_true", help="Ressincroniza todas, não só as sem imagem.")

    def handle(self, *args, **opts):
        qs = Card.objects.all() if opts["all"] else Card.objects.filter(image_normal="")
        count = qs.count()
        if not count:
            self.stdout.write(self.style.SUCCESS("Todas as cartas já têm imagem."))
            return
        self.stdout.write(f"Sincronizando {count} cartas com o Scryfall…")
        updated, not_found = sync_cards(qs, log=self.stdout.write)
        self.stdout.write(self.style.SUCCESS(f"Pronto: {updated} cartas atualizadas."))
        if not_found:
            self.stderr.write(f"{len(not_found)} não encontradas no Scryfall: {not_found[:10]}")
