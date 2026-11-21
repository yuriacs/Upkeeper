import uuid
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from decks.models import Card, Deck, Edition
from pools.models import CollectionCard, OwnedPrecon, UserDeck
from pools.services import collection

User = get_user_model()


def card(name, set_code="cmm", number="1", price="1.00", identity="", category="other", sid=None):
    return Card.objects.create(
        scryfall_id=sid or uuid.uuid4(),
        name=name,
        set_code=set_code,
        collector_number=number,
        image_normal=f"https://cards.scryfall.io/{name}.jpg",
        price_usd=Decimal(price) if price else None,
        color_identity=identity,
        category=category,
    )


class CollectionImportTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("ana", password="x")
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.ring = card("Sol Ring", "cmm", "410", "1.50", category="artifact")
        self.bolt = card("Lightning Bolt", "2xm", "141", "0.90", "R", "instant")

    def post(self, rows, replace=False):
        return self.api.post("/api/me/collection/import/", {"rows": rows, "replace": replace}, format="json")

    def test_matches_by_id_print_and_name_without_scryfall(self):
        rows = [
            {"quantity": 2, "scryfall_id": str(self.ring.scryfall_id), "name": "Sol Ring"},
            {"quantity": 1, "set": "2XM", "number": "141", "name": "Lightning Bolt", "foil": True},
            {"quantity": 3, "name": "sol ring"},
        ]
        with mock.patch.object(collection, "fetch_cards", side_effect=AssertionError("no Scryfall")):
            res = self.post(rows).json()
        self.assertEqual((res["added"], res["matched"], res["missing"]), (6, 3, []))
        got = {(c.card.name, c.foil): c.quantity for c in CollectionCard.objects.select_related("card")}
        self.assertEqual(got, {("Sol Ring", False): 5, ("Lightning Bolt", True): 1})
        self.assertEqual(res["totals"]["copies"], 6)
        self.assertEqual(res["totals"]["unique"], 2)
        self.assertEqual(res["totals"]["value_usd"], 8.4)  # 5 × 1,50 + 0,90

    def test_unknown_cards_go_to_scryfall_and_missing_are_reported(self):
        new = card("Arcane Signet", "cmm", "380")

        def fake_fetch(requests):
            return {i: new for i, r in enumerate(requests) if r.get("id") == "11111111-1111-1111-1111-111111111111"}

        rows = [
            {"quantity": 1, "scryfall_id": "11111111-1111-1111-1111-111111111111", "name": "Arcane Signet"},
            {"quantity": 1, "name": "Not A Real Card"},
        ]
        with mock.patch.object(collection, "fetch_cards", side_effect=fake_fetch):
            res = self.post(rows).json()
        self.assertEqual(res["matched"], 1)
        self.assertEqual(res["missing"], ["Not A Real Card"])

    def test_replace_on_first_batch_and_add_after(self):
        self.post([{"quantity": 4, "name": "Sol Ring"}])
        self.post([{"quantity": 1, "name": "Lightning Bolt"}], replace=True)
        self.post([{"quantity": 2, "name": "Lightning Bolt"}])
        got = {c.card.name: c.quantity for c in CollectionCard.objects.select_related("card")}
        self.assertEqual(got, {"Lightning Bolt": 3})

    def test_list_filters_edit_delete_and_names(self):
        self.post([{"quantity": 2, "name": "Sol Ring"}, {"quantity": 1, "name": "Lightning Bolt"}])
        data = self.api.get("/api/me/collection/?sort=-price").json()
        self.assertEqual([r["name"] for r in data["results"]], ["Sol Ring", "Lightning Bolt"])
        self.assertEqual([r["name"] for r in self.api.get("/api/me/collection/?colors=C").json()["results"]], ["Sol Ring"])
        self.assertEqual([r["name"] for r in self.api.get("/api/me/collection/?category=instant").json()["results"]], ["Lightning Bolt"])
        self.assertEqual([r["name"] for r in self.api.get("/api/me/collection/?q=bolt").json()["results"]], ["Lightning Bolt"])
        row = data["results"][0]["id"]
        self.assertEqual(self.api.patch(f"/api/me/collection/{row}/", {"quantity": 7}, format="json").json()["quantity"], 7)
        self.assertEqual(self.api.patch(f"/api/me/collection/{row}/", {"quantity": 0}, format="json").status_code, 204)
        self.assertEqual(self.api.get("/api/me/collection/names/").json()["names"], ["lightning bolt"])
        self.api.delete("/api/me/collection/")
        self.assertFalse(CollectionCard.objects.exists())

    def test_others_cannot_touch_my_collection(self):
        self.post([{"quantity": 1, "name": "Sol Ring"}])
        row = CollectionCard.objects.get().pk
        other = APIClient()
        other.force_authenticate(User.objects.create_user("bia", password="x"))
        self.assertEqual(other.patch(f"/api/me/collection/{row}/", {"quantity": 9}, format="json").status_code, 404)
        self.assertEqual(other.get("/api/me/collection/").json()["count"], 0)

    def test_generator_pool_includes_the_collection(self):
        self.post([{"quantity": 1, "name": "Lightning Bolt"}, {"quantity": 1, "name": "Sol Ring"}])
        with mock.patch("pools.generator.tags_for", return_value={}):
            res = self.api.get("/api/me/card-pool/?identity=R").json()
        self.assertEqual(sorted(c["name"] for c in res["cards"]), ["Lightning Bolt", "Sol Ring"])
        self.assertEqual(res["collection"], 2)


class OrganizeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("ana", password="x")
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_folder_and_tags_on_built_decks_and_precons(self):
        deck = UserDeck.objects.create(owner=self.user, name="Elfos")
        res = self.api.patch(
            f"/api/me/decks/{deck.pk}/organize/",
            {"folder": "  Casual  ", "tags": ["Elfos", "elfos", " competitivo ", ""]},
            format="json",
        ).json()
        self.assertEqual(res, {"folder": "Casual", "tags": ["Elfos", "competitivo"]})
        listed = self.api.get("/api/me/decks/").json()[0]
        self.assertEqual((listed["folder"], listed["tags"]), ("Casual", ["Elfos", "competitivo"]))

        edition = Edition.objects.create(code="CMM", name="Commander Masters")
        precon = Deck.objects.create(name="Eldrazi", slug="eldrazi", edition=edition)
        OwnedPrecon.objects.create(user=self.user, deck=precon)
        self.api.patch("/api/me/precons/eldrazi/organize/", {"folder": "Caixa 1"}, format="json")
        mine = self.api.get("/api/me/precons/").json()
        self.assertEqual(mine["slugs"], ["eldrazi"])
        self.assertEqual(mine["organize"]["eldrazi"]["folder"], "Caixa 1")

    def test_cannot_organize_someone_elses_deck(self):
        other = User.objects.create_user("bia", password="x")
        deck = UserDeck.objects.create(owner=other, name="Dela")
        self.assertEqual(self.api.patch(f"/api/me/decks/{deck.pk}/organize/", {"folder": "x"}, format="json").status_code, 404)
