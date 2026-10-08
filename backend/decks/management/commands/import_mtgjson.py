from pathlib import Path

from django.core.management.base import BaseCommand

from decks.services.mtgjson import MtgjsonSource, import_commander_decks
from decks.services.scryfall import sync_editions


class Command(BaseCommand):
    help = "Importa os precons de Commander do MTGJSON (idempotente: só adiciona o que falta)."

    def add_arguments(self, parser):
        parser.add_argument("--update", action="store_true", help="Reimporta também os decks que já existem.")
        parser.add_argument("--limit", type=int, help="Importa só os N primeiros (bom para testar).")
        parser.add_argument("--deck", action="append", dest="only", help="fileName do MTGJSON (pode repetir).")
        parser.add_argument("--local-dir", type=Path, help="Lê DeckList.json e decks/*.json de uma pasta local.")
        parser.add_argument("--skip-editions", action="store_true", help="Não busca nomes das edições no Scryfall.")

    def handle(self, *args, **opts):
        source = MtgjsonSource(local_dir=opts["local_dir"])
        result = import_commander_decks(
            source,
            only=opts["only"],
            limit=opts["limit"],
            update=opts["update"],
            log=self.stdout.write,
        )

        if not opts["skip_editions"] and (result.created or result.updated):
            self.stdout.write("Buscando nomes e ícones das edições no Scryfall…")
            n = sync_editions()
            self.stdout.write(f"  {n} edições atualizadas")

        self.stdout.write(self.style.SUCCESS(
            f"Pronto: {len(result.created)} novos, {len(result.updated)} atualizados, "
            f"{len(result.skipped)} já existiam, {len(result.failed)} com erro."
        ))
        for name, err in result.failed:
            self.stderr.write(f"  ✗ {name}: {err}")
        if result.created or result.updated:
            self.stdout.write("Próximo passo: python manage.py sync_scryfall")
