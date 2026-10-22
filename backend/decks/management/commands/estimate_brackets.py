import time
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from decks.models import Deck, TagSync
from decks.services.brackets import refresh_bracket
from pools.models import UserDeck

# Marca de que os decks com cartas de duas faces já foram recalculados com o nome inteiro delas
# (antes o Spellbook não as reconhecia: Tergrid e outros Game Changers não contavam)
FACES_RULE = "~brackets:full-names"
TWO_FACES = Q(deck_cards__card__name__contains=" // ")


class Command(BaseCommand):
    help = (
        "Calcula o bracket estimado dos decks pelo Commander Spellbook. "
        "Sem opções: só os que ainda não têm. Roda em run_syncs e nunca levanta erro."
    )

    def add_arguments(self, parser):
        parser.add_argument("--all", action="store_true", help="Recalcula todos (ex.: a lista de Game Changers mudou)")
        parser.add_argument("--older-than", type=int, metavar="DIAS", help="Também recalcula os mais antigos que isso")
        parser.add_argument("--slugs", help="Só estes precons (separados por vírgula)")
        parser.add_argument("--pause", type=float, default=0.3, help="Pausa entre consultas, em segundos")
        parser.add_argument("--timeout", type=int, default=10, help="Espera máxima por consulta, em segundos")

    def handle(self, *args, **opts):
        faces_done = TagSync.objects.filter(tag=FACES_RULE).exists()

        def pending(qs):
            if opts["all"]:
                return qs
            cond = Q(bracket__isnull=True)
            if opts["older_than"]:
                cond |= Q(bracket_checked_at__lt=timezone.now() - timedelta(days=opts["older_than"]))
            if not faces_done:
                cond |= TWO_FACES
            return qs.filter(cond).distinct()

        precons = pending(Deck.objects.all())
        if opts["slugs"]:
            precons = Deck.objects.filter(slug__in=[s.strip() for s in opts["slugs"].split(",")])
        user_decks = UserDeck.objects.none() if opts["slugs"] else pending(UserDeck.objects.all())

        done = failed = in_a_row = 0
        for deck in [*precons.order_by("pk"), *user_decks.order_by("pk")]:
            if refresh_bracket(deck, timeout=opts["timeout"]):
                done += 1
                in_a_row = 0
                self.stdout.write(f"  B{deck.bracket}  {deck.name}")
            else:
                failed += 1
                in_a_row += 1
                self.stdout.write(self.style.WARNING(f"  ??  {deck.name} (não calculado)"))
            self.stdout.flush()
            # 3 falhas seguidas: o Spellbook está fora (ou lento demais); o resto fica para a próxima
            if in_a_row >= 3:
                self.stdout.write(self.style.WARNING("Commander Spellbook parece fora do ar; tento na próxima rodada."))
                break
            time.sleep(opts["pause"])
        if not faces_done and not failed and not opts["slugs"]:
            TagSync.objects.update_or_create(tag=FACES_RULE, defaults={"synced_at": timezone.now(), "cards": done})
        self.stdout.write(self.style.SUCCESS(f"Brackets: {done} calculados, {failed} pendentes."))
