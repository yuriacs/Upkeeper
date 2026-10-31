import uuid
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token

from decks.models import Card, Deck, DeckCard, Edition, OracleTag
from pools.models import OwnedPrecon, UserDeck, UserDeckCard
from social import clients

User = get_user_model()


def card(name, identity="", price=None, type_line="Artifact", **extra):
    return Card.objects.create(
        scryfall_id=uuid.uuid4(), oracle_id=uuid.uuid4(), name=name, type_line=type_line, color_identity=identity,
        image_normal="https://img/x.jpg", price_usd=price, **extra,
    )


class GeneratorAITests(TestCase):
    def setUp(self):
        cache.clear()
        user = User.objects.create_user("ana", "", "x")
        self.auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=user).key}"}

    def post(self, path, body, **extra):
        return self.client.post(path, body, content_type="application/json", **self.auth, **extra)

    def test_needs_login(self):
        self.assertEqual(self.client.get("/api/generator/").status_code, 401)
        self.assertEqual(self.client.post("/api/generator/describe/", {"text": "elfos"}).status_code, 401)

    def test_without_key_the_ai_is_off(self):
        self.assertEqual(self.client.get("/api/generator/", **self.auth).json(), {"ai": False, "ai_left": 0})
        res = self.post("/api/generator/describe/", {"text": "um deck de elfos"})
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()["code"], "ai_off")

    @override_settings(GEMINI_API_KEY="chave", GENERATOR_AI_ENABLED=False)
    def test_can_be_turned_off_keeping_the_key(self):
        self.assertFalse(self.client.get("/api/generator/", **self.auth).json()["ai"])

    @override_settings(GEMINI_API_KEY="chave")
    def test_describe_cleans_what_the_ai_answers(self):
        raw = {
            "commander": "  Lathliss,   Dragon Queen ", "partner": "", "suggestions": ["A", "a", "B"],
            "colors": "rx", "themes": ["Dragons", "Treasure", "Tokens", "Ramp"], "budget_usd": 5,
            "bracket": 9, "include": ["Sol Ring"], "exclude": [], "name": "Dragões " * 20,
        }
        with mock.patch.object(clients, "editor_json", return_value=raw) as editor:
            res = self.post("/api/generator/describe/", {"text": "dragões vermelhos, bem barato"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["commander"], "Lathliss, Dragon Queen")
        self.assertEqual(data["suggestions"], ["A", "B"])  # sem repetir
        self.assertEqual(data["colors"], "R")
        self.assertEqual(data["themes"], ["Dragons", "Treasure", "Tokens"])  # no máximo 3
        self.assertIsNone(data["budget"])  # fora da faixa aceita
        self.assertIsNone(data["bracket"])
        self.assertLessEqual(len(data["name"]), 60)
        self.assertGreaterEqual(data["ai_left"], 0)
        # Só o texto digitado vai para a IA
        self.assertEqual(editor.call_args.args[1], "dragões vermelhos, bem barato")

    @override_settings(GEMINI_API_KEY="chave")
    def test_describe_errors(self):
        self.assertEqual(self.post("/api/generator/describe/", {"text": " "}).status_code, 400)
        with mock.patch.object(clients, "editor_json", side_effect=clients.ServiceError("fora", 503)):
            res = self.post("/api/generator/describe/", {"text": "elfos"})
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.json()["code"], "ai_failed")

    @override_settings(GEMINI_API_KEY="chave")
    def test_guide_only_points_to_cards_in_the_deck(self):
        raw = {
            "summary": "Vai de dragões.", "early": "a", "middle": "b", "late": "c", "watch_out": "d", "mulligan": "e",
            "win_cards": ["Scourge of Valkas", "Carta Inventada", "lathliss, dragon queen"],
        }
        body = {
            "commanders": ["Lathliss, Dragon Queen"], "themes": ["Dragons"], "bracket": 2,
            "cards": [{"name": "Scourge of Valkas", "role": "other"}, {"name": "Sol Ring", "role": "ramp"}],
        }
        with mock.patch.object(clients, "editor_json", return_value=raw) as editor:
            res = self.post("/api/generator/guide/", body, HTTP_ACCEPT_LANGUAGE="pt-BR")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["win_cards"], ["Scourge of Valkas", "Lathliss, Dragon Queen"])
        self.assertEqual(res.json()["summary"], "Vai de dragões.")
        self.assertIn("Portuguese", editor.call_args.args[0])
        self.assertIn('"ramp": ["Sol Ring"]', editor.call_args.args[1])

    @override_settings(GEMINI_API_KEY="chave")
    def test_guide_needs_a_deck(self):
        self.assertEqual(self.post("/api/generator/guide/", {"commanders": ["X"], "cards": []}).status_code, 400)
        self.assertEqual(self.post("/api/generator/guide/", {"commanders": [], "cards": [{"name": "A"}]}).status_code, 400)
        many = [{"name": f"Carta {i}"} for i in range(200)]
        self.assertEqual(self.post("/api/generator/guide/", {"commanders": ["X"], "cards": many}).status_code, 400)


class CardPoolTests(TestCase):
    def setUp(self):
        self.ana = User.objects.create_user("ana", "", "x")
        self.auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.ana).key}"}
        edition = Edition.objects.create(code="TST", name="Teste")
        precon = Deck.objects.create(name="Precon", slug="precon", edition=edition)
        other = Deck.objects.create(name="Outro", slug="outro", edition=edition)
        self.sol = card("Sol Ring", price=Decimal("1.50"))
        cheap_sol = card("Sol Ring", price=Decimal("0.90"))
        elf = card("Llanowar Elves", "G", Decimal("0.25"), "Creature — Elf Druid")
        bolt = card("Lightning Bolt", "R", Decimal("0.50"), "Instant")
        unowned = card("Rhystic Study", "U", Decimal("40"), "Enchantment")
        DeckCard.objects.create(deck=precon, card=self.sol)
        DeckCard.objects.create(deck=precon, card=elf)
        DeckCard.objects.create(deck=other, card=unowned)  # precon que a Ana não marcou
        OwnedPrecon.objects.create(user=self.ana, deck=precon)
        mine = UserDeck.objects.create(owner=self.ana, name="Meu")
        UserDeckCard.objects.create(deck=mine, card=cheap_sol)
        UserDeckCard.objects.create(deck=mine, card=bolt)
        OracleTag.objects.create(oracle_id=elf.oracle_id, tag="ramp")

    def get(self, query=""):
        return self.client.get(f"/api/me/card-pool/{query}", **self.auth)

    def test_cards_from_owned_precons_and_built_decks(self):
        data = self.get().json()
        self.assertEqual([c["name"] for c in data["cards"]], ["Lightning Bolt", "Llanowar Elves", "Sol Ring"])
        self.assertEqual((data["precons"], data["decks"]), (1, 1))
        by_name = {c["name"]: c for c in data["cards"]}
        self.assertEqual(by_name["Sol Ring"]["price_usd"], "0.90")  # a impressão mais barata
        self.assertEqual(by_name["Sol Ring"]["roles"], ["fast_mana"])
        self.assertEqual(by_name["Llanowar Elves"]["roles"], ["ramp"])

    def test_identity_filter(self):
        self.assertEqual([c["name"] for c in self.get("?identity=G").json()["cards"]], ["Llanowar Elves", "Sol Ring"])
        self.assertEqual([c["name"] for c in self.get("?identity=C").json()["cards"]], ["Sol Ring"])

    def test_only_your_own_cards(self):
        bia = User.objects.create_user("bia", "", "x")
        auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=bia).key}"}
        self.assertEqual(self.client.get("/api/me/card-pool/", **auth).json()["cards"], [])
        self.assertEqual(self.client.get("/api/me/card-pool/").status_code, 401)
