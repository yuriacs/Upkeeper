"""Mesa com "esconder os decks até a partida começar" (table_setup hide_decks, Table.hides_deck)."""

from django.test import SimpleTestCase

from tables import state

ROWS = [
    {"name": "Boss", "image": "", "quantity": 1, "is_commander": True, "type_line": "Legendary Creature"},
    {"name": "Bear", "image": "", "quantity": 99, "is_commander": False, "type_line": "Creature — Bear"},
]


def table(hide=True, practice=False) -> state.Table:
    t = state.Table(state.new_table("HIDE", setup=state.table_setup({"hide_decks": hide, "practice": practice}, 1)))
    for uid in (1, 2):
        t.join(uid, f"p{uid}")
        t.data["seats"][str(uid)]["playmat"] = f"https://img/{uid}.png"
        t.load_deck(uid, {"kind": "precon", "ref": f"d{uid}", "name": f"Deck {uid}"}, ROWS)
    return t


def player(view: dict, uid: int) -> dict:
    return next(p for p in view["players"] if p["id"] == uid)


class HideDecksTests(SimpleTestCase):
    def test_others_do_not_see_deck_commander_or_playmat_before_the_first_turn(self):
        t = table()
        self.assertTrue(t.options()["hide_decks"])
        view = t.view(1)
        me, other = player(view, 1), player(view, 2)
        self.assertEqual(me["deck"]["name"], "Deck 1")
        self.assertEqual(len(me["battlefield"]), 1)  # o meu comandante eu vejo
        self.assertEqual(other["deck"], {"kind": "hidden", "ref": "", "name": ""})
        self.assertIsNone(other["playmat"])
        self.assertEqual(other["battlefield"], [])
        self.assertEqual(other["counts"]["battlefield"], 0)
        self.assertEqual(other["counts"]["library"], 99)
        loads = [e for e in view["log"] if e["kind"] == "deck"]
        self.assertEqual([e["deck"] for e in loads], ["Deck 1", None])
        # Espectador e a lista de mesas também não veem
        self.assertEqual(player(t.view(9), 1)["deck"]["kind"], "hidden")
        self.assertEqual([p["deck"] for p in t.summary(1)["players"]], ["Deck 1", None])
        self.assertEqual([p["deck"] for p in t.summary(None)["players"]], [None, None])

    def test_first_turn_reveals_everything(self):
        t = table()
        t.pass_turn(2)
        self.assertFalse(t.options()["hide_decks"])
        other = player(t.view(1), 2)
        self.assertEqual(other["deck"]["name"], "Deck 2")
        self.assertEqual(other["playmat"], "https://img/2.png")
        self.assertEqual(len(other["battlefield"]), 1)
        reveals = [e["deck"] for e in t.data["log"] if e["kind"] == "reveal_deck"]
        self.assertEqual(sorted(reveals), ["Deck 1", "Deck 2"])
        # Partida nova na mesma mesa: escondidos de novo até o próximo primeiro turno
        t.new_game(1)
        self.assertEqual(player(t.view(1), 2)["deck"]["kind"], "hidden")

    def test_off_by_default_and_never_in_practice(self):
        self.assertEqual(player(table(hide=False).view(1), 2)["deck"]["name"], "Deck 2")
        self.assertFalse(state.table_setup({"hide_decks": True, "practice": True}, 1)["hide_decks"])
        t = table(hide=False)
        t.pass_turn(1)
        self.assertNotIn("reveal_deck", [e["kind"] for e in t.data["log"]])
