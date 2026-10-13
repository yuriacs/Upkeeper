import asyncio
import time

from asgiref.sync import sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase
from rest_framework.authtoken.models import Token

from decks.models import Card, Deck, DeckCard, Edition
from tables import closer, consumers, state
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
        consumers._loading.clear()

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

        # beto pode virar a carta da ana no campo (fica no log), mas não arrastar nem mexer na mão dela
        await b.send_json_to({"type": "tap", "card": card})
        self.assertFalse(self.player(await self.latest(b), "ana")["battlefield"][-1]["tapped"])
        await self.latest(a)
        await b.send_json_to({"type": "move", "card": card, "to": "battlefield", "x": 0.1, "y": 0.1})
        self.assertEqual(await b.receive_json_from(), {"type": "error", "code": "not_your_card", "ack": 0})
        await b.send_json_to({"type": "move", "card": mine["hand"][2]["id"], "to": "graveyard"})
        self.assertEqual(await b.receive_json_from(), {"type": "error", "code": "not_your_card", "ack": 0})

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
        self.assertEqual(await ws.receive_json_from(), {"type": "error", "code": "bad_delta", "ack": 0})
        await ws.send_json_to({"type": "draw"})
        self.assertEqual(await ws.receive_json_from(), {"type": "error", "code": "library_empty", "ack": 0})
        await ws.send_json_to({"type": "load_deck", "kind": "precon", "ref": "nope"})
        self.assertEqual(await ws.receive_json_from(), {"type": "error", "code": "deck_not_found", "ack": 0})
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

    def test_idle_clock(self):
        t = state.Table(state.new_table("ROOM1"))
        start = t.data["changed_at"]
        self.assertEqual(t.idle_left(start + 60), state.IDLE_CLOSE - 60)
        self.assertFalse(t.expired(start + state.IDLE_CLOSE - 1))
        self.assertTrue(t.expired(start + state.IDLE_CLOSE + 1))
        t.data["changed_at"] = start - 500
        t.join(1, "a")  # lugar novo conta como alteração
        self.assertGreater(t.data["changed_at"], start - 1)
        t.data["changed_at"] = start - 500
        t.leave(1)
        t.join(1, "a")  # voltar ao mesmo lugar (reconexão) não conta
        self.assertEqual(t.data["changed_at"], start - 500)

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
        self.assertEqual(seat["zones"]["battlefield"], [{"id": commander, "x": 1.0, "y": 0.0, "tapped": False, "counters": {}, "stats": None}])
        self.assertEqual(seat["life"], 40)

    def test_move_battlefield_reposition_and_library_position(self):
        t = self.table_with_deck()
        t.draw(1, 2)
        a, b = t.seat_of(1)["zones"]["hand"]
        t.move(1, a, "battlefield", 0.2, 0.2)
        t.move(1, a, "battlefield", 2, -1)  # fora da mesa: encosta na borda
        self.assertEqual(t.seat_of(1)["zones"]["battlefield"][-1], {"id": a, "x": 1.0, "y": 0.0, "tapped": False, "counters": {}, "stats": None, "attached_to": None})
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
            t.roll(1, 1)  # d7 agora vale (dado personalizado); 1 lado não
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
        consumers._loading.clear()

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


class TurnTests(TestCase):
    def test_pass_turn_cycles_seats(self):
        t = state.Table(state.new_table("TURN1"))
        for uid, name in [(1, "a"), (2, "b"), (3, "c")]:
            t.join(uid, name)
        t.pass_turn(2)  # ninguém tinha o turno: quem aperta começa
        self.assertEqual(t.view(1)["turn"], {"player": 2, "number": 1})
        with self.assertRaises(state.ActionError):
            t.pass_turn(1)  # não é a vez dele (e o b está online)
        t.pass_turn(2)
        self.assertEqual(t.data["turn"]["player"], 3)
        t.pass_turn(3)
        self.assertEqual(t.data["turn"], {"player": 1, "number": 3})
        self.assertEqual(t.data["log"][-1]["next"], "a")
        t.leave(1)  # quem está com o turno caiu: outro pode passar
        t.pass_turn(2)
        self.assertEqual(t.data["turn"]["player"], 2)


class EndGameTests(TestCase):
    def test_end_and_new_game(self):
        t = state.Table(state.new_table("END01", [{"position": 2, "player": "B", "user_id": 2, "deck": {"kind": "precon", "ref": "x", "name": "X"}}]))
        t.join(1, "a")
        t.join(2, "b")
        rows = [{"name": "Card", "image": "", "quantity": 10, "is_commander": False}]
        t.load_deck(2, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        t.claim_dealt(2, {"kind": "precon", "ref": "x", "name": "X"})
        t.pass_turn(1)
        t.draw(2, 3)
        self.assertEqual(t.end_game(1, 2), 2)  # posição do vencedor no sorteio
        self.assertEqual(t.view(1)["result"]["winner_name"], "b")
        with self.assertRaises(state.ActionError):
            t.end_game(1, 99)
        t.new_game(2)
        v = t.view(2)
        self.assertIsNone(v["result"])
        self.assertEqual(v["turn"], {"player": None, "number": 0})
        self.assertEqual(t.seat_of(2)["zones"]["library"].__len__(), 10)


class StatsTests(TestCase):
    def test_creatures_enter_with_stats_and_walkers_with_loyalty(self):
        t = state.Table(state.new_table("STAT1"))
        t.join(1, "a")
        rows = [
            {"name": "Apex Devastator", "image": "", "quantity": 1, "is_commander": True, "power": "10", "toughness": "10"},
            {"name": "Goyf", "image": "", "quantity": 1, "is_commander": False, "power": "*", "toughness": "1+*"},
            {"name": "Jace", "image": "", "quantity": 1, "is_commander": False, "loyalty": "3"},
            {"name": "Sol Ring", "image": "", "quantity": 1, "is_commander": False},
        ]
        t.load_deck(1, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        seat = t.seat_of(1)
        apex = seat["zones"]["battlefield"][0]
        self.assertEqual(apex["stats"], {"p": 10, "t": 10})
        for cid in list(seat["zones"]["library"]):
            t.move(1, cid, "battlefield", 0.5, 0.5)
        by_name = {seat["cards"][i["id"]]["name"]: i for i in seat["zones"]["battlefield"]}
        self.assertEqual(by_name["Goyf"]["stats"], {"p": 0, "t": 1})
        self.assertEqual(by_name["Jace"]["counters"], {"Loyalty": 3})
        self.assertIsNone(by_name["Sol Ring"]["stats"])

        t.stat(1, apex["id"], "p", 2)
        t.stat(1, apex["id"], "t", -3)
        view = next(c for c in t.view(1)["players"][0]["battlefield"] if c["id"] == apex["id"])
        self.assertEqual((view["stats"], view["base"]), ({"p": 12, "t": 7}, {"p": 10, "t": 10}))
        with self.assertRaises(state.ActionError):
            t.stat(1, by_name["Sol Ring"]["id"], "p", 1)
        t.toggle_stats(1, by_name["Sol Ring"]["id"])  # vira criatura (ex.: animado): começa em 0/0
        self.assertEqual(by_name["Sol Ring"]["stats"], {"p": 0, "t": 0})
        t.toggle_stats(1, by_name["Sol Ring"]["id"])
        self.assertIsNone(by_name["Sol Ring"]["stats"])
        # saiu do campo e voltou: volta com a força/resistência impressa
        t.move(1, apex["id"], "hand")
        t.move(1, apex["id"], "battlefield", 0.1, 0.1)
        self.assertEqual(seat["zones"]["battlefield"][-1]["stats"], {"p": 10, "t": 10})


class ClosingTests(TransactionTestCase):
    """Mesa fecha depois de 10 minutos sem alteração, ou quando um jogador encerra."""

    def setUp(self):
        state.TABLES.clear()
        consumers._loading.clear()

    open = TableSocketTests.open
    latest = TableSocketTests.latest

    async def closed_with(self, ws):
        msg = await ws.receive_json_from()
        while msg["type"] != "closed":
            msg = await ws.receive_json_from()
        out = await ws.receive_output()
        self.assertEqual(out, {"type": "websocket.close", "code": closer.CLOSE_CODE})
        return msg

    async def test_actions_renew_and_idle_table_closes(self):
        ana = await sync_to_async(make_user)("ana")
        a = await self.open(ana)
        first = await self.latest(a)
        self.assertEqual(first["idle_close"], state.IDLE_CLOSE)
        table = state.TABLES["ABCD"]
        table.data["changed_at"] -= 300
        await a.send_json_to({"type": "keep_alive"})
        await self.latest(a)
        self.assertGreater(table.idle_left(), state.IDLE_CLOSE - 5)
        await a.send_json_to({"type": "life", "delta": -1})
        await self.latest(a)
        await asyncio.sleep(1)  # deixa a gravação em segundo plano terminar
        self.assertTrue(await sync_to_async(TableGame.objects.filter(code="ABCD").exists)())

        self.assertEqual(await closer.sweep(now=time.time() + state.IDLE_CLOSE + 1), ["ABCD"])
        msg = await self.closed_with(a)
        self.assertEqual(msg["reason"], "idle")
        self.assertNotIn("ABCD", state.TABLES)
        self.assertFalse(await sync_to_async(TableGame.objects.filter(code="ABCD").exists)())
        # O mesmo código abre uma mesa nova, vazia
        again = await self.open(ana)
        fresh = await self.latest(again)
        self.assertEqual(fresh["players"][0]["life"], 40)
        await again.disconnect()

    async def test_player_closes_table(self):
        ana, beto = await sync_to_async(make_user)("ana"), await sync_to_async(make_user)("beto")
        a, b = await self.open(ana), await self.open(beto)
        await self.latest(a)
        await self.latest(b)
        await b.send_json_to({"type": "close_table"})
        for ws in (a, b):
            msg = await self.closed_with(ws)
            self.assertEqual((msg["reason"], msg["by"]), ("closed", "beto"))
        self.assertEqual(state.TABLES, {})
        self.assertFalse(await sync_to_async(TableGame.objects.filter(code="ABCD").exists)())

    async def test_expired_saved_table_starts_over(self):
        ana = await sync_to_async(make_user)("ana")
        old = state.new_table("ABCD")
        old["changed_at"] = time.time() - state.IDLE_CLOSE - 5
        old["seats"]["99"] = state.new_seat(99, "velho", 1)
        await sync_to_async(TableGame.objects.create)(code="ABCD", data=old)
        a = await self.open(ana)
        msg = await self.latest(a)
        self.assertEqual([p["name"] for p in msg["players"]], ["ana"])
        await a.disconnect()


class MyTablesApiTests(TransactionTestCase):
    def setUp(self):
        state.TABLES.clear()
        consumers._loading.clear()

    def test_lists_only_open_tables_with_my_seat(self):
        from rest_framework.test import APIClient

        token = make_user("ana")
        ana_id = Token.objects.get(key=token).user_id
        live = state.TABLES["LIVE1"] = state.Table(state.new_table("LIVE1"))
        live.join(ana_id, "ana")
        live.join(999, "beto")
        other = state.TABLES["OTHER"] = state.Table(state.new_table("OTHER"))
        other.join(999, "beto")
        saved = state.new_table("SAVED")
        saved["seats"][str(ana_id)] = state.new_seat(ana_id, "ana", 1)
        TableGame.objects.create(code="SAVED", data=saved)
        stale = state.new_table("STALE")
        stale["seats"][str(ana_id)] = state.new_seat(ana_id, "ana", 1)
        stale["changed_at"] = time.time() - state.IDLE_CLOSE - 5
        TableGame.objects.create(code="STALE", data=stale)

        client = APIClient()
        self.assertEqual(client.get("/api/tables/mine/").status_code, 401)
        client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        res = client.get("/api/tables/mine/").json()
        self.assertEqual(sorted(t["code"] for t in res["tables"]), ["LIVE1", "SAVED"])
        live_row = next(t for t in res["tables"] if t["code"] == "LIVE1")
        self.assertEqual([(p["name"], p["online"], p["you"]) for p in live_row["players"]],
                         [("ana", True, True), ("beto", True, False)])


class OpeningAndDiceTests(TestCase):
    def test_opening_phase_ends_when_player_passes_first_turn(self):
        t = state.Table(state.new_table("ROOM1"))
        t.join(1, "a")
        t.join(2, "b")
        rows = [{"name": "Card", "image": "", "quantity": 99, "is_commander": False}]
        for uid in (1, 2):
            t.load_deck(uid, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        opening = lambda: {p["name"]: p["opening"] for p in t.view(1)["players"]}
        self.assertEqual(opening(), {"a": True, "b": True})
        t.pass_turn(1)  # a começa: ainda ninguém passou
        self.assertEqual(opening(), {"a": True, "b": True})
        t.pass_turn(1)  # a passa o primeiro turno
        self.assertEqual(opening(), {"a": False, "b": True})
        t.pass_turn(2)
        self.assertEqual(opening(), {"a": False, "b": False})
        t.restart(1)
        self.assertEqual(opening(), {"a": True, "b": False})
        t.new_game(2)
        self.assertEqual(opening(), {"a": True, "b": True})

    def test_custom_die(self):
        t = state.Table(state.new_table("ROOM1"))
        t.join(1, "a")
        t.roll(1, 37)
        entry = t.data["log"][-1]
        self.assertEqual(entry["sides"], 37)
        self.assertTrue(1 <= entry["n"] <= 37)
        for bad in (1, 0, state.MAX_DIE + 1):
            with self.assertRaises(state.ActionError):
                t.roll(1, bad)


class ShakeTests(TestCase):
    def test_shake_any_battlefield_card(self):
        t = state.Table(state.new_table("ROOM1"))
        t.join(1, "a")
        t.join(2, "b")
        rows = [{"name": "Boss", "image": "", "quantity": 1, "is_commander": True},
                {"name": "Card", "image": "", "quantity": 9, "is_commander": False}]
        for uid in (1, 2):
            t.load_deck(uid, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        boss_b = t.seat_of(2)["zones"]["battlefield"][0]["id"]
        t.shake(1, boss_b)  # a sacode a carta do oponente
        last = t.data["log"][-1]
        self.assertEqual((last["kind"], last["who"], last["owner"], last["card"], last["ref"]),
                         ("shake", "a", "b", "Boss", boss_b))
        with self.assertRaises(state.ActionError) as err:
            t.shake(1, boss_b)  # rápido demais
        self.assertEqual(err.exception.code, "too_fast")
        t._shaken.clear()
        in_library = t.seat_of(2)["zones"]["library"][0]
        with self.assertRaises(state.ActionError):
            t.shake(1, in_library)  # só cartas no campo
        with self.assertRaises(state.ActionError):
            t.shake(1, "nope")


class SharedFieldTests(TestCase):
    """Ações no campo valem para qualquer carta; a mão e as pilhas continuam só do dono."""

    def setUp(self):
        t = self.t = state.Table(state.new_table("ROOM1"))
        t.join(1, "a")
        t.join(2, "b")
        t.join(3, "c")
        rows = [
            {"name": "Boss", "image": "img-boss", "back": "img-boss-back", "quantity": 1, "is_commander": True,
             "power": "3", "toughness": "3"},
            {"name": "Bear", "image": "img-bear", "quantity": 9, "is_commander": False, "power": "2", "toughness": "2"},
        ]
        for uid in (1, 2, 3):
            t.load_deck(uid, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        self.boss_b = t.seat_of(2)["zones"]["battlefield"][0]["id"]
        t.draw(1, 3)
        self.bear_a = t.seat_of(1)["zones"]["hand"][0]
        t.move(1, self.bear_a, "battlefield", 0.3, 0.6)

    def field(self, viewer, board):
        return {c["id"]: c for c in next(p for p in self.t.view(viewer)["players"] if p["id"] == board)["battlefield"]}

    def test_marks_on_opponent_card(self):
        t, boss = self.t, self.boss_b
        t.invert(1, boss)
        t.highlight(1, boss)
        t.lock(1, boss)
        t.note(1, boss, "  não   desvira ")
        t.symbol(1, boss, "attack")
        # números da carta (marcadores, força/resistência) só quem controla muda
        for change in (lambda u: t.counter(u, boss, "+1/+1", 2), lambda u: t.stat(u, boss, "p", 1), lambda u: t.toggle_stats(u, boss)):
            with self.assertRaisesMessage(state.ActionError, "not_controller"):
                change(1)
        t.counter(2, boss, "+1/+1", 2)
        t.stat(2, boss, "p", 1)
        c = self.field(3, 2)[boss]
        self.assertEqual(
            (c["inverted"], c["highlight"], c["locked"], c["note"], c["symbols"], c["counters"], c["stats"]),
            (True, True, True, "não desvira", ["attack"], {"+1/+1": 2}, {"p": 4, "t": 3}),
        )
        last = next(e for e in reversed(t.data["log"]) if e["kind"] == "symbol")
        self.assertEqual((last["who"], last["owner"], last["card"]), ("a", "b", "Boss"))
        # com o controle, o oponente passa a poder
        t.give_control(2, boss, 1)
        t.counter(1, boss, "+1/+1", 1)
        self.assertEqual(self.field(3, 1)[boss]["counters"], {"+1/+1": 3})
        t.give_control(1, boss, 2)
        with self.assertRaises(state.ActionError):
            t.symbol(1, boss, "nope")
        with self.assertRaises(state.ActionError):
            t.note(1, boss, "x" * 121)
        # travada: nem o dono arrasta
        with self.assertRaises(state.ActionError):
            t.move(2, boss, "battlefield", 0.5, 0.5)

    def test_face_down_hides_card_from_others(self):
        t, boss = self.t, self.boss_b
        t.face_down(2, boss)
        mine, theirs = self.field(2, 2)[boss], self.field(1, 2)[boss]
        self.assertEqual((mine["name"], mine["face_down"]), ("Boss", True))
        self.assertEqual((theirs["name"], theirs["image"], theirs["base"], theirs["stats"]), ("", "", None, {"p": 2, "t": 2}))
        self.assertIsNone(t.data["log"][-1]["card"])
        t.move(1, boss, "graveyard")  # a destrói: vai para o cemitério do dono, revelada
        self.assertIn(boss, t.seat_of(2)["zones"]["graveyard"])
        self.assertEqual((t.data["log"][-1]["card"], t.data["log"][-1]["owner"]), ("Boss", "b"))

    def test_flip_shows_back_face(self):
        t, boss = self.t, self.boss_b
        t.flip(3, boss)
        self.assertEqual(self.field(1, 2)[boss]["image"], "img-boss-back")
        with self.assertRaises(state.ActionError):
            t.flip(1, self.bear_a)  # sem verso

    def test_control_moves_card_to_other_board_and_back(self):
        t, bear = self.t, self.bear_a
        t.give_control(1, bear, 2)
        self.assertNotIn(bear, self.field(1, 1))
        self.assertEqual(self.field(1, 2)[bear]["controller"], 2)
        t.move(2, bear, "battlefield", 0.9, 0.9)  # quem controla arrasta
        t.tap(2, bear)
        t.untap_all(2)
        self.assertFalse(self.field(1, 2)[bear]["tapped"])
        t.move(2, bear, "hand")  # volta para a mão do dono
        self.assertIn(bear, t.seat_of(1)["zones"]["hand"])
        t.move(1, bear, "battlefield", 0.5, 0.5)
        self.assertIsNone(self.field(1, 1)[bear]["controller"])

    def test_attach_follows_host_and_detaches_when_host_leaves(self):
        t, bear, boss = self.t, self.bear_a, self.boss_b
        t.attach(1, bear, boss)  # aura da a na carta do b: aparece no campo do b
        self.assertEqual(self.field(1, 2)[bear]["attached_to"], boss)
        self.assertNotIn(bear, self.field(1, 1))
        with self.assertRaises(state.ActionError):
            t.attach(1, bear, bear)
        t.move(2, boss, "exile")
        self.assertIsNone(self.field(1, 1)[bear]["attached_to"])

    def test_clone_and_target(self):
        t, boss = self.t, self.boss_b
        t.clone(1, boss)
        tokens = [c for c in self.field(1, 1).values() if c["token"]]
        self.assertEqual([c["name"] for c in tokens], ["Boss"])
        t.target(1, self.bear_a, to_card=boss)
        last = t.data["log"][-1]
        self.assertEqual((last["kind"], last["ref"], last["to_ref"], last["to"]), ("target", self.bear_a, boss, "Boss"))
        t._shaken.clear()
        t.target(1, self.bear_a, to_player=3)
        self.assertEqual((t.data["log"][-1]["to"], t.data["log"][-1]["to_seat"]), ("c", 3))
        with self.assertRaises(state.ActionError):
            t.target(1, self.bear_a, to_player=99)


class LibraryMenuTests(TestCase):
    def setUp(self):
        t = self.t = state.Table(state.new_table("ROOM1"))
        t.join(1, "a")
        t.join(2, "b")
        rows = [{"name": "Boss", "image": "boss", "quantity": 1, "is_commander": True}] + [
            {"name": f"C{i}", "image": f"img{i}", "quantity": 1, "is_commander": False} for i in range(10)
        ]
        t.load_deck(1, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        self.lib = t.seat_of(1)["zones"]["library"]

    def test_draw_to_from_top_and_bottom(self):
        t, lib = self.t, self.lib
        top2, bottom1 = lib[:2], lib[-1]
        t.draw_to(1, 2, "graveyard")
        self.assertEqual(t.seat_of(1)["zones"]["graveyard"], top2)
        self.assertIn(t.seat_of(1)["cards"][top2[0]]["name"], t.data["log"][-1]["text"])
        t.draw_to(1, 1, "battlefield_down", bottom=True)
        item = t.seat_of(1)["zones"]["battlefield"][-1]
        self.assertEqual((item["id"], item["face_down"]), (bottom1, True))
        self.assertIsNone(t.data["log"][-1]["text"])  # virada: ninguém vê o nome
        t.draw_to(1, 1, "facedown")
        t.draw_to(1, 1, "hand")
        self.assertEqual(len(lib), 5)
        with self.assertRaises(state.ActionError):
            t.draw_to(1, 1, "library")

    def test_reveal_top_and_keep_top_revealed(self):
        t, lib = self.t, self.lib
        t.reveal_top(1, 3)
        self.assertEqual([c["image"] for c in t.data["log"][-1]["cards"]], [t.seat_of(1)["cards"][c]["image"] for c in lib[:3]])
        self.assertIsNone(t.view(2)["players"][0]["top"])
        t.toggle_top_revealed(1)
        self.assertEqual(t.view(2)["players"][0]["top"]["id"], lib[0])

    def test_last_draw_and_scoop(self):
        t = self.t
        with self.assertRaises(state.ActionError):
            t.reveal_last_draw(1)
        t.draw(1, 2)
        t.reveal_last_draw(1)
        self.assertEqual(t.data["log"][-1]["kind"], "reveal")
        t.scoop(1)
        zones = t.seat_of(1)["zones"]
        self.assertEqual((len(zones["library"]), zones["hand"], zones["battlefield"]), (11, [], []))


class SelectionAndAttachTests(TestCase):
    def setUp(self):
        t = self.t = state.Table(state.new_table("ROOM1"))
        t.join(1, "a")
        t.join(2, "b")
        rows = [
            {"name": "Sword", "image": "s", "quantity": 1, "is_commander": False, "type_line": "Artifact — Equipment"},
            {"name": "Pacifism", "image": "p", "quantity": 1, "is_commander": False, "type_line": "Enchantment — Aura"},
            {"name": "Bear", "image": "b", "quantity": 8, "is_commander": False, "type_line": "Creature — Bear"},
        ]
        for uid in (1, 2):
            t.load_deck(uid, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        self.a = list(t.seat_of(1)["zones"]["library"])
        self.b = list(t.seat_of(2)["zones"]["library"])
        t.draw_to(1, 10, "battlefield")
        t.draw_to(2, 10, "battlefield")

    def test_attach_kind_from_type_line(self):
        kinds = {c["name"]: c["attach"] for c in self.t.view(1)["players"][0]["battlefield"]}
        self.assertEqual((kinds["Sword"], kinds["Pacifism"], kinds["Bear"]), ("equipment", "aura", None))

    def test_tap_move_and_place_many(self):
        t, a, b = self.t, self.a, self.b
        t.tap_many(1, [a[0], a[1], b[0]], True)  # inclui carta do oponente
        field = {i["id"]: i for s in t.data["seats"].values() for i in s["zones"]["battlefield"]}
        self.assertTrue(all(field[c]["tapped"] for c in (a[0], a[1], b[0])))
        t.place_many(1, [{"card": a[2], "x": 0.1, "y": 0.2}, {"card": a[3], "x": 0.2, "y": 0.2}])
        self.assertEqual((field[a[2]]["x"], field[a[3]]["x"]), (0.1, 0.2))
        with self.assertRaises(state.ActionError):
            t.place_many(1, [{"card": b[1], "x": 0.1, "y": 0.1}])  # arrastar é de quem controla
        t.move_many(1, [a[0], b[0]], "graveyard")
        self.assertIn(a[0], t.seat_of(1)["zones"]["graveyard"])
        self.assertIn(b[0], t.seat_of(2)["zones"]["graveyard"])
        last = t.data["log"][-1]
        self.assertEqual((last["kind"], last["n"]), ("move_many", 2))
        with self.assertRaises(state.ActionError):
            t.move_many(1, [], "exile")


class SymbolsAndScryTests(TestCase):
    def setUp(self):
        t = self.t = state.Table(state.new_table("ROOM1"))
        t.join(1, "a")
        rows = [{"name": "Boss", "image": "", "quantity": 1, "is_commander": True}] + [
            {"name": f"C{i}", "image": "", "quantity": 1, "is_commander": False} for i in range(6)
        ]
        t.load_deck(1, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        self.boss = t.seat_of(1)["zones"]["battlefield"][0]

    def test_several_symbols_toggle(self):
        t, boss = self.t, self.boss
        t.symbol(1, boss["id"], "flying")
        t.symbol(1, boss["id"], "deathtouch")
        self.assertEqual(t.view(1)["players"][0]["battlefield"][0]["symbols"], ["flying", "deathtouch"])
        t.symbol(1, boss["id"], "flying")
        self.assertEqual(boss["symbols"], ["deathtouch"])
        t.symbol(1, boss["id"], None)
        self.assertEqual(boss["symbols"], [])
        boss.pop("symbols")
        boss["symbol"] = "star"  # mesa salva por uma versão antiga
        self.assertEqual(t.view(1)["players"][0]["battlefield"][0]["symbols"], ["star"])

    def test_reorder_top(self):
        t = self.t
        lib = t.seat_of(1)["zones"]["library"]
        top3, rest = lib[:3], lib[3:]
        t.reorder_top(1, [top3[2], top3[0], top3[1]])
        self.assertEqual(lib, [top3[2], top3[0], top3[1], *rest])
        with self.assertRaises(state.ActionError):
            t.reorder_top(1, [rest[0], top3[0]])  # só cartas do topo
        with self.assertRaises(state.ActionError):
            t.reorder_top(1, [top3[0], top3[0]])


class UndoTests(TestCase):
    """Desfazer: só as próprias ações; com outros conectados, todos precisam aprovar."""

    def setUp(self):
        t = self.t = state.Table(state.new_table("ROOM1"))
        t.join(1, "a")
        t.join(2, "b")
        rows = [{"name": "Boss", "image": "", "quantity": 1, "is_commander": True}] + [
            {"name": f"C{i}", "image": "", "quantity": 1, "is_commander": False} for i in range(9)
        ]
        for uid in (1, 2):
            t.load_deck(uid, {"kind": "precon", "ref": "x", "name": "X"}, rows)

    def act(self, uid, kind, fn):
        before, seq = self.t.snapshot(), self.t.data["seq"]
        fn()
        self.t.record_undo(uid, kind, before, seq)

    def test_alone_undoes_at_once(self):
        t = self.t
        t.leave(2)  # b saiu: a está sozinho
        self.act(1, "draw", lambda: t.draw(1, 2))
        self.assertEqual(len(t.seat_of(1)["zones"]["hand"]), 2)
        self.assertEqual(t.undo_view(1)["last"]["kind"], "draw")
        self.assertTrue(t.request_undo(1))
        self.assertEqual(t.seat_of(1)["zones"]["hand"], [])
        last = t.data["log"][-1]
        self.assertEqual((last["kind"], last["undone"]["kind"]), ("undo", "draw"))
        with self.assertRaises(state.ActionError):
            t.request_undo(1)  # nada mais para desfazer

    def test_needs_everyone_online_to_approve(self):
        t = self.t
        self.act(1, "life", lambda: t.change_life(1, -5))
        self.assertFalse(t.request_undo(1))  # b está conectado: abre o pedido
        req = t.undo_view(2)["request"]
        self.assertEqual((req["name"], [n["name"] for n in req["needed"]]), ("a", ["b"]))
        self.assertEqual(t.seat_of(1)["life"], 35)
        with self.assertRaises(state.ActionError):
            t.vote_undo(1, True)  # quem pediu não aprova o próprio
        t.vote_undo(2, True)
        self.assertEqual(t.seat_of(1)["life"], 40)
        self.assertIsNone(t.undo_request)

    def test_rejected_or_cancelled(self):
        t = self.t
        self.act(1, "life", lambda: t.change_life(1, -1))
        t.request_undo(1)
        t.vote_undo(2, False)
        self.assertEqual((t.seat_of(1)["life"], t.data["log"][-1]["kind"]), (39, "undo_rejected"))
        t.request_undo(1)
        t.vote_undo(1, False)  # a desiste
        self.assertIsNone(t.undo_request)
        self.assertEqual(t.seat_of(1)["life"], 39)

    def test_only_own_actions_and_conflicts(self):
        t = self.t
        boss_b = t.seat_of(2)["zones"]["battlefield"][0]["id"]
        self.act(1, "tap", lambda: t.tap(1, boss_b))  # a vira a carta do b
        self.act(2, "life", lambda: t.change_life(2, -3))  # b mexe no próprio lugar depois
        t.leave(2)
        with self.assertRaises(state.ActionError) as err:
            t.request_undo(1)  # o lugar do b mudou depois da ação da a
        self.assertEqual(err.exception.code, "undo_conflict")
        self.assertEqual(t.undo_view(2)["count"], 1)  # b tem a própria pilha

    def test_disconnect_counts_as_not_needed(self):
        t = self.t
        self.act(1, "life", lambda: t.change_life(1, -2))
        t.request_undo(1)
        t.leave(2)
        self.assertEqual(t.seat_of(1)["life"], 40)


class UndoSocketTests(TransactionTestCase):
    def setUp(self):
        state.TABLES.clear()
        consumers._loading.clear()

    open = TableSocketTests.open
    latest = TableSocketTests.latest
    player = TableSocketTests.player

    async def test_undo_over_the_socket(self):
        slug = await sync_to_async(make_deck)()
        ana, beto = await sync_to_async(make_user)("ana"), await sync_to_async(make_user)("beto")
        a = await self.open(ana)
        await self.latest(a)
        await a.send_json_to({"type": "load_deck", "kind": "precon", "ref": slug})
        await self.latest(a)
        await a.send_json_to({"type": "draw", "n": 3})
        msg = await self.latest(a)
        self.assertEqual(msg["undo"]["last"]["kind"], "draw")
        b = await self.open(beto)
        await self.latest(b)
        await self.latest(a)
        await a.send_json_to({"type": "undo"})
        req = (await self.latest(b))["undo"]["request"]
        self.assertEqual(req["name"], "ana")
        await self.latest(a)
        await b.send_json_to({"type": "undo_vote", "approve": True})
        done = await self.latest(a)
        self.assertEqual(len(self.player(done, "ana")["hand"]), 0)
        self.assertEqual(done["log"][-1]["kind"], "undo")
        await a.disconnect()
        await b.disconnect()


class RewindTests(TestCase):
    setUp = UndoTests.setUp
    act = UndoTests.act

    def test_rewind_to_a_moment_needs_approval(self):
        t = self.t
        self.act(1, "draw", lambda: t.draw(1, 2))
        point = t.data["log"][-1]["id"]
        self.act(2, "life", lambda: t.change_life(2, -7))
        self.act(1, "draw", lambda: t.draw(1, 1))
        self.assertIn(point, t.undo_view(1)["checkpoints"])
        self.assertFalse(t.request_rewind(1, point))
        self.assertEqual(t.undo_view(2)["request"]["kind"], "rewind")
        t.vote_undo(2, True)
        self.assertEqual((len(t.seat_of(1)["zones"]["hand"]), t.seat_of(2)["life"]), (2, 40))
        self.assertEqual(t.data["log"][-1]["kind"], "rewind")
        self.assertEqual(t.undo_view(1)["checkpoints"][-1], point)  # o que veio depois sumiu
        self.assertEqual(t.undo_view(1)["count"], 0)
        with self.assertRaises(state.ActionError):
            t.request_rewind(1, 99999)


def apply_delta(before: dict, patch: dict) -> dict:
    """O que o cliente faz com o delta (mesma regra do useTableSocket), para conferir a ida e volta."""
    import copy

    out = copy.deepcopy(before)
    for key, value in patch.items():
        if key not in {"players", "order", "log_add", "type", "rev", "ack"}:
            out[key] = value
    out["log"] = (out["log"] + patch.get("log_add", []))[-100:]
    players = {p["id"]: p for p in out["players"]}
    for pid, change in patch.get("players", {}).items():
        pid = int(pid)
        if "full" in change:
            players[pid] = change["full"]
            continue
        p = players[pid]
        bf = {c["id"]: c for c in p["battlefield"]}
        for c in change.get("bf_set", []):
            bf[c["id"]] = c
        for cid in change.get("bf_del", []):
            bf.pop(cid, None)
        ids = change.get("bf_order") or [c["id"] for c in p["battlefield"] if c["id"] in bf]
        for key, value in change.items():
            if not key.startswith("bf_"):
                p[key] = value
        p["battlefield"] = [bf[i] for i in ids]
    order = patch.get("order") or [p["id"] for p in out["players"]]
    out["players"] = [players[i] for i in order]
    return out


class DeltaTests(TestCase):
    """O delta, aplicado sobre a visão anterior, dá exatamente a visão nova (e é bem menor)."""

    def test_round_trip_and_size(self):
        import json

        from tables import delta

        t = state.Table(state.new_table("ROOM1"))
        rows = [{"name": "Boss", "image": "x" * 80, "quantity": 1, "is_commander": True, "power": "4", "toughness": "4"}] + [
            {"name": f"Card {i}", "image": "y" * 80, "quantity": 1, "is_commander": False, "power": "2", "toughness": "2"}
            for i in range(99)
        ]
        t.join(1, "a")
        t.join(2, "b")
        for uid in (1, 2):
            t.load_deck(uid, {"kind": "precon", "ref": "x", "name": "X"}, rows)
            t.draw_to(uid, 20, "battlefield")
        steps = [
            lambda: t.tap(1, t.seat_of(1)["zones"]["battlefield"][3]["id"]),
            lambda: t.change_life(2, -3),
            lambda: t.draw(1, 2),
            lambda: t.move(1, t.seat_of(1)["zones"]["battlefield"][5]["id"], "graveyard"),
            lambda: t.join(3, "c"),
            lambda: t.counter(1, t.seat_of(1)["zones"]["battlefield"][0]["id"], "+1/+1", 2),
            lambda: t.give_control(1, t.seat_of(1)["zones"]["battlefield"][1]["id"], 2),
            lambda: t.face_down(2, t.seat_of(2)["zones"]["battlefield"][2]["id"]),
        ]
        for viewer in (1, 2):
            before = json.loads(json.dumps(t.view(viewer)))
            for step in steps if viewer == 1 else []:
                step()
                after = json.loads(json.dumps(t.view(viewer)))
                patch = delta.diff(before, after)
                self.assertEqual(apply_delta(before, json.loads(json.dumps(patch))), after)
                self.assertLess(len(json.dumps(patch)), len(json.dumps(after)) / 5)
                before = after

    def test_idle_left_always_sent(self):
        # Depois de uma ação o tempo volta ao máximo, igual ao enviado antes: precisa ir mesmo assim,
        # senão o navegador continua a contagem antiga e avisa que a mesa vai fechar no meio do jogo
        from tables import delta

        t = state.Table(state.new_table("ROOM1"))
        t.join(1, "a")
        view = t.view(1)
        patch = delta.diff(view, t.view(1))
        self.assertEqual(patch.get("idle_left"), view["idle_left"])


class DeltaSocketTests(TransactionTestCase):
    def setUp(self):
        state.TABLES.clear()
        consumers._loading.clear()

    async def test_client_that_asks_gets_deltas(self):
        slug = await sync_to_async(make_deck)()
        ana = await sync_to_async(make_user)("ana")
        ws = WebsocketCommunicator(app, "/ws/tables/ABCD/")
        await ws.connect()
        await ws.send_json_to({"type": "auth", "token": ana, "delta": True})
        first = await ws.receive_json_from()
        self.assertEqual((first["type"], first["rev"]), ("state", 1))
        await ws.send_json_to({"type": "load_deck", "kind": "precon", "ref": slug, "cid": 1})
        msg = await ws.receive_json_from()
        self.assertEqual((msg["type"], msg["rev"], msg["ack"]), ("delta", 2, 1))
        self.assertIn("players", msg)
        state_now = apply_delta(first, msg)
        await ws.send_json_to({"type": "resync"})
        full = await ws.receive_json_from()
        self.assertEqual(full["type"], "state")
        self.assertEqual(full["players"], state_now["players"])
        await ws.disconnect()


class FieldLayoutTests(TestCase):
    """Cartas novas procuram espaço livre; "organizar" põe o campo em fileiras."""

    def setUp(self):
        self.t = state.Table(state.new_table("ROOM9"))
        self.t.join(1, "a")
        self.t.join(2, "b")
        rows = [
            {"name": "Boss", "image": "", "quantity": 1, "is_commander": True, "power": "4", "toughness": "4",
             "type_line": "Legendary Creature — Elf"},
            {"name": "Forest", "image": "", "quantity": 30, "is_commander": False, "type_line": "Basic Land — Forest"},
            {"name": "Bear", "image": "", "quantity": 30, "is_commander": False, "power": "2", "toughness": "2",
             "type_line": "Creature — Bear"},
            {"name": "Ring", "image": "", "quantity": 39, "is_commander": False, "type_line": "Artifact"},
        ]
        for uid in (1, 2):
            self.t.load_deck(uid, {"kind": "precon", "ref": "x", "name": "X"}, rows)

    def field(self, uid=1):
        return self.t.seat_of(uid)["zones"]["battlefield"]

    def test_new_cards_do_not_pile_up(self):
        self.t.draw_to(1, 20, "battlefield")
        spots = [(c["x"], c["y"]) for c in self.field()]
        self.assertEqual(len(set(spots)), len(spots))
        # da mão sem ponto (atalho): também num lugar livre
        self.t.draw(1, 1)
        cid = self.t.seat_of(1)["zones"]["hand"][-1]
        self.t.move(1, cid, "battlefield")
        spots = [(c["x"], c["y"]) for c in self.field()]
        self.assertEqual(len(set(spots)), len(spots))
        # terreno prefere a fileira de baixo
        lands = [c for c in self.field() if self.t.seat_of(1)["cards"][c["id"]]["kind"] == "land"]
        self.assertTrue(lands and all(c["y"] >= 0.75 for c in lands))

    def test_arrange_rows(self):
        self.t.draw_to(1, 15, "battlefield")
        locked = self.field()[3]
        locked.update(locked=True, x=0.33, y=0.44)
        self.t.arrange(1)
        cards = self.t.seat_of(1)["cards"]
        for c in self.field():
            if c is locked:
                self.assertEqual((c["x"], c["y"]), (0.33, 0.44))
                continue
            want = {"creature": 0.0, "other": 0.5, "land": 1.0}[cards[c["id"]]["kind"]]
            self.assertEqual(c["y"], want, cards[c["id"]]["name"])
            self.assertTrue(0 <= c["x"] <= 1)
        self.assertEqual(self.t.data["log"][-1]["kind"], "arrange")
        # o campo do outro jogador não muda
        before = [(c["x"], c["y"]) for c in self.field(2)]
        self.t.arrange(1)
        self.assertEqual(before, [(c["x"], c["y"]) for c in self.field(2)])


class ControlAndAfkTests(TestCase):
    """Pedir o controle de uma carta (quem controla aceita ou recusa) e jogador ausente."""

    def setUp(self):
        self.t = state.Table(state.new_table("ROOM8"))
        for uid, name in ((1, "a"), (2, "b"), (3, "c")):
            self.t.join(uid, name)
        rows = [{"name": "Boss", "image": "", "quantity": 1, "is_commander": True}]
        for uid in (1, 2, 3):
            self.t.load_deck(uid, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        self.boss_b = self.t.seat_of(2)["zones"]["battlefield"][0]["id"]

    def item(self):
        return self.t._on_field(self.boss_b)[1]

    def test_request_accept_and_refuse(self):
        t, boss = self.t, self.boss_b
        # dar o controle de carta alheia não vale mais: só pedindo
        with self.assertRaisesMessage(state.ActionError, "not_controller"):
            t.give_control(1, boss, 1)
        t.request_control(1, boss)
        with self.assertRaisesMessage(state.ActionError, "control_pending"):
            t.request_control(3, boss)
        self.assertEqual([r["from"] for r in t.control_view(2)], [1])
        self.assertEqual(t.control_view(3), [])  # quem não está no pedido não vê
        with self.assertRaisesMessage(state.ActionError, "no_control_request"):
            t.answer_control(1, boss, True)  # quem pediu não responde
        t.answer_control(2, boss, False)
        self.assertIsNone(self.item().get("controller"))
        self.assertEqual(t.data["log"][-1]["kind"], "control_no")
        t.request_control(1, boss)
        t.answer_control(2, boss, True)
        self.assertEqual(self.item()["controller"], 1)
        self.assertEqual(t.control_view(1), [])
        # agora quem responde é o novo controlador
        t.request_control(2, boss)
        self.assertEqual(t.control_view(1)[0]["to"], 1)
        t.answer_control(1, boss, True)
        self.assertIsNone(self.item()["controller"])

    def test_request_expires(self):
        t, boss = self.t, self.boss_b
        t.request_control(1, boss)
        t.control_requests[boss]["at"] -= state.CONTROL_TIMEOUT + 1
        self.assertEqual(t.control_view(2), [])
        t.request_control(3, boss)  # vencido: outro pode pedir

    def test_afk_skips_turn_and_others_can_pass(self):
        t = self.t
        for uid in (1, 2, 3):
            t.online[uid] = 1
        t.pass_turn(1)  # a começa
        t.set_afk(1, 2, True)
        self.assertTrue(next(p for p in t.view(1)["players"] if p["id"] == 2)["afk"])
        t.pass_turn(1)
        self.assertEqual(t.data["turn"]["player"], 3)  # pulou b
        with self.assertRaisesMessage(state.ActionError, "not_your_turn"):
            t.pass_turn(1)
        # c some: alguém marca como ausente e passa por ele
        t.set_afk(1, 3, True)
        t.pass_turn(1)
        self.assertEqual(t.data["turn"]["player"], 1)
        self.assertTrue(t.back_from_afk(2))
        self.assertFalse(t.seat_of(2)["afk"])
        self.assertEqual(t.data["log"][-1]["kind"], "back")


class AfkSocketTests(TransactionTestCase):
    def setUp(self):
        state.TABLES.clear()
        consumers._loading.clear()

    open = TableSocketTests.open
    latest = TableSocketTests.latest
    player = TableSocketTests.player

    async def test_marked_afk_comes_back_by_acting(self):
        ana, beto = await sync_to_async(make_user)("ana"), await sync_to_async(make_user)("beto")
        a = await self.open(ana)
        await self.latest(a)
        b = await self.open(beto)
        await self.latest(b)
        await self.latest(a)
        beto_id = await sync_to_async(lambda: Token.objects.get(key=beto).user_id)()
        await a.send_json_to({"type": "set_afk", "player": beto_id, "afk": True})
        msg_b = await self.latest(b)
        self.assertTrue(self.player(msg_b, "beto")["afk"])
        await b.send_json_to({"type": "life", "delta": -1})
        msg_a = await self.latest(a)
        self.assertFalse(self.player(msg_a, "beto")["afk"])
        await a.disconnect()
        await b.disconnect()


class HelperCardTests(TestCase):
    """Cartas de ajuda: Monarca/Iniciativa/Dia-Noite únicas na mesa; verso para virar."""

    IMG = "https://cards.scryfall.io/normal/front/x.jpg"
    BACK = "https://cards.scryfall.io/normal/back/x.jpg"

    def setUp(self):
        self.t = state.Table(state.new_table("ROOM7"))
        self.t.join(1, "a")
        self.t.join(2, "b")

    def names(self, uid):
        seat = self.t.seat_of(uid)
        return [seat["cards"][i["id"]]["name"] for i in seat["zones"]["battlefield"]]

    def test_unique_helper_moves_to_who_takes_it(self):
        t = self.t
        t.create_token(1, "The Monarch", self.IMG, helper=True)
        t.create_token(1, "Radiation", self.IMG, helper=True)
        t.create_token(2, "Radiation", self.IMG, helper=True)  # não é única: cada um tem a sua
        t.create_token(2, "The Monarch", self.IMG, helper=True)
        self.assertEqual(self.names(1), ["Radiation"])
        self.assertEqual(sorted(self.names(2)), ["Radiation", "The Monarch"])
        last = t.data["log"][-1]
        self.assertEqual((last["kind"], last["card"], last["owner"]), ("helper", "The Monarch", "a"))
        # ficha comum com o mesmo nome não conta como a carta de ajuda
        t.create_token(1, "The Monarch", self.IMG)
        self.assertIn("The Monarch", self.names(2))
        field = {c["name"]: c for c in next(p for p in t.view(2)["players"] if p["id"] == 2)["battlefield"]}
        self.assertTrue(field["The Monarch"]["helper"])

    def test_back_face_and_flip(self):
        t = self.t
        t.create_token(1, "Day // Night", self.IMG, back=self.BACK, helper=True)
        cid = t.seat_of(1)["zones"]["battlefield"][0]["id"]
        t.flip(1, cid)
        card = next(p for p in t.view(1)["players"] if p["id"] == 1)["battlefield"][0]
        self.assertEqual(card["image"], self.BACK)
        with self.assertRaises(state.ActionError):
            t.create_token(1, "X", self.IMG, back="https://evil.example/x.jpg", helper=True)


class ViewIsolationTests(TestCase):
    """A visão é cópia (a conexão guarda a última para o delta) e a parte comum é reaproveitada."""

    def setUp(self):
        self.t = state.Table(state.new_table("ROOM6"))
        rows = [
            {"name": "Boss", "image": "", "quantity": 1, "is_commander": True, "power": "3", "toughness": "3"},
            {"name": "Card", "image": "", "quantity": 20, "is_commander": False, "power": "1", "toughness": "1"},
        ]
        for uid, name in ((1, "a"), (2, "b")):
            self.t.join(uid, name)
            self.t.load_deck(uid, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        self.boss = self.t.seat_of(1)["zones"]["battlefield"][0]["id"]

    def mine(self, view, uid=1):
        return next(p for p in view["players"] if p["id"] == uid)

    def test_view_does_not_change_with_the_table(self):
        import copy

        t = self.t
        t.pass_turn(1)
        before = t.view(1)
        frozen = copy.deepcopy(before)
        t.counter(1, self.boss, "+1/+1", 2)
        t.stat(1, self.boss, "p", 1)
        t.commander_damage(1, 2, 3)
        t.pass_turn(1)
        t.tap(1, self.boss)
        self.assertEqual(before, frozen)

    def test_shared_part_reused_per_update(self):
        t = self.t
        t.draw_to(1, 2, "battlefield_down")
        a1, b1 = t.view(1, gen=5), t.view(2, gen=5)
        down = [c for c in self.mine(a1)["battlefield"] if c["face_down"]]
        self.assertTrue(all(c["name"] == "Card" for c in down))
        hidden = [c for c in self.mine(b1)["battlefield"] if c["face_down"]]
        self.assertTrue(hidden and all(c["name"] == "" for c in hidden))
        # cartas iguais para todos: o mesmo objeto nas duas visões (montado uma vez)
        self.assertIs(self.mine(a1)["battlefield"][0], self.mine(b1)["battlefield"][0])
        self.assertIsNone(self.mine(b1)["hand"])
        # nova atualização: monta de novo com o estado novo
        t.tap(1, self.boss)
        self.assertTrue(self.mine(t.view(2, gen=6))["battlefield"][0]["tapped"])


class ShowHandTests(TestCase):
    """Mostrar a mão a um jogador (ou a todos): ele vê ao vivo até o dono esconder."""

    def setUp(self):
        self.t = state.Table(state.new_table("ROOM5"))
        rows = [{"name": "Card", "image": "", "quantity": 30, "is_commander": False}]
        for uid, name in ((1, "a"), (2, "b"), (3, "c")):
            self.t.join(uid, name)
            self.t.load_deck(uid, {"kind": "precon", "ref": "x", "name": "X"}, rows)
        self.t.draw(1, 3)

    def hand_of_1(self, viewer):
        return next(p for p in self.t.view(viewer)["players"] if p["id"] == 1)["hand"]

    def test_show_to_one_then_all_then_hide(self):
        t = self.t
        self.assertIsNone(self.hand_of_1(2))
        t.show_hand(1, 2, True)
        self.assertEqual(len(self.hand_of_1(2)), 3)
        self.assertIsNone(self.hand_of_1(3))
        t.draw(1, 1)  # ao vivo: a carta nova também aparece
        self.assertEqual(len(self.hand_of_1(2)), 4)
        self.assertEqual(t.data["log"][-2]["kind"], "show_hand")
        t.show_hand(1, None, True)
        self.assertEqual(len(self.hand_of_1(3)), 4)
        self.assertEqual(next(p for p in t.view(3)["players"] if p["id"] == 1)["hand_shown"], [2, 3])
        # a pilha virada continua só do dono
        self.assertIsNone(next(p for p in t.view(2)["players"] if p["id"] == 1)["facedown"])
        t.show_hand(1, 3, False)
        self.assertIsNone(self.hand_of_1(3))
        t.show_hand(1, None, False)
        self.assertIsNone(self.hand_of_1(2))
        with self.assertRaises(state.ActionError):
            t.show_hand(1, 1, True)  # para si mesmo não


class SpectatorSocketTests(TransactionTestCase):
    """Mesa cheia: o quinto pode assistir (vê os campos, não vê mãos, não mexe em nada)."""

    def setUp(self):
        state.TABLES.clear()
        consumers._loading.clear()

    open = TableSocketTests.open
    latest = TableSocketTests.latest

    async def test_full_table_can_be_watched(self):
        tokens = [await sync_to_async(make_user)(n) for n in ("ana", "beto", "caio", "dani", "eva")]
        socks = []
        for tok in tokens[:4]:
            ws = await self.open(tok)
            await self.latest(ws)
            socks.append(ws)
        # sem pedir para assistir: mesa cheia
        full = WebsocketCommunicator(app, "/ws/tables/ABCD/")
        await full.connect()
        await full.send_json_to({"type": "auth", "token": tokens[4]})
        self.assertEqual((await full.receive_output())["code"], 4403)
        # assistindo
        eva = WebsocketCommunicator(app, "/ws/tables/ABCD/")
        await eva.connect()
        await eva.send_json_to({"type": "auth", "token": tokens[4], "spectate": True})
        msg = await self.latest(eva)
        self.assertEqual(len(msg["players"]), 4)
        self.assertTrue(all(p["hand"] is None for p in msg["players"]))
        self.assertEqual(msg["spectators"], ["eva"])
        seen = await self.latest(socks[1])
        self.assertEqual(seen["spectators"], ["eva"])
        await eva.send_json_to({"type": "life", "delta": -5})
        err = await eva.receive_json_from()
        self.assertEqual((err["type"], err["code"]), ("error", "spectating"))
        await eva.disconnect()
        self.assertEqual((await self.latest(socks[1]))["spectators"], [])
        for ws in socks:
            await ws.disconnect()


class WatchdogTests(TestCase):
    """Fila de banco da mesa travada: o vigia percebe e o /api/health/ passa a dar 503."""

    def tearDown(self):
        from tables import watchdog

        watchdog.stuck_since = None

    def test_detects_stuck_thread_and_recovers(self):
        from unittest import mock

        from asgiref.sync import sync_to_async

        from tables import watchdog

        async def run():
            blocker = asyncio.ensure_future(sync_to_async(time.sleep, thread_sensitive=True)(0.6))
            await asyncio.sleep(0.05)
            with mock.patch.object(watchdog, "PROBE_TIMEOUT", 0.2):
                self.assertFalse(await watchdog.probe())
            self.assertIsNotNone(watchdog.stuck_since)
            await blocker
            self.assertTrue(await watchdog.probe())
            self.assertIsNone(watchdog.stuck_since)

        asyncio.run(run())

    def test_health_reports_stuck(self):
        from tables import watchdog

        self.assertEqual(self.client.get("/api/health/").status_code, 200)
        watchdog.stuck_since = time.time() - watchdog.STUCK_UNHEALTHY - 1
        res = self.client.get("/api/health/")
        self.assertEqual((res.status_code, res.json()["status"]), (503, "tables_stuck"))
