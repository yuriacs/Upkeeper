from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.authtoken.models import Token

from decks.models import Deck, Edition
from tables import store

User = get_user_model()


class TableGamesInHistoryTests(TestCase):
    """Partidas de mesa aberta (sem sorteio) entram no histórico, nos números e no perfil."""

    def setUp(self):
        cache.clear()
        ed = Edition.objects.create(code="HST", name="Histórico")
        Deck.objects.create(name="Anjos", slug="anjos", edition=ed, color_identity="W")
        Deck.objects.create(name="Dragões", slug="dragoes", edition=ed, color_identity="R")
        self.ana = User.objects.create_user("ana", "", "x")
        self.beto = User.objects.create_user("beto", "", "x")
        data = {
            "seats": {
                "1": {"user_id": self.ana.id, "deck": {"kind": "precon", "ref": "anjos"}},
                "2": {"user_id": self.beto.id, "deck": {"kind": "precon", "ref": "dragoes"}},
            },
            "result": {"winner": self.ana.id, "turn": 8},
        }
        # A função é assíncrona (chamada pela mesa); aqui roda a versão síncrona por baixo
        self.assertIsNotNone(store.save_table_result.func(data, None))
        self.auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.ana).key}"}

    def test_history_stats_and_profile(self):
        items = self.client.get("/api/auth/me/draws/", **self.auth).json()["results"]
        self.assertEqual(len(items), 1)
        game = items[0]
        self.assertEqual((game["mode"], game["result"], game["winner"]), ("table", "won", "ana"))
        self.assertEqual(game["deck"]["name"], "Anjos")
        self.assertEqual([(o["player_name"], o["deck"]["name"]) for o in game["opponents"]], [("beto", "Dragões")])
        stats = self.client.get("/api/auth/me/stats/", **self.auth).json()
        self.assertEqual((stats["games"], stats["wins"], stats["table_games"]), (1, 1, 1))
        self.assertEqual(stats["best_decks"][0]["deck"]["name"], "Anjos")
        profile = self.client.get("/api/users/ana/").json()
        self.assertEqual((profile["stats"]["games"], profile["stats"]["wins"]), (1, 1))
