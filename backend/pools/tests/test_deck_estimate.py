from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token

User = get_user_model()
TERGRID = "Tergrid, God of Fright // Tergrid's Lantern"


def spellbook(commanders, main):
    names = commanders + [n for n, _ in main]
    # Como o Spellbook de verdade: só reconhece carta de duas faces pelo nome inteiro
    return {"cards": [{"card": {"name": n}, "gameChanger": n in (TERGRID, "Rhystic Study")} for n in names], "combos": []}


@override_settings(BRACKETS_ENABLED=True)
class DeckEstimateTests(TestCase):
    def setUp(self):
        cache.clear()
        user = User.objects.create_user("ana", "", "x")
        self.auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=user).key}"}

    def post(self, cards):
        return self.client.post("/api/deck-estimate/", {"cards": cards}, content_type="application/json", **self.auth)

    def test_game_changer_commander_with_two_faces_goes_to_bracket_3(self):
        cards = [
            {"name": TERGRID, "oracle_id": "2fc6f6ed-7f64-4a8c-a1be-7b5f1b3c8c11", "qty": 1, "cmc": 5, "commander": True},
            {"name": "Swamp", "qty": 30, "cmc": 0, "land": True},
            {"name": "Sol Ring", "qty": 1, "cmc": 1},
        ]
        with mock.patch("decks.services.brackets.spellbook_estimate", side_effect=spellbook) as sb:
            res = self.post(cards).json()
            self.post(cards)  # mesma lista: vem do cache, sem perguntar de novo
        self.assertEqual(sb.call_count, 1)
        self.assertEqual(sb.call_args.args[0], [TERGRID])  # nome inteiro
        self.assertEqual(res["bracket"], 3)
        self.assertEqual(res["bracket_details"]["game_changers"], [TERGRID])
        analysis = res["analysis"]
        self.assertEqual(analysis["lands"], 30)
        self.assertEqual(analysis["categories"]["fast_mana"]["cards"], ["Sol Ring"])
        self.assertGreater(analysis["power"], 1)

    def test_spellbook_down_still_gives_the_analysis(self):
        import urllib.error

        with mock.patch("decks.services.brackets.spellbook_estimate", side_effect=urllib.error.URLError("fora")):
            res = self.post([{"name": "Sol Ring", "qty": 1, "cmc": 1}]).json()
        self.assertIsNone(res["bracket"])
        self.assertIn("power", res["analysis"])

    def test_bad_input(self):
        self.assertEqual(self.post("x").status_code, 400)
        self.assertEqual(self.post([{"name": "A", "qty": "muitos"}]).status_code, 400)
        anon = self.client.post("/api/deck-estimate/", {"cards": []}, content_type="application/json")
        self.assertEqual(anon.status_code, 401)
