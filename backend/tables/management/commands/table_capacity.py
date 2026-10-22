"""
Quanto uma instância do servidor aguenta de mesa virtual: memória por mesa e tempo de CPU por
jogada (a ação + a atualização mandada para cada jogador, como no servidor de verdade). Não mexe
no banco nem nas mesas abertas: monta mesas de teste na memória com precons do banco.
Veja ESCALA.md para ler os números.
"""

import json
import time
import tracemalloc

from asgiref.sync import async_to_sync
from django.core.management.base import BaseCommand

from decks.models import Deck
from tables import delta, state, store


class Command(BaseCommand):
    help = "Mede memória por mesa e CPU por jogada da mesa virtual (para planejar a escala)."

    def add_arguments(self, parser):
        parser.add_argument("--tables", type=int, default=40, help="Mesas de teste (4 jogadores cada)")
        parser.add_argument("--moves", type=int, default=200, help="Jogadas medidas")

    def handle(self, *args, **opts):
        slugs = list(Deck.objects.values_list("slug", flat=True)[:8])
        if not slugs:
            self.stdout.write(self.style.WARNING("Sem precons no banco: importe os decks antes."))
            return
        decks = [async_to_sync(store.deck_cards)("precon", s) for s in slugs]

        tracemalloc.start()
        base = tracemalloc.get_traced_memory()[0]
        tables = []
        for n in range(opts["tables"]):
            t = state.Table(state.new_table(f"CAPACITY{n:03d}"))
            for uid in range(1, 5):
                t.join(uid, f"p{uid}")
                deck, rows = decks[(n + uid) % len(decks)]
                t.load_deck(uid, deck, rows)
                for _ in range(10):  # 10 cartas no campo de cada um
                    t.draw_to(uid, 1, "battlefield")
            tables.append(t)
        per_table = (tracemalloc.get_traced_memory()[0] - base) / len(tables) / 1024
        tracemalloc.stop()

        # Caminho real: a parte comum é montada uma vez por atualização e cada jogador recebe só a diferença
        t = tables[0]
        prev = {uid: t.view(uid, t.gen) for uid in range(1, 5)}
        sent = 0
        start = time.perf_counter()
        for i in range(opts["moves"]):
            t.change_life(1, -1 if i % 2 else 1)
            t.gen += 1
            for uid in range(1, 5):
                view = t.view(uid, t.gen)
                sent += len(json.dumps(delta.diff(prev[uid], view)))
                prev[uid] = view
        per_move = (time.perf_counter() - start) / opts["moves"] * 1000

        self.stdout.write(f"Memória por mesa (4 jogadores, 10 cartas no campo cada): {per_table:.0f} KB")
        self.stdout.write(f"CPU por jogada (ação + atualização para 4 jogadores): {per_move:.1f} ms")
        self.stdout.write(f"Atualização média por jogador: {sent / opts['moves'] / 4:.0f} bytes")
