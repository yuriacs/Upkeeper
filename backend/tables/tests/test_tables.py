from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase
from rest_framework.authtoken.models import Token

from tables import state
from tables.routing import websocket_urlpatterns

app = URLRouter(websocket_urlpatterns)


def make_user(name):
    user = get_user_model().objects.create_user(username=name, email=f"{name}@x.com", password="pw-123456")
    return Token.objects.create(user=user).key


class TableSocketTests(TransactionTestCase):
    def setUp(self):
        state.TABLES.clear()

    async def open(self, token, code="ABCD"):
        ws = WebsocketCommunicator(app, f"/ws/tables/{code}/")
        connected, _ = await ws.connect()
        self.assertTrue(connected)
        await ws.send_json_to({"type": "auth", "token": token})
        return ws

    async def test_life_syncs_between_players(self):
        from asgiref.sync import sync_to_async

        ana, beto = await sync_to_async(make_user)("ana"), await sync_to_async(make_user)("beto")
        a = await self.open(ana)
        first = await a.receive_json_from()
        self.assertEqual([p["name"] for p in first["players"]], ["ana"])
        self.assertEqual(first["players"][0]["life"], 40)

        b = await self.open(beto)
        await a.receive_json_from()  # beto entrou
        joined = await b.receive_json_from()
        self.assertEqual([(p["name"], p["seat"]) for p in joined["players"]], [("ana", 1), ("beto", 2)])

        await b.send_json_to({"type": "life", "delta": -3})
        seen_by_ana = await a.receive_json_from()
        await b.receive_json_from()
        lives = {p["name"]: p["life"] for p in seen_by_ana["players"]}
        self.assertEqual(lives, {"ana": 40, "beto": 37})

        await b.disconnect()
        left = await a.receive_json_from()
        self.assertFalse(next(p for p in left["players"] if p["name"] == "beto")["online"])
        await a.disconnect()

    async def test_reconnect_keeps_seat_and_life(self):
        from asgiref.sync import sync_to_async

        ana = await sync_to_async(make_user)("ana")
        a = await self.open(ana)
        await a.receive_json_from()
        await a.send_json_to({"type": "life", "delta": 5})
        await a.receive_json_from()
        await a.disconnect()
        again = await self.open(ana)
        snap = await again.receive_json_from()
        self.assertEqual(snap["players"][0]["life"], 45)
        self.assertEqual(snap["players"][0]["seat"], 1)
        await again.disconnect()

    async def test_bad_token_is_closed(self):
        ws = await self.open("nope")
        out = await ws.receive_output()
        self.assertEqual(out, {"type": "websocket.close", "code": 4401})

    async def test_fifth_player_is_refused(self):
        from asgiref.sync import sync_to_async

        socks = []
        for name in ["p1", "p2", "p3", "p4"]:
            ws = await self.open(await sync_to_async(make_user)(name))
            socks.append(ws)
        extra = await self.open(await sync_to_async(make_user)("p5"))
        while (out := await extra.receive_output())["type"] != "websocket.close":
            pass
        self.assertEqual(out["code"], 4403)
        for ws in socks:
            await ws.disconnect()

    async def test_invalid_delta(self):
        from asgiref.sync import sync_to_async

        ws = await self.open(await sync_to_async(make_user)("ana"))
        await ws.receive_json_from()
        await ws.send_json_to({"type": "life", "delta": 5000})
        self.assertEqual(await ws.receive_json_from(), {"type": "error", "code": "bad_delta"})
        await ws.disconnect()


class TableStateTests(TransactionTestCase):
    def setUp(self):
        state.TABLES.clear()

    def test_prune_removes_idle_empty_tables(self):
        state.join("ROOM1", 1, "a")
        state.leave("ROOM1", 1)
        state.prune(now=state.TABLES["ROOM1"].touched + state.IDLE_TTL + 1)
        self.assertNotIn("ROOM1", state.TABLES)

    def test_life_is_clamped(self):
        state.join("ROOM1", 1, "a")
        for _ in range(20):
            state.change_life("ROOM1", 1, 100)
        self.assertEqual(state.TABLES["ROOM1"].seats[1].life, state.LIFE_LIMIT)
