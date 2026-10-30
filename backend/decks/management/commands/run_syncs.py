import time

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

from decks.models import TagSync

# Hora da última rodada (config/syncs.py): um servidor que acorda da hibernação não roda tudo de novo
RUN_RULE = "~syncs:last-run"

# Em ordem: o nível de poder (analyze_decks) depende do bracket e das tags. Todas são
# incrementais (só o que falta ou está velho), então rodar de novo não refaz o trabalho.
STEPS = [
    # Bracket dos decks novos e revisão mensal (caso a lista de Game Changers mude)
    ("estimate_brackets", ["--older-than", "30", "--timeout", "10"]),
    # Função das cartas (tutor, ramp, compra...) do Scryfall, uma vez por mês
    ("sync_card_tags", ["--older-than", "30"]),
    ("analyze_decks", ["--missing"]),
    # Força/resistência e lealdade das cartas (mesa virtual): só as que ainda não têm
    ("sync_scryfall", ["--stats"]),
    # Decks montados com edição em phyrexiano (texto ilegível): passam para a inglesa mais barata
    ("fix_phyrexian_prints", []),
    # Preço das cartas há mais de 7 dias sem atualizar, até 1000 por vez (~2 min)
    ("sync_prices", ["--older-than", "7", "--max-cards", "1000"]),
]


class Command(BaseCommand):
    help = (
        "Roda em ordem as sincronizações com serviços externos (Commander Spellbook, Scryfall). "
        "O servidor chama sozinho depois de subir e a cada 24 horas (config/syncs.py). "
        "Uma etapa que falha não impede as outras."
    )

    def handle(self, *args, **opts):
        for name, args in STEPS:
            self.stdout.write(f"== {name} {' '.join(args)}")
            self.stdout.flush()
            start = time.monotonic()
            try:
                call_command(name, *args, stdout=self.stdout, stderr=self.stderr)
            except Exception as exc:  # noqa: BLE001 — uma etapa fora do ar não pode parar as demais
                self.stdout.write(self.style.WARNING(f"   {name} falhou: {exc!r}"))
            self.stdout.write(f"   {name}: {time.monotonic() - start:.0f} s")
            self.stdout.flush()
        TagSync.objects.update_or_create(tag=RUN_RULE, defaults={"synced_at": timezone.now(), "cards": 0})
