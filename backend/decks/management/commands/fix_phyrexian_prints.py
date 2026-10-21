from django.core.management.base import BaseCommand

from decks.services.phyrexian import replace_phyrexian_prints


class Command(BaseCommand):
    help = (
        "Troca as edições em phyrexiano (texto ilegível) dos decks montados pela edição inglesa mais "
        "barata da mesma carta. Rápido quando não há nada para trocar (uma busca no Scryfall)."
    )

    def handle(self, *args, **opts):
        changed = replace_phyrexian_prints(log=self.stdout.write)
        self.stdout.write(self.style.SUCCESS(f"{changed} carta(s) trocada(s)"))
