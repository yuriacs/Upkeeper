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

        # beto não pode mexer na carta da ana
        await b.send_json_to({"type": "tap", "card": card})
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
        self.assertEqual(t.seat_of(1)["zones"]["battlefield"][-1], {"id": a, "x": 1.0, "y": 0.0, "tapped": False, "counters": {}, "stats": None})
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
