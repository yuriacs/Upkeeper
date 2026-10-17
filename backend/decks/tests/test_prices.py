from decimal import Decimal
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

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


class CheapestPrintingTests(TestCase):
    """O preço da carta é o da edição mais barata (dólar e euro, cada um pela sua), não o da edição do deck."""

    def test_uses_cheapest_printing_for_every_copy(self):
        oid = "6ad8011d-3471-4369-9d68-b264cc027487"
        promo = Card.objects.create(scryfall_id="00000000-0000-0000-0000-000000000011", name="Sol Ring",
                                    type_line="Artifact", oracle_id=oid, price_usd=Decimal("40.00"))
        other = Card.objects.create(scryfall_id="00000000-0000-0000-0000-000000000012", name="Sol Ring",
                                    type_line="Artifact", oracle_id=oid)

        def fake(url, **kw):
            usd_low = "usd-low" in url
            prices_ = {"usd": "1.25", "eur": "1.24"} if usd_low else {"usd": "1.90", "eur": "0.69"}
            return {"data": [{"id": "x", "oracle_id": oid, "prices": prices_}], "has_more": False}

        with mock.patch("decks.services.prices.fetch_json", side_effect=fake) as fetch:
            self.assertEqual(prices.refresh_card_prices([promo, other], delay=0), 2)
        self.assertEqual(fetch.call_count, 2)  # uma busca em dólar e uma em euro para o lote todo
        for c in (promo, other):
            c.refresh_from_db()
            self.assertEqual((c.price_usd, c.price_eur), (Decimal("1.25"), Decimal("0.69")))


class StoredValueTests(TestCase):
    def setUp(self):
        ed = Edition.objects.create(code="PRD", name="Preços 2")
        self.deck = Deck.objects.create(name="Velho", slug="velho", edition=ed, price_usd=Decimal("99.00"),
                                        price_eur=Decimal("99.00"), price_at=timezone.now())
        self.card = card(21, "Sol Ring", Decimal("1.25"), Decimal("0.69"))
        DeckCard.objects.create(deck=self.deck, card=self.card, quantity=1)

    def test_deck_page_fixes_the_stored_value(self):
        detail = self.client.get("/api/decks/velho/").json()
        self.assertEqual(detail["price"]["usd"], "1.25")
        self.deck.refresh_from_db()
        self.assertEqual((self.deck.price_usd, self.deck.price_eur), (Decimal("1.25"), Decimal("0.69")))

    def test_sync_recalculates_decks_even_if_scryfall_fails(self):
        with mock.patch("decks.services.prices.fetch_json", side_effect=OSError("fora do ar")):
            call_command("sync_prices", "--older-than", "0", stdout=mock.Mock())
        self.deck.refresh_from_db()
        self.assertEqual(self.deck.price_usd, Decimal("1.25"))  # com os preços que as cartas já têm
        from decks.models import TagSync
        from decks.management.commands.sync_prices import PRICE_RULE

        self.assertEqual(TagSync.objects.get(tag=PRICE_RULE).cards, 0)  # a troca ficou para o próximo deploy


class RateLimitTests(TestCase):
    def test_429_waits_and_retries(self):
        import urllib.error
        from email.message import Message

        oid = "6ad8011d-3471-4369-9d68-b264cc027487"
        c = Card.objects.create(scryfall_id="00000000-0000-0000-0000-000000000031", name="Sol Ring",
                                type_line="Artifact", oracle_id=oid)
        headers = Message()
        headers["Retry-After"] = "3"
        busy = urllib.error.HTTPError("u", 429, "Too Many Requests", headers, None)
        ok = {"data": [{"oracle_id": oid, "prices": {"usd": "1.25", "eur": "0.69"}}], "has_more": False}
        with mock.patch("decks.services.prices.fetch_json", side_effect=[busy, ok, ok]), \
                mock.patch("decks.services.prices.time.sleep") as sleep:
            self.assertEqual(prices.refresh_card_prices([c]), 1)
        self.assertIn(mock.call(3.0), sleep.call_args_list)  # esperou o que o Scryfall pediu
        c.refresh_from_db()
        self.assertEqual(c.price_usd, Decimal("1.25"))


class SyncLimitTests(TestCase):
    def test_oldest_first_and_rest_for_next_time(self):
        from datetime import timedelta

        from decks.management.commands.sync_prices import PRICE_RULE
        from decks.models import TagSync

        TagSync.objects.create(tag=PRICE_RULE, synced_at=timezone.now() - timedelta(days=30), cards=1)
        now = timezone.now()
        old = [card(40 + i, f"Carta {i}", Decimal("1.00")) for i in range(3)]
        for i, c in enumerate(old):  # a carta 0 é a mais velha
            Card.objects.filter(pk=c.pk).update(price_at=now - timedelta(days=20 - i))
        seen = []

        def fake(url, data=None, **kw):
            seen.extend(i["id"] for i in data["identifiers"])
            return {"data": []}

        with mock.patch("decks.services.prices.fetch_json", side_effect=fake):
            call_command("sync_prices", "--older-than", "7", "--max-cards", "2", stdout=mock.Mock())
        self.assertEqual(seen, [str(old[0].scryfall_id), str(old[1].scryfall_id)])  # as duas mais velhas
