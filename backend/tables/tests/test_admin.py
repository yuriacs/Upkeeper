"""Painel do admin: mesas abertas (assistir, encerrar) e partidas encerradas (trocar o vencedor, anular)."""

from asgiref.sync import sync_to_async
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from decks.models import Deck, Draw, DrawEntry
from tables import consumers, state, store
from tables.models import TableGame, TableResult
from tables.tests.test_tables import app, make_deck, make_user, saved_table

User = get_user_model()


def staff_client() -> APIClient:
    admin = User.objects.create_user(username="chefe", email="chefe@x.com", password="pw-123456", is_staff=True)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=admin).key}")
    return client


def table_with_two(code: str) -> tuple[state.Table, int, int]:
    """Mesa na memória com ana e beto sentados, cada um com o deck de teste, e o primeiro turno passado."""
    slug = make_deck()
    ana = User.objects.create_user(username="ana", email="ana@x.com", password="pw-123456")
    beto = User.objects.create_user(username="beto", email="beto@x.com", password="pw-123456")
    t = state.Table(state.new_table(code))
    for u in (ana, beto):
        t.join(u.id, u.username)
        t.load_deck(u.id, *store.deck_cards_sync("precon", slug))
    t.pass_turn(t.data["turn"]["player"] or ana.id)
    state.TABLES[code] = t
    return t, ana.id, beto.id


class AdminTablesTests(TransactionTestCase):
    def setUp(self):
        state.TABLES.clear()
        consumers._loading.clear()
        self.client = staff_client()

    def test_only_admins(self):
        make_user("zeca")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Token {Token.objects.get(user__username='zeca').key}")
        self.assertEqual(client.get("/api/admin/tables/").status_code, 403)
        self.assertEqual(client.post("/api/admin/tables/ABCD/", {"action": "close"}, format="json").status_code, 403)
        self.assertEqual(client.get("/api/admin/games/").status_code, 403)

    def test_lists_every_open_table(self):
        t, ana, _ = table_with_two("ADMLIST")
        t.data["friends_only"], t.data["allow_watch"] = True, False  # privada: o admin vê do mesmo jeito
        res = self.client.get("/api/admin/tables/")
        self.assertEqual(res.status_code, 200)
        row = next(r for r in res.data["tables"] if r["code"] == "ADMLIST")
        self.assertEqual([p["name"] for p in row["players"]], ["ana", "beto"])
        self.assertEqual(row["players"][0]["id"], ana)
        self.assertEqual(row["players"][0]["deck"], "Test Deck")
        self.assertTrue(row["friends_only"])
        self.assertTrue(row["in_memory"])

    def test_finish_with_winner_counts_and_closes(self):
        _, ana, beto = table_with_two("ADMWIN")
        res = self.client.post("/api/admin/tables/ADMWIN/", {"action": "finish", "winner": beto}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["winner"], "beto")
        self.assertNotIn("ADMWIN", state.TABLES)
        game = TableResult.objects.get()
        self.assertEqual({e.player.username: e.won for e in game.entries.all()}, {"ana": False, "beto": True})

    def test_finish_with_unknown_winner_is_refused(self):
        table_with_two("ADMBAD")
        res = self.client.post("/api/admin/tables/ADMBAD/", {"action": "finish", "winner": 999}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("ADMBAD", state.TABLES)

    def test_close_without_winner(self):
        table_with_two("ADMCLS")
        res = self.client.post("/api/admin/tables/ADMCLS/", {"action": "close"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("ADMCLS", state.TABLES)
        self.assertEqual(TableResult.objects.count(), 0)
        self.assertEqual(self.client.post("/api/admin/tables/ADMCLS/", {"action": "close"}, format="json").status_code, 404)

    def test_saved_table_outside_memory(self):
        t, ana, _ = table_with_two("ADMSAVE")
        saved_table("ADMSAVE", t.data)
        state.TABLES.clear()  # servidor reiniciou: a mesa só está no banco
        res = self.client.post("/api/admin/tables/ADMSAVE/", {"action": "finish", "winner": ana}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(TableResult.objects.get().entries.get(won=True).player_id, ana)
        self.assertFalse(TableGame.objects.filter(code="ADMSAVE").exists())

    def test_change_winner_and_annul_table_game(self):
        _, ana, beto = table_with_two("ADMEDIT")
        self.client.post("/api/admin/tables/ADMEDIT/", {"action": "finish", "winner": ana}, format="json")
        listed = self.client.get("/api/admin/games/").data["results"]
        self.assertEqual(len(listed), 1)
        game = listed[0]
        beto_entry = next(p["entry"] for p in game["players"] if p["name"] == "beto")
        res = self.client.post(f"/api/admin/games/tables/{game['id']}/", {"winner": beto_entry}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual([p["name"] for p in res.data["players"] if p["won"]], ["beto"])
        self.assertEqual(self.client.get("/api/admin/games/?search=bet").data["count"], 1)
        self.assertEqual(self.client.get("/api/admin/games/?search=zzz").data["count"], 0)
        self.assertEqual(self.client.delete(f"/api/admin/games/tables/{game['id']}/").status_code, 204)
        self.assertEqual(TableResult.objects.count(), 0)

    def test_change_winner_and_annul_draw_game(self):
        make_deck()
        deck = Deck.objects.get()
        draw = Draw.objects.create(code="abc123", winner_position=1)
        for pos, name in ((1, "Ana"), (2, "Beto")):
            DrawEntry.objects.create(draw=draw, position=pos, player_name=name, deck=deck)
        listed = self.client.get("/api/admin/games/?source=draws").data["results"]
        self.assertEqual([p["name"] for p in listed[0]["players"] if p["won"]], ["Ana"])
        res = self.client.post(f"/api/admin/games/draws/{draw.pk}/", {"winner": 2}, format="json")
        self.assertEqual([p["name"] for p in res.data["players"] if p["won"]], ["Beto"])
        self.assertEqual(self.client.post(f"/api/admin/games/draws/{draw.pk}/", {"winner": 7}, format="json").status_code, 400)
        self.client.delete(f"/api/admin/games/draws/{draw.pk}/")
        draw.refresh_from_db()
        self.assertIsNone(draw.winner_position)


class AdminWatchTests(TransactionTestCase):
    def setUp(self):
        state.TABLES.clear()
        consumers._loading.clear()

    async def test_admin_watches_a_private_table(self):
        t, _, _ = await sync_to_async(table_with_two)("PRIVADA")
        t.data["friends_only"], t.data["allow_watch"] = True, False
        intruso = await sync_to_async(make_user)("intruso")
        ws = WebsocketCommunicator(app, "/ws/tables/PRIVADA/")
        await ws.connect()
        await ws.send_json_to({"type": "auth", "token": intruso, "spectate": True})
        self.assertEqual((await ws.receive_json_from())["type"], "bye")  # quem não é admin não entra
        await ws.disconnect()
        chefe = await sync_to_async(make_user)("chefe")
        await sync_to_async(User.objects.filter(username="chefe").update)(is_staff=True)
        ws = WebsocketCommunicator(app, "/ws/tables/PRIVADA/")
        await ws.connect()
        await ws.send_json_to({"type": "auth", "token": chefe, "spectate": True})
        msg = await ws.receive_json_from()
        self.assertEqual(msg["type"], "state")
        self.assertIn(await sync_to_async(lambda: User.objects.get(username="chefe").id)(), t.spectators)
        await ws.disconnect()


class SuspendAccountTests(TransactionTestCase):
    def test_suspend_and_reactivate(self):
        client = staff_client()
        token = make_user("bagunca")
        user = User.objects.get(username="bagunca")
        res = client.post(f"/api/admin/users/{user.id}/", {"active": False}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(Token.objects.filter(key=token).exists())
        login = APIClient().post("/api/auth/login/", {"login": "bagunca", "password": "pw-123456"}, format="json")
        self.assertEqual(login.status_code, 403)
        users = client.get("/api/admin/users/?suspended=1").data["results"]
        self.assertEqual([(u["username"], u["active"]) for u in users], [("bagunca", False)])
        client.post(f"/api/admin/users/{user.id}/", {"active": True}, format="json")
        login = APIClient().post("/api/auth/login/", {"login": "bagunca", "password": "pw-123456"}, format="json")
        self.assertEqual(login.status_code, 200)

    def test_admins_cannot_be_suspended(self):
        client = staff_client()
        me = User.objects.get(username="chefe")
        self.assertEqual(client.post(f"/api/admin/users/{me.id}/", {"active": False}, format="json").status_code, 400)
