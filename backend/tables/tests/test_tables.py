from asgiref.sync import sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase
from rest_framework.authtoken.models import Token

from decks.models import Card, Deck, DeckCard, Edition
from tables import state
from tables.models import TableGame
from tables.routing import websocket_urlpatterns

app = URLRouter(websocket_urlpatterns)


def make_user(name):
    user = get_user_model().objects.create_user(username=name, email=f"{name}@x.com", password="pw-123456")
    return Token.objects.create(user=user).key


def make_deck():
    ed = Edition.objects.create(code="TST", name="Test")
    deck = Deck.objects.create(name="Test Deck", slug="test-deck", edition=ed)
    for i, (name, qty, cmd) in enumerate([("Boss", 1, True), ("Forest", 30, False), ("Bear", 69, False)]):
        card = Card.objects.create(
            scryfall_id=f"00000000-0000-0000-0000-0000000000{i:02d}", name=name, image_normal=f"https://img/{name}.jpg"
        )
        DeckCard.objects.create(deck=deck, card=card, quantity=qty, is_commander=cmd)
    return deck.slug


class TableSocketTests(TransactionTestCase):
    def setUp(self):
        state.TABLES.clear()

    async def open(self, token, code="ABCD"):
        ws = WebsocketCommunicator(app, f"/ws/tables/{code}/")
        connected, _ = await ws.connect()
        self.assertTrue(connected)
        await ws.send_json_to({"type": "auth", "token": token})
        return ws

    async def latest(self, ws):
        """Última mensagem que chegou (descarta as anteriores)."""
        msg = await ws.receive_json_from()
        while not await ws.receive_nothing(timeout=0.05):
            msg = await ws.receive_json_from()
        return msg

    def player(self, msg, name):
        return next(p for p in msg["players"] if p["name"] == name)

    async def test_life_syncs_between_players(self):
        ana, beto = await sync_to_async(make_user)("ana"), await sync_to_async(make_user)("beto")
        a = await self.open(ana)
        first = await a.receive_json_from()
        self.assertEqual(self.player(first, "ana")["life"], 40)
        b = await self.open(beto)
        joined = await self.latest(b)
        self.assertEqual([(p["name"], p["seat"]) for p in joined["players"]], [("ana", 1), ("beto", 2)])
        await self.latest(a)
        await b.send_json_to({"type": "life", "delta": -3})
        seen = await self.latest(a)
        self.assertEqual(self.player(seen, "beto")["life"], 37)
        self.assertEqual(seen["log"][-1]["kind"], "life")
        await b.disconnect()
        left = await self.latest(a)
        self.assertFalse(self.player(left, "beto")["online"])
        await a.disconnect()

    async def test_deck_draw_and_hidden_hand(self):
        slug = await sync_to_async(make_deck)()
        ana, beto = await sync_to_async(make_user)("ana"), await sync_to_async(make_user)("beto")
        a, b = await self.open(ana), await self.open(beto)
        await self.latest(a)
        await self.latest(b)

        await a.send_json_to({"type": "load_deck", "kind": "precon", "ref": slug})
        mine = self.player(await self.latest(a), "ana")
        self.assertEqual(mine["counts"]["library"], 99)
        self.assertEqual([(c["name"], c["x"], c["y"]) for c in mine["battlefield"]], [("Boss", 1.0, 0.0)])
        await self.latest(b)

        await a.send_json_to({"type": "draw", "n": 7})
        mine = self.player(await self.latest(a), "ana")
        theirs = self.player(await self.latest(b), "ana")
        self.assertEqual(len(mine["hand"]), 7)
        self.assertIsNone(theirs["hand"])  # beto não vê a mão da ana
        self.assertEqual(theirs["counts"]["hand"], 7)

        card = mine["hand"][0]["id"]
        await a.send_json_to({"type": "move", "card": card, "to": "battlefield", "x": 0.25, "y": 0.75})
        theirs = self.player(await self.latest(b), "ana")
        self.assertEqual([(c["id"], c["x"], c["y"]) for c in theirs["battlefield"]][-1], (card, 0.25, 0.75))
        await self.latest(a)

        await a.send_json_to({"type": "tap", "card": card})
        self.assertTrue(self.player(await self.latest(b), "ana")["battlefield"][-1]["tapped"])
        await self.latest(a)

        # beto não pode mexer na carta da ana
        await b.send_json_to({"type": "tap", "card": card})
        self.assertEqual(await b.receive_json_from(), {"type": "error", "code": "not_your_card"})

        # mão → grimório não revela o nome no log
        hidden = mine["hand"][1]["id"]
        await a.send_json_to({"type": "move", "card": hidden, "to": "library", "position": "bottom"})
        log = (await self.latest(b))["log"]
        self.assertIsNone(log[-1]["card"])
        await a.disconnect()
        await b.disconnect()

    async def test_state_survives_restart(self):
        slug = await sync_to_async(make_deck)()
        ana = await sync_to_async(make_user)("ana")
        a = await self.open(ana)
        await self.latest(a)
        await a.send_json_to({"type": "load_deck", "kind": "precon", "ref": slug})
        await self.latest(a)
        await a.send_json_to({"type": "draw", "n": 3})
        await self.latest(a)
        await a.disconnect()
        state.TABLES.clear()  # servidor reiniciou: memória vazia
        self.assertTrue(await sync_to_async(TableGame.objects.filter(code="ABCD").exists)())
        again = await self.open(ana)
        mine = self.player(await self.latest(again), "ana")
        self.assertEqual(len(mine["hand"]), 3)
        self.assertEqual(mine["counts"]["library"], 96)
        await again.disconnect()

    async def test_bad_token_is_closed(self):
        ws = await self.open("nope")
        out = await ws.receive_output()
        self.assertEqual(out, {"type": "websocket.close", "code": 4401})

    async def test_fifth_player_is_refused(self):
        socks = []
        for name in ["p1", "p2", "p3", "p4"]:
            socks.append(await self.open(await sync_to_async(make_user)(name)))
        extra = await self.open(await sync_to_async(make_user)("p5"))
        while (out := await extra.receive_output())["type"] != "websocket.close":
            pass
        self.assertEqual(out["code"], 4403)
        for ws in socks:
            await ws.disconnect()

    async def test_invalid_actions(self):
        ws = await self.open(await sync_to_async(make_user)("ana"))
        await ws.receive_json_from()
        await ws.send_json_to({"type": "life", "delta": 5000})
        self.assertEqual(await ws.receive_json_from(), {"type": "error", "code": "bad_delta"})
        await ws.send_json_to({"type": "draw"})
        self.assertEqual(await ws.receive_json_from(), {"type": "error", "code": "library_empty"})
        await ws.send_json_to({"type": "load_deck", "kind": "precon", "ref": "nope"})
        self.assertEqual(await ws.receive_json_from(), {"type": "error", "code": "deck_not_found"})
        await ws.disconnect()


class TableStateTests(TestCase):
    def table_with_deck(self):
        t = state.Table(state.new_table("ROOM1"))
        t.join(1, "a")
        rows = [
            {"name": "Boss", "image": "", "quantity": 1, "is_commander": True},
            {"name": "Card", "image": "", "quantity": 99, "is_commander": False},
        ]
        t.load_deck(1, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        return t

    def test_prune_removes_idle_empty_tables(self):
        t = state.TABLES["ROOM1"] = state.Table(state.new_table("ROOM1"))
        t.join(1, "a")
        t.leave(1)
        state.prune(now=t.touched + state.IDLE_TTL + 1)
        self.assertNotIn("ROOM1", state.TABLES)

    def test_life_is_clamped(self):
        t = state.Table(state.new_table("ROOM1"))
        t.join(1, "a")
        for _ in range(20):
            t.change_life(1, 100)
        self.assertEqual(t.seat_of(1)["life"], state.LIFE_LIMIT)

    def test_mulligan_and_restart(self):
        t = self.table_with_deck()
        t.draw(1, 7)
        t.mulligan(1)
        zones = t.seat_of(1)["zones"]
        self.assertEqual((len(zones["hand"]), len(zones["library"])), (7, 92))
        card = zones["hand"][0]
        t.move(1, card, "battlefield", 0.1, 0.1)
        commander = zones["battlefield"][0]["id"]
        t.move(1, commander, "graveyard")
        t.change_life(1, -10)
        t.restart(1)
        seat = t.seat_of(1)
        self.assertEqual(len(seat["zones"]["library"]), 99)
        self.assertEqual(seat["zones"]["battlefield"], [{"id": commander, "x": 1.0, "y": 0.0, "tapped": False, "counters": {}}])
        self.assertEqual(seat["life"], 40)

    def test_move_battlefield_reposition_and_library_position(self):
        t = self.table_with_deck()
        t.draw(1, 2)
        a, b = t.seat_of(1)["zones"]["hand"]
        t.move(1, a, "battlefield", 0.2, 0.2)
        t.move(1, a, "battlefield", 2, -1)  # fora da mesa: encosta na borda
        self.assertEqual(t.seat_of(1)["zones"]["battlefield"][-1], {"id": a, "x": 1.0, "y": 0.0, "tapped": False, "counters": {}})
        t.move(1, b, "library", position="bottom")
        self.assertEqual(t.seat_of(1)["zones"]["library"][-1], b)
        t.move(1, a, "library")
        self.assertEqual(t.seat_of(1)["zones"]["library"][0], a)

    def test_old_command_zone_is_moved_to_battlefield(self):
        data = state.new_table("ROOM1")
        t = state.Table(data)
        t.join(1, "a")
        seat = t.seat_of(1)
        seat["cards"]["c1"] = {"name": "Boss", "image": "", "back": "", "commander": True}
        seat["zones"]["command"] = ["c1"]
        again = state.Table(data)
        self.assertEqual(again.seat_of(1)["zones"]["command"], [])
        self.assertEqual(again.seat_of(1)["zones"]["battlefield"][0]["id"], "c1")


class PhaseTwoStateTests(TestCase):
    def setUp(self):
        self.t = state.Table(state.new_table("ROOM2"))
        self.t.join(1, "a")
        self.t.join(2, "b")
        rows = [
            {"name": "Boss", "image": "", "quantity": 1, "is_commander": True},
            {"name": "Card", "image": "", "quantity": 99, "is_commander": False},
        ]
        self.t.load_deck(1, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        self.boss = self.t.seat_of(1)["zones"]["battlefield"][0]["id"]

    def test_counters_tax_and_damage(self):
        t = self.t
        t.counter(1, self.boss, "+1/+1", 3)
        t.counter(1, self.boss, "+1/+1", -1)
        self.assertEqual(t.view(2)["players"][0]["battlefield"][0]["counters"], {"+1/+1": 2})
        t.counter(1, self.boss, "+1/+1", -5)
        self.assertEqual(t.view(2)["players"][0]["battlefield"][0]["counters"], {})
        t.commander_tax(1, self.boss, 1)
        self.assertEqual(t.view(2)["players"][0]["tax"], {self.boss: 1})
        t.commander_damage(2, 1, 7)
        b = t.seat_of(2)
        self.assertEqual((b["cmd_damage"], b["life"]), ({"1": 7}, 33))
        with self.assertRaises(state.ActionError):
            t.commander_damage(2, 2, 1)  # de si mesmo, não
        t.poison(2, 3)
        self.assertEqual(b["poison"], 3)

    def test_peek_reveal_and_search(self):
        t = self.t
        top = t.peek(1, 3)
        self.assertEqual([c["id"] for c in top], t.seat_of(1)["zones"]["library"][:3])
        self.assertEqual(t.data["log"][-1]["kind"], "look")
        self.assertEqual(len(t.peek(1, None)), 99)
        t.reveal(1, top[0]["id"])
        self.assertEqual(t.data["log"][-1]["card"], "Card")
        # buscar e mover direto do grimório
        t.move(1, top[1]["id"], "hand")
        self.assertIn(top[1]["id"], t.seat_of(1)["zones"]["hand"])

    def test_tokens_clone_and_cleanup(self):
        t = self.t
        t.create_token(1, "Soldier", "https://cards.scryfall.io/normal/x.jpg", 0.3, 0.3)
        with self.assertRaises(state.ActionError):
            t.create_token(1, "Evil", "https://evil.example/x.jpg")
        t.clone(1, self.boss)
        field = t.seat_of(1)["zones"]["battlefield"]
        tokens = [i["id"] for i in field if t.seat_of(1)["cards"][i["id"]].get("token")]
        self.assertEqual(len(tokens), 2)
        t.move(1, tokens[0], "graveyard")  # ficha some ao sair do campo
        self.assertNotIn(tokens[0], t.seat_of(1)["cards"])
        self.assertEqual(t.seat_of(1)["zones"]["graveyard"], [])
        t.restart(1)
        self.assertFalse(any(c.get("token") for c in t.seat_of(1)["cards"].values()))

    def test_roll_chat_and_log_ids(self):
        t = self.t
        t.roll(1, 20)
        self.assertTrue(1 <= t.data["log"][-1]["n"] <= 20)
        with self.assertRaises(state.ActionError):
            t.roll(1, 7)
        t.chat(2, "  hi  ")
        last = t.data["log"][-1]
        self.assertEqual((last["kind"], last["text"]), ("chat", "hi"))
        ids = [e["id"] for e in t.data["log"]]
        self.assertEqual(ids, sorted(set(ids)))

    def test_dealt_decks_are_claimed(self):
        data = state.new_table("DRAW1", [{"position": 1, "player": "a", "user_id": 1, "deck": {"kind": "precon", "ref": "x", "name": "X"}}])
        t = state.Table(data)
        t.join(1, "a")
        self.assertEqual(t.dealt_for(1)["ref"], "x")
        t.claim_dealt(1, {"kind": "precon", "ref": "x", "name": "X"})
        self.assertIsNone(t.dealt_for(1))
        self.assertTrue(t.view(1)["dealt"][0]["claimed"])


class PlayNowTests(TransactionTestCase):
    def setUp(self):
        state.TABLES.clear()

    async def test_room_player_gets_dealt_deck_automatically(self):
        from decks.models import Draw, DrawEntry

        slug = await sync_to_async(make_deck)()
        key = await sync_to_async(make_user)("ana")

        def make_draw():
            user = get_user_model().objects.get(username="ana")
            draw = Draw.objects.create(code="abc234")
            DrawEntry.objects.create(draw=draw, position=1, player_name="Ana", player=user, deck=Deck.objects.get(slug=slug))

        await sync_to_async(make_draw)()
        ws = WebsocketCommunicator(app, "/ws/tables/ABC234/")
        await ws.connect()
        await ws.send_json_to({"type": "auth", "token": key})
        msg = await ws.receive_json_from()
        while not await ws.receive_nothing(timeout=0.1):
            msg = await ws.receive_json_from()
        me = msg["players"][0]
        self.assertEqual(me["deck"]["ref"], slug)
        self.assertEqual(me["counts"]["library"], 99)
        self.assertTrue(msg["dealt"][0]["claimed"])
        await ws.send_json_to({"type": "peek", "n": 2})
        peek = await ws.receive_json_from()
        self.assertEqual((peek["type"], len(peek["cards"])), ("peek", 2))
        await ws.disconnect()
