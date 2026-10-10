from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from decks.models import Deck, Edition
from pools.models import OwnedPrecon

User = get_user_model()


class RoomTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        ed = Edition.objects.create(code="AAA", name="A")
        for i, colors in enumerate("WUBRG"):
            Deck.objects.create(name=f"D{i}", slug=f"d{i}", edition=ed, color_identity=colors)

    def setUp(self):
        cache.clear()

    def call(self, method, url, body=None, token=None, auth=None):
        headers = {}
        if token:
            headers["HTTP_X_ROOM_TOKEN"] = token
        if auth:
            headers["HTTP_AUTHORIZATION"] = f"Token {auth}"
        fn = getattr(self.client, method)
        return fn(url, body or {}, content_type="application/json", **headers)

    def create(self, name="Ana", **extra):
        res = self.call("post", "/api/rooms/", {"name": name, **extra})
        self.assertEqual(res.status_code, 201, res.json())
        return res.json()

    def join(self, code, name, **kw):
        return self.call("post", f"/api/rooms/{code}/join/", {"name": name}, **kw)

    def test_create_join_and_draw(self):
        room = self.create()
        code, host = room["code"], room["token"]
        self.assertEqual(room["you"], room["host_id"])
        beto = self.join(code, "Beto").json()
        self.assertEqual(len(beto["players"]), 2)
        self.assertNotEqual(beto["you"], room["host_id"])

        # Só o anfitrião sorteia
        self.assertEqual(self.call("post", f"/api/rooms/{code}/draw/", token=beto["token"]).status_code, 403)
        res = self.call("post", f"/api/rooms/{code}/draw/", token=host)
        self.assertEqual(res.status_code, 200, res.json())
        data = res.json()
        self.assertEqual(data["round"], 1)
        self.assertEqual(len(data["draw"]["entries"]), 2)
        self.assertEqual([e["player_name"] for e in data["draw"]["entries"]], ["Ana", "Beto"])
        self.assertEqual(data["draw_seats"], [p["id"] for p in data["players"]])
        self.assertTrue(data["reveal_at"])

        # Todo mundo vê o mesmo sorteio
        seen = self.call("get", f"/api/rooms/{code}/", token=beto["token"]).json()
        self.assertEqual(seen["draw"]["code"], data["draw"]["code"])
        self.assertEqual(seen["you"], beto["you"])

    def test_rejoin_with_token_and_duplicate_names(self):
        room = self.create()
        again = self.join(room["code"], "Outro nome", token=room["token"])
        self.assertEqual(again.json()["you"], room["you"])
        self.assertEqual(self.join(room["code"], "ana").status_code, 400)

    def test_room_full_and_min_players(self):
        room = self.create()
        self.assertEqual(self.call("post", f"/api/rooms/{room['code']}/draw/", token=room["token"]).status_code, 400)
        for n in ["B", "C", "D"]:
            self.assertEqual(self.join(room["code"], n).status_code, 201)
        self.assertEqual(self.join(room["code"], "E").status_code, 400)

    def test_kick_and_host_handover(self):
        room = self.create()
        beto = self.join(room["code"], "Beto").json()
        caio = self.join(room["code"], "Caio").json()
        res = self.call("post", f"/api/rooms/{room['code']}/kick/", {"player_id": caio["you"]}, token=room["token"])
        self.assertEqual(len(res.json()["players"]), 2)
        self.call("post", f"/api/rooms/{room['code']}/leave/", token=room["token"])
        state = self.call("get", f"/api/rooms/{room['code']}/").json()
        self.assertEqual(state["host_id"], beto["you"])

    def test_settings_update(self):
        room = self.create()
        res = self.call("patch", f"/api/rooms/{room['code']}/", {"filters": {"color_rule": "distinct"}}, token=room["token"])
        self.assertEqual(res.json()["filters"]["color_rule"], "distinct")
        # Não dá para mudar para deckpool com jogador sem conta
        res = self.call("patch", f"/api/rooms/{room['code']}/", {"mode": "pool"}, token=room["token"])
        self.assertEqual(res.status_code, 400)

    def test_pool_room_requires_accounts(self):
        tokens = {}
        for name in ["ana", "beto"]:
            res = self.call("post", "/api/auth/register/", {
                "username": name, "email": f"{name}@example.com", "password": "senha-forte-123"})
            tokens[name] = res.json()["token"]
            user = User.objects.get(username=name)
        OwnedPrecon.objects.create(user=User.objects.get(username="ana"), deck=Deck.objects.get(slug="d0"))
        OwnedPrecon.objects.create(user=User.objects.get(username="beto"), deck=Deck.objects.get(slug="d1"))
        self.assertEqual(self.call("post", "/api/rooms/", {"mode": "pool"}).status_code, 401)
        room = self.call("post", "/api/rooms/", {"mode": "pool"}, auth=tokens["ana"]).json()
        self.assertEqual(room["players"][0]["name"], "ana")
        self.assertEqual(self.join(room["code"], "convidado").status_code, 401)
        beto = self.join(room["code"], "", auth=tokens["beto"]).json()
        res = self.call("post", f"/api/rooms/{room['code']}/draw/", token=room["token"])
        self.assertEqual(res.status_code, 200, res.json())
        entries = res.json()["draw"]["entries"]
        self.assertEqual(entries[0]["owner"], "beto")
        self.assertEqual(entries[1]["owner"], "ana")
        self.assertTrue(beto["token"])

    def test_host_resets_room_history(self):
        room = self.create()
        beto = self.join(room["code"], "Beto").json()
        url = f"/api/rooms/{room['code']}/history/reset/"
        self.call("post", f"/api/rooms/{room['code']}/draw/", token=room["token"])
        self.assertEqual(self.call("post", url, token=beto["token"]).status_code, 403)
        res = self.call("post", url, token=room["token"])
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["cleared"], 2)

    def test_room_players_mark_winner_and_scoreboard(self):
        room = self.create()
        beto = self.join(room["code"], "Beto").json()
        data = self.call("post", f"/api/rooms/{room['code']}/draw/", token=room["token"]).json()
        self.assertTrue(data["draw"]["can_set_result"])
        url = f"/api/draw/{data['draw']['code']}/result/"
        self.assertEqual(self.call("post", url, {"winner": 1}).status_code, 403)  # sem token da sala
        self.assertEqual(self.call("post", url, {"winner": 1}, token=beto["token"]).status_code, 200)
        seen = self.call("get", f"/api/rooms/{room['code']}/", token=room["token"]).json()
        self.assertEqual(seen["draw"]["winner_position"], 1)
        board = self.call("get", f"/api/rooms/{room['code']}/scoreboard/").json()["players"]
        self.assertEqual([(p["name"], p["wins"], p["games"]) for p in board], [("Beto", 1, 1), ("Ana", 0, 1)])
