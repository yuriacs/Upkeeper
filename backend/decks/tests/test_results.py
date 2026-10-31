from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.authtoken.models import Token

from decks.models import Deck, Draw, DrawEntry, Edition, RankingRow
from decks.services import stats

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
        """Partida ana (deck a) x beto (deck b) com vencedor já marcado (e somado no ranking)."""
        draw = Draw.objects.create(code=f"g{Draw.objects.count()}", winner_position=winner)
        DrawEntry.objects.create(draw=draw, position=0, player_name="ana", player=self.ana, deck=self.decks[a])
        DrawEntry.objects.create(draw=draw, position=1, player_name="beto", player=self.beto, deck=self.decks[b])
        stats.touch("draws", stats.refs_of("draws", [draw.pk]))
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
        self.assertEqual(data["players"][0]["wins"], 3)
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

    def test_ranking_by_players_per_game(self):
        self.game(0)  # 2 jogadores: ana ganha
        three = self.game(1)  # 3 jogadores: beto ganha
        DrawEntry.objects.create(draw=three, position=2, player_name="zeca", player=self.estranho, deck=self.decks[2])
        stats.touch("draws", stats.refs_of("draws", [three.pk]))
        self.table_game(self.ana)  # mesa com 2: ana ganha

        def get(url):
            return self.client.get(url).json()

        self.assertEqual(get("/api/stats/")["games"], 2)
        two = get("/api/stats/?players=2")
        self.assertEqual((two["games"], two["players_per_game"]), (1, 2))
        self.assertEqual([p["username"] for p in two["players"]], ["ana"])
        three_ = get("/api/stats/?players=3")
        self.assertEqual(three_["games"], 1)
        self.assertEqual([p["username"] for p in three_["players"]], ["beto"])
        self.assertEqual(get("/api/stats/?players=4")["games"], 0)
        self.assertEqual(get("/api/stats/?players=9")["players_per_game"], None)  # inválido: todas
        self.assertEqual(get("/api/stats/?source=tables&players=2")["games"], 1)
        self.assertEqual(get("/api/stats/?source=tables&players=3")["games"], 0)
        # Resultado novo apaga o cache de todos os tamanhos
        self.table_game(self.beto)
        self.assertEqual(get("/api/stats/?source=tables&players=2")["games"], 2)

    def test_pool_decks_show_in_the_ranking(self):
        from asgiref.sync import async_to_sync

        from pools.models import UserDeck
        from tables import state, store

        mine = UserDeck.objects.create(owner=self.ana, name="Arame farpado")
        data = state.new_table("POOL")
        for user, deck in ((self.ana, {"kind": "user", "ref": str(mine.pk)}), (self.beto, {"kind": "precon", "ref": "d1"})):
            seat = data["seats"][str(user.id)] = state.new_seat(user.id, user.username, len(data["seats"]) + 1)
            seat["deck"] = {**deck, "name": "x"}
        data["result"] = {"winner": self.ana.id, "turn": 3}
        async_to_sync(store.save_table_result)(data, None)
        top = self.client.get("/api/stats/?source=tables").json()["most_wins"]
        self.assertEqual([(r["deck"]["kind"], r["deck"]["name"]) for r in top], [("user", "Arame farpado")])

    def test_touch_matches_a_full_rebuild(self):
        """Cada resultado refaz só as linhas de quem jogou; somar tudo de novo dá o mesmo."""
        for _ in range(3):
            self.game(0)
        self.game(1, a=2, b=1)
        replaced = self.table_game(self.ana)
        self.table_game(self.beto, replaced)  # remarcado
        self.table_game(self.ana, a=3, b=4)
        draw = self.game(None, a=4, b=3)
        self.post(f"/api/draw/{draw.code}/result/", {"winner": 1}, **self.auth(self.ana))
        self.post(f"/api/draw/{draw.code}/result/", {"winner": None}, **self.auth(self.ana))  # desmarcado

        def snapshot():
            return sorted(RankingRow.objects.values_list("source", "size", "kind", "ref", "games", "wins"))

        touched = snapshot()
        self.assertTrue(touched)
        RankingRow.objects.all().delete()
        stats.rebuild()
        self.assertEqual(snapshot(), touched)

    def test_ranking_reads_only_the_summed_rows(self):
        for _ in range(3):
            self.game(0)
        self.game(1)
        cache.clear()
        with self.assertNumQueries(10):  # linhas somadas, decks, contas e apoiadores: sem somar partidas
            data = stats.global_stats()
        self.assertEqual((data["games"], data["players"][0]["username"]), (4, "ana"))

    def test_deleted_account_leaves_the_ranking(self):
        from accounts.services import delete_account

        self.game(0)
        delete_account(self.beto)
        self.assertEqual([p["username"] for p in self.client.get("/api/stats/").json()["players"]], ["ana"])
        self.assertFalse(RankingRow.objects.filter(kind=RankingRow.KIND_PLAYER, ref=self.beto.pk).exists())

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
