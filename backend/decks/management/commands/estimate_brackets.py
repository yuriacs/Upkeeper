import time
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from decks.models import Deck
from decks.services.brackets import refresh_bracket
from pools.models import UserDeck


class Command(BaseCommand):
    help = (
        "Calcula o bracket estimado dos decks pelo Commander Spellbook. "
        "Sem opções: só os que ainda não têm. Roda no build do deploy e nunca falha o build."
    )

    def add_arguments(self, parser):
        parser.add_argument("--all", action="store_true", help="Recalcula todos (ex.: a lista de Game Changers mudou)")
        parser.add_argument("--older-than", type=int, metavar="DIAS", help="Também recalcula os mais antigos que isso")
        parser.add_argument("--slugs", help="Só estes precons (separados por vírgula)")
        parser.add_argument("--pause", type=float, default=0.3, help="Pausa entre consultas, em segundos")

    def handle(self, *args, **opts):
        def pending(qs):
            if opts["all"]:
                return qs
            cond = Q(bracket__isnull=True)
            if opts["older_than"]:
                cond |= Q(bracket_checked_at__lt=timezone.now() - timedelta(days=opts["older_than"]))
            return qs.filter(cond)

        precons = pending(Deck.objects.all())
        if opts["slugs"]:
            precons = Deck.objects.filter(slug__in=[s.strip() for s in opts["slugs"].split(",")])
        user_decks = UserDeck.objects.none() if opts["slugs"] else pending(UserDeck.objects.all())

        done = failed = 0
        for deck in [*precons.order_by("pk"), *user_decks.order_by("pk")]:
            if refresh_bracket(deck):
                done += 1
                self.stdout.write(f"  B{deck.bracket}  {deck.name}")
            else:
                failed += 1
                self.stdout.write(self.style.WARNING(f"  ??  {deck.name} (não calculado)"))
            time.sleep(opts["pause"])
            if failed >= 5 and done == 0:
                self.stdout.write(self.style.WARNING("Commander Spellbook parece fora do ar; tento no próximo deploy."))
                break
        self.stdout.write(self.style.SUCCESS(f"Brackets: {done} calculados, {failed} pendentes."))
