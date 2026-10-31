from django.core.management.base import BaseCommand

from decks.services import stats


class Command(BaseCommand):
    help = "Soma de novo, do zero, as linhas do ranking (decks.RankingRow) de sorteios e mesas."

    def handle(self, *args, **opts):
        stats.rebuild()
        self.stdout.write("ranking refeito")
