"""
Cada ação desfazível, no meio de uma partida, pelo mesmo caminho da mesa (TableConsumer.receive_json):
desfazer volta a mesa exatamente para antes dela. Pega o que mexe na mesa depois da foto do
desfazer (como as conquistas mexiam no lugar do jogador), que fazia o desfazer dar "undo_conflict".
"""

from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase

from tables import consumers, state, store
from tables.tests.test_tables import make_deck

User = get_user_model()
IMG = "https://cards.scryfall.io/normal/x.jpg"
BACK = "https://cards.scryfall.io/normal/back/x.jpg"


def deck_rows():
    def row(name, type_line, qty=1, commander=False, text="", back=""):
        return {"name": name, "image": IMG, "back": back, "quantity": qty, "type_line": type_line,
                "is_commander": commander, "power": "2", "toughness": "2", "loyalty": "", "oracle_text": text,
                "mana_cost": "", "cmc": 2}

    return [
        row("Boss", "Legendary Creature — Bear", commander=True),
        row("Divination", "Sorcery", text="Draw two cards."),
        row("Werebear", "Creature — Bear", back=BACK),
        row("Bear", "Creature — Bear", qty=40),
        row("Forest", "Basic Land — Forest", qty=57),
    ]


class UndoEveryActionTests(TestCase):
    def setUp(self):
        state.TABLES.clear()
        self.ana = User.objects.create_user("ana", "", "x")
        self.beto = User.objects.create_user("beto", "", "x")
        self.slug = make_deck()
        patcher = mock.patch.object(store, "schedule_save")
        patcher.start()
        self.addCleanup(patcher.stop)

    def mid_game(self):
        """Mesa no turno 2, com cartas na mão, no campo (uma virada) e no cemitério."""
        t = state.TABLES["UNDO1"] = state.Table(state.new_table("UNDO1"))
        for user in (self.ana, self.beto):
            t.join(user.id, user.username)
            t.load_deck(user.id, {"kind": "precon", "ref": "x", "name": "X"}, deck_rows())
        a = self.ana.id
        t.pass_turn(a)
        t.draw(a, 7)
        seat = t.seat_of(a)
        named = {c["name"]: cid for cid, c in seat["cards"].items()}
        t.move(a, named["Divination"], "hand")
        t.move(a, named["Werebear"], "battlefield", 0.3, 0.5)
        t.draw_to(a, 3, "battlefield")
        t.draw_to(a, 2, "graveyard")
        t.tap(a, self.field(t)[1])
        t.change_life(a, -5)
        t.pass_turn(a)
        t.pass_turn(self.beto.id)  # turno 3: ana de novo
        t.track_achievements()  # como o consumer faz depois de cada ação
        t.online = {self.ana.id: 1}  # Beto desconectado: o desfazer vale na hora, sem esperar o "ok" dele
        return t

    def field(self, t) -> list[str]:
        seat = t.seat_of(self.ana.id)
        return [i["id"] for i in seat["zones"]["battlefield"] if not seat["cards"][i["id"]].get("commander")]

    def messages(self, t) -> dict[str, dict]:
        seat = t.seat_of(self.ana.id)
        named = {c["name"]: cid for cid, c in seat["cards"].items()}
        bf, hand, lib = self.field(t), seat["zones"]["hand"], seat["zones"]["library"]
        boss = next(cid for cid, c in seat["cards"].items() if c.get("commander"))
        return {
            "load_deck": {"kind": "precon", "ref": self.slug},
            "draw": {"n": 1},
            "move": {"card": hand[0], "to": "battlefield", "x": 0.5, "y": 0.5},
            "tap": {"card": bf[0]},
            "untap_all": {},
            "shuffle": {},
            "mulligan": {},
            "restart": {},
            "life": {"delta": -2},
            "counter": {"card": bf[0], "kind": "+1/+1", "delta": 1},
            "stat": {"card": bf[0], "which": "p", "delta": 1},
            "toggle_stats": {"card": bf[0]},
            "tax": {"card": boss, "delta": 1},
            "cmd_damage": {"from": self.beto.id, "delta": 3},
            "poison": {"delta": 1},
            "token": {"name": "Soldier", "image": IMG, "x": 0.5, "y": 0.5},
            "clone": {"card": bf[0]},
            "pass_turn": {},
            "invert": {"card": bf[0]},
            "highlight": {"card": bf[0]},
            "lock": {"card": bf[0]},
            "note": {"card": bf[0], "text": "alvo"},
            "symbol": {"card": bf[0], "symbol": "attack"},
            "face_down": {"card": bf[0]},
            "flip": {"card": named["Werebear"]},
            "control": {"card": bf[0], "to": self.beto.id},
            "attach": {"card": bf[1], "to": bf[0]},
            "draw_to": {"n": 1, "to": "exile"},
            "top_revealed": {},
            "scoop": {},
            "reorder_top": {"order": [lib[1], lib[0]]},
            "tap_many": {"cards": bf[:2], "tapped": True},
            "move_many": {"cards": hand[:2], "to": "graveyard"},
            "place_many": {"places": [{"card": bf[0], "x": 0.8, "y": 0.2}]},
            "arrange": {},
            "card_action": {"card": named["Divination"], "index": 0},
            "each": {"cards": bf[:2], "action": {"type": "counter", "kind": "+1/+1", "delta": 1}},
        }

    def connection(self, t):
        """O consumer da Ana, sem o WebSocket: o que ele mandaria fica em `sent`."""
        c = consumers.TableConsumer()
        c.user, c.joined, c.code, c.table = self.ana, True, "UNDO1", t
        c.sent_messages = []

        async def send_json(content, close=False):
            c.sent_messages.append(content)

        c.send_json = send_json
        c.broadcast = mock.AsyncMock()
        return c

    def test_every_undoable_action_comes_back_exactly(self):
        kinds = self.messages(self.mid_game())
        self.assertEqual(set(kinds), state.UNDOABLE)  # ação desfazível nova: entra aqui também
        for kind in sorted(kinds):
            with self.subTest(kind=kind):
                t = self.mid_game()
                c = self.connection(t)
                before = t.snapshot()
                async_to_sync(c.receive_json)({"type": kind, **self.messages(t)[kind]})
                errors = [m for m in c.sent_messages if m.get("type") == "error"]
                self.assertEqual(errors, [], "a ação não valeu")
                self.assertTrue(t._undo.get(self.ana.id), "a ação não mudou nada")
                async_to_sync(c.receive_json)({"type": "undo"})
                errors = [m for m in c.sent_messages if m.get("type") == "error"]
                self.assertEqual(errors, [], "o desfazer falhou")
                self.assertEqual(t.snapshot(), before)
