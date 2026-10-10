import time
import urllib.parse
from datetime import timedelta

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from decks.models import OracleTag, TagSync
from decks.services.analysis import TAG_QUERIES
from decks.services.http import fetch_json

SEARCH = "https://api.scryfall.com/cards/search"


class Command(BaseCommand):
    help = (
        "Baixa do Scryfall a função das cartas (tutor, ramp, compra, remoção...) usada na análise dos decks. "
        "Cerca de 100 consultas (~1 minuto). Depois recalcula o nível de poder dos decks."
    )

    def add_arguments(self, parser):
        parser.add_argument("--older-than", type=int, metavar="DIAS", help="Só as tags baixadas há mais que isso")
        parser.add_argument("--pause", type=float, default=0.12, help="Pausa entre páginas (o Scryfall pede 50-100 ms)")

    def handle(self, *args, **opts):
        changed = False
        for tag, query in TAG_QUERIES.items():
            state = TagSync.objects.filter(tag=tag).first()
            if opts["older_than"] and state and state.synced_at > timezone.now() - timedelta(days=opts["older_than"]):
                continue
            try:
                ids = self.fetch(f"{query} f:commander", opts["pause"])
            except Exception as exc:  # rede, Scryfall fora... não derruba o deploy
                self.stdout.write(self.style.WARNING(f"  {tag}: não baixado ({exc})"))
                continue
            with transaction.atomic():
                OracleTag.objects.filter(tag=tag).delete()
                OracleTag.objects.bulk_create([OracleTag(oracle_id=oid, tag=tag) for oid in ids], batch_size=1000)
                TagSync.objects.update_or_create(tag=tag, defaults={"synced_at": timezone.now(), "cards": len(ids)})
            changed = True
            self.stdout.write(f"  {tag}: {len(ids)} cartas")
        if changed:
            call_command("analyze_decks", stdout=self.stdout)
        else:
            self.stdout.write("Tags em dia.")

    def fetch(self, query: str, pause: float) -> set:
        url = f"{SEARCH}?{urllib.parse.urlencode({'q': query, 'unique': 'cards'})}"
        ids = set()
        while url:
            page = fetch_json(url, timeout=60)
            for card in page.get("data", []):
                oid = card.get("oracle_id") or (card.get("card_faces") or [{}])[0].get("oracle_id")
                if oid:
                    ids.add(oid)
            url = page.get("next_page") if page.get("has_more") else None
            time.sleep(pause)
        return ids
