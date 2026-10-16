from decimal import Decimal
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings

from decks.models import Card, Deck, DeckCard, Edition
from decks.services import prices
from decks.services.scryfall import apply_prices


def card(i, name, usd=None, eur=None, type_line="Creature"):
    return Card.objects.create(
        scryfall_id=f"00000000-0000-0000-0000-{i:012d}", name=name, type_line=type_line,
        price_usd=usd, price_eur=eur,
    )


class PriceTests(TestCase):
    def setUp(self):
        ed = Edition.objects.create(code="PRC", name="Preços")
        self.deck = Deck.objects.create(name="Caro", slug="caro", edition=ed)
        self.sol = card(1, "Sol Ring", Decimal("1.50"), Decimal("1.20"))
        self.dockside = card(2, "Dockside Extortionist", Decimal("60.00"), Decimal("55.00"))
        self.promo = card(3, "Promo Sem Preço")
        self.forest = card(4, "Forest", type_line="Basic Land — Forest")
        for c, q in ((self.sol, 1), (self.dockside, 1), (self.promo, 1), (self.forest, 30)):
            DeckCard.objects.create(deck=self.deck, card=c, quantity=q)

    def test_scryfall_prices_fall_back_to_foil(self):
        c = Card(name="x")
        apply_prices(c, {"prices": {"usd": None, "usd_foil": "12.345", "eur": "3"}})
        self.assertEqual((c.price_usd, c.price_eur), (Decimal("12.35"), Decimal("3.00")))
        apply_prices(c, {"prices": {}})
        self.assertIsNone(c.price_usd)

    def test_deck_total_missing_and_top(self):
        price = prices.deck_price(self.deck.deck_cards.select_related("card"))
        self.assertEqual((price["usd"], price["eur"]), (Decimal("61.50"), Decimal("56.20")))
        self.assertEqual(price["missing"], 1)  # o básico sem preço não conta como falta
        self.assertEqual([t["name"] for t in price["top"]], ["Dockside Extortionist", "Sol Ring"])

    def test_api_shows_price_and_orders_catalog(self):
        detail = self.client.get("/api/decks/caro/").json()
        self.assertEqual((detail["price"]["usd"], detail["price"]["missing"]), ("61.50", 1))
        self.deck.refresh_from_db()
        self.assertEqual(self.deck.price_usd, Decimal("61.50"))  # o valor fica guardado no deck
        listing = self.client.get("/api/decks/?ordering=-price_usd").json()["results"]
        self.assertEqual(listing[0]["price_usd"], "61.50")

    @override_settings(PRICES_REFRESH_ENABLED=True)
    def test_stale_cards_are_refreshed_once(self):
        answer = {"data": [{"id": str(self.sol.scryfall_id), "prices": {"usd": "2.00", "eur": "1.80"}}]}
        with mock.patch("decks.services.prices.fetch_json", return_value=answer) as fetch:
            self.client.get("/api/decks/caro/")
            self.client.get("/api/decks/caro/")  # o valor ainda é novo: não chama de novo
        self.assertEqual(fetch.call_count, 1)
        self.deck.refresh_from_db()
        self.assertEqual(self.deck.price_usd, Decimal("62.00"))

    @override_settings(PRICES_REFRESH_ENABLED=True)
    def test_scryfall_down_keeps_last_known_value(self):
        with mock.patch("decks.services.prices.fetch_json", side_effect=OSError("fora do ar")):
            res = self.client.get("/api/decks/caro/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["price"]["usd"], "61.50")

    def test_sync_prices_command(self):
        answer = {"data": [{"id": str(self.promo.scryfall_id), "prices": {"usd": "5.00"}}]}
        with mock.patch("decks.services.prices.fetch_json", return_value=answer):
            call_command("sync_prices", "--older-than", "0", stdout=mock.Mock())
        self.deck.refresh_from_db()
        self.assertEqual(self.deck.price_usd, Decimal("66.50"))
