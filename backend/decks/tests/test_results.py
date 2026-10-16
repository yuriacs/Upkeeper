from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.authtoken.models import Token

from decks.models import Deck, Draw, DrawEntry, Edition

User = get_user_model()


class ResultTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        ed = Edition.objects.create(code="AAA", name="A")
        cls.decks = [
            Deck.objects.create(name=f"D{i}", slug=f"d{i}", edition=ed, color_identity=c) for i, c in enumerate("WUBRG")
        ]
        cls.ana = User.objects.create_user("ana", "ana@example.com", "senha-forte-123")
        cls.beto = User.objects.create_user("beto", "beto@example.com", "senha-forte-123")
        cls.estranho = User.objects.create_user("zeca", "zeca@example.com", "senha-forte-123")

    def setUp(self):
        cache.clear()

    def auth(self, user):
        return {"HTTP_AUTHORIZATION": f"Token {Token.objects.get_or_create(user=user)[0].key}"}

    def post(self, url, body, **headers):
        return self.client.post(url, body, content_type="application/json", **headers)

    def game(self, winner, *, a=0, b=1):
        """Partida ana (deck a) x beto (deck b) com vencedor já marcado."""
        draw = Draw.objects.create(code=f"g{Draw.objects.count()}", winner_position=winner)
        DrawEntry.objects.create(draw=draw, position=0, player_name="ana", player=self.ana, deck=self.decks[a])
        DrawEntry.objects.create(draw=draw, position=1, player_name="beto", player=self.beto, deck=self.decks[b])
        return draw

    def test_anonymous_creator_sets_winner_with_token(self):
        res = self.post("/api/draw/", {"names": ["Ana", "Beto"]})
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertTrue(data["manage_token"])
        self.assertIsNone(data["winner_position"])
        url = f"/api/draw/{data['code']}/result/"
        # Sem token: proibido; com token: ok
        self.assertEqual(self.post(url, {"winner": 1}).status_code, 403)
        res = self.post(url, {"winner": 1}, HTTP_X_DRAW_TOKEN=data["manage_token"])
        self.assertEqual(res.status_code, 200, res.json())
        self.assertEqual(res.json()["winner_position"], 1)
        self.assertTrue(res.json()["result_at"])
        # Posição que não existe
        self.assertEqual(self.post(url, {"winner": 7}, HTTP_X_DRAW_TOKEN=data["manage_token"]).status_code, 400)
        # Desfazer
        res = self.post(url, {"winner": None}, HTTP_X_DRAW_TOKEN=data["manage_token"])
        self.assertIsNone(res.json()["winner_position"])
        # O token não aparece no link público
        self.assertNotIn("manage_token", self.client.get(f"/api/draw/{data['code']}/").json())

    def test_players_at_the_table_can_set_winner(self):
        draw = self.game(None)
        url = f"/api/draw/{draw.code}/result/"
        self.assertEqual(self.post(url, {"winner": 0}, **self.auth(self.estranho)).status_code, 403)
        self.assertEqual(self.post(url, {"winner": 0}, **self.auth(self.beto)).status_code, 200)
        detail = self.client.get(f"/api/draw/{draw.code}/", **self.auth(self.ana)).json()
        self.assertTrue(detail["can_set_result"])
        self.assertFalse(self.client.get(f"/api/draw/{draw.code}/").json()["can_set_result"])

    def test_global_stats(self):
        for _ in range(3):
            self.game(0)  # ana com D0 ganha 3x de beto com D1
        self.game(1, a=2, b=1)  # beto com D1 ganha uma
        self.game(None, a=3, b=4)  # sem resultado: não conta
        data = self.client.get("/api/stats/").json()
        self.assertEqual(data["games"], 4)
        self.assertEqual(data["most_wins"][0]["deck"]["slug"], "d0")
        self.assertEqual(data["most_wins"][0]["wins"], 3)
        self.assertEqual(data["best_rate"][0]["deck"]["slug"], "d0")
        self.assertEqual(data["unlucky"][0]["deck"]["slug"], "d1")  # 1 vitória em 4
        self.assertEqual([p["username"] for p in data["players"]], ["ana", "beto"])
        self.assertEqual(data["players"][0]["win_rate"], 0.75)
        # Recorde na página do deck
        self.assertEqual(self.client.get("/api/decks/d0/").json()["record"], {"games": 3, "wins": 3, "win_rate": 1.0})

    def table_game(self, winner, previous=None, *, a=0, b=1, beto_deck=True):
        """Partida numa mesa sem sorteio: ana (deck a) x beto (deck b), como a mesa grava ao encerrar."""
        from asgiref.sync import async_to_sync

        from tables import state, store

        data = state.new_table("LIVRE")
        for user, ref in ((self.ana, f"d{a}"), (self.beto, f"d{b}")):
            seat = data["seats"][str(user.id)] = state.new_seat(user.id, user.username, len(data["seats"]) + 1)
            if user is self.ana or beto_deck:
                seat["deck"] = {"kind": "precon", "ref": ref, "name": ref}
        data["result"] = {"winner": winner.id if winner else None, "turn": 5}
        return async_to_sync(store.save_table_result)(data, previous)

    def test_table_ranking_is_separate_from_deals(self):
        self.game(1)  # sorteio: beto (d1) ganha
        first = self.table_game(self.ana)
        self.table_game(self.ana)
        self.table_game(self.beto, a=2, b=1)
        tables = self.client.get("/api/stats/?source=tables").json()
        self.assertEqual((tables["source"], tables["games"]), ("tables", 3))
        self.assertEqual(tables["most_wins"][0]["deck"]["slug"], "d0")
        self.assertEqual([p["username"] for p in tables["players"]], ["ana", "beto"])
        draws = self.client.get("/api/stats/").json()
        self.assertEqual((draws["games"], draws["most_wins"][0]["deck"]["slug"]), (1, "d1"))
        # Remarcar o vencedor troca a partida (não duplica); sem vencedor, ela sai do ranking
        replaced = self.table_game(self.beto, first)
        self.assertEqual(self.client.get("/api/stats/?source=tables").json()["games"], 3)
        self.assertIsNone(self.table_game(None, replaced))
        self.assertEqual(self.client.get("/api/stats/?source=tables").json()["games"], 2)
        # Só um jogador com deck: não conta
        self.assertIsNone(self.table_game(self.ana, beto_deck=False))

    def test_stats_cache_is_invalidated_by_new_result(self):
        self.assertEqual(self.client.get("/api/stats/").json()["games"], 0)
        draw = self.game(None)
        self.post(f"/api/draw/{draw.code}/result/", {"winner": 0}, **self.auth(self.ana))
        self.assertEqual(self.client.get("/api/stats/").json()["games"], 1)

    def test_my_draws_and_stats(self):
        self.game(0)
        self.game(1, a=2)
        self.game(None, a=0)
        self.assertEqual(self.client.get("/api/auth/me/draws/").status_code, 401)
        res = self.client.get("/api/auth/me/draws/", **self.auth(self.ana)).json()
        self.assertEqual(res["count"], 3)
        first = res["results"][0]  # mais recente
        self.assertIsNone(first["result"])
        self.assertEqual(first["opponents"][0]["player_name"], "beto")
        self.assertEqual([r["result"] for r in res["results"]], [None, "lost", "won"])
        self.assertEqual(res["results"][1]["winner"], "beto")

        stats = self.client.get("/api/auth/me/stats/", **self.auth(self.ana)).json()
        self.assertEqual((stats["draws"], stats["games"], stats["wins"]), (3, 2, 1))
        self.assertEqual(stats["most_received"][0]["deck"]["slug"], "d0")
        self.assertEqual(stats["most_received"][0]["times"], 2)
        self.assertEqual(stats["best_decks"][0]["deck"]["slug"], "d0")
