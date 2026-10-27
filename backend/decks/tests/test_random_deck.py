from unittest import mock

from django.core.cache import cache
from django.test import TestCase

from decks.models import Card, Deck, DeckCard, Edition
from decks.services import draw as draw_service


class RandomDeckTests(TestCase):
    def setUp(self):
        cache.clear()
        ed = Edition.objects.create(code="TST", name="Test")
        self.decks = {}
        for slug, ci, bracket, price in [("gw", "WG", 2, 100), ("ub", "UB", 3, 400), ("r", "R", 4, 120)]:
            self.decks[slug] = Deck.objects.create(
                name=slug, slug=slug, edition=ed, color_identity=ci, bracket=bracket, price_usd=price, is_active=True
            )

    def get(self, **params):
        return self.client.get("/api/decks/random/", params)

    def test_any_precon(self):
        res = self.get()
        self.assertEqual(res.status_code, 200)
        self.assertIn(res.json()["deck"]["slug"], self.decks)
        self.assertEqual(res.json()["pool"], 3)
        self.assertEqual(res.json()["deck"]["kind"], "precon")

    def test_table_rules_colors_and_exclude(self):
        for _ in range(5):
            self.assertEqual(self.get(bracket=3, price=150).json()["deck"]["slug"], "gw")
            self.assertEqual(self.get(colors="u").json()["deck"]["slug"], "ub")
            self.assertEqual(self.get(exclude="gw,ub").json()["deck"]["slug"], "r")
        self.assertEqual(self.get(colors="WUBRG").json(), {"detail": "no_deck"})
        self.assertEqual(self.get(bracket=2, exclude="gw").status_code, 404)

    def test_tutor_rule_skips_decks_with_too_many(self):
        tutor = Card.objects.create(scryfall_id="00000000-0000-0000-0000-000000000001", name="Tutor", category="spell")
        DeckCard.objects.create(deck=self.decks["gw"], card=tutor, quantity=1)
        with mock.patch("decks.services.analysis.deck_tutors", side_effect=lambda d: 2 if d.slug == "gw" else 0):
            for _ in range(5):
                self.assertNotEqual(self.get(tutors=1).json()["deck"]["slug"], "gw")

    def test_bad_params_are_ignored(self):
        self.assertEqual(self.get(bracket="x", price="-3", tutors="999", colors="zz").status_code, 200)

    def test_service_returns_none_when_nothing_fits(self):
        self.assertIsNone(draw_service.random_precon(exclude=list(self.decks)))
