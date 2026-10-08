from django.core.management.base import BaseCommand
from django.db.models import Q, Sum

from decks.models import Card, Deck


class Command(BaseCommand):
    help = "Valida os decks: 100 cartas, 1–2 comandantes, cartas com imagem."

    def handle(self, *args, **opts):
        decks = Deck.objects.select_related("edition").annotate(
            total=Sum("deck_cards__quantity"),
            commanders=Sum("deck_cards__quantity", filter=Q(deck_cards__is_commander=True)),
        )
        problems = 0
        for deck in decks:
            issues = []
            if deck.total != 100:
                issues.append(f"{deck.total} cartas")
            if not deck.commanders or deck.commanders > 2:
                issues.append(f"{deck.commanders or 0} comandantes")
            if issues:
                problems += 1
                self.stdout.write(self.style.WARNING(f"  {deck}: {', '.join(issues)}"))

        missing = Card.objects.filter(image_normal="").count()
        self.stdout.write(
            f"{decks.count()} decks ({Deck.objects.filter(is_active=True).count()} no sorteio), "
            f"{Card.objects.count()} cartas únicas, {missing} sem imagem."
        )
        if problems:
            self.stdout.write(self.style.WARNING(f"{problems} decks com problema."))
        else:
            self.stdout.write(self.style.SUCCESS("Todos os decks estão válidos."))
