from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse

from decks.models import Deck

FIXTURES = Path(__file__).parent / "fixtures" / "mtgjson"


class ApiTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command(
            "import_mtgjson", "--local-dir", str(FIXTURES), "--skip-editions", stdout=StringIO()
        )


class EditionApiTests(ApiTestCase):
    def test_lists_editions_with_deck_count(self):
        res = self.client.get("/api/editions/")
        self.assertEqual(res.status_code, 200)
        counts = {e["code"]: e["deck_count"] for e in res.json()}
        self.assertEqual(counts, {"40K": 2, "WHO": 1})


class DeckListApiTests(ApiTestCase):
    def get(self, **params):
        res = self.client.get("/api/decks/", params)
        self.assertEqual(res.status_code, 200)
        return res.json()

    def test_paginated_list(self):
        data = self.get()
        self.assertEqual(data["count"], 3)
        self.assertIn("face_commander", data["results"][0])

    def test_filter_by_edition(self):
        self.assertEqual(self.get(edition="who")["count"], 1)
        self.assertEqual(self.get(edition="40K,WHO")["count"], 3)

    def test_filter_by_colors_any_order(self):
        self.assertEqual(self.get(colors="B")["count"], 1)  # Necron
        self.assertEqual(self.get(colors="C")["count"], 0)

    def test_search_by_commander_name(self):
        data = self.get(search="szarekh")
        self.assertEqual([d["name"] for d in data["results"]], ["Necron Dynasties"])

    def test_search_partner_commander(self):
        self.assertEqual(self.get(search="sarah jane")["count"], 1)

    def test_filter_active(self):
        self.assertEqual(self.get(active="true")["count"], 2)


class DeckDetailApiTests(ApiTestCase):
    def test_detail_groups_cards_by_category(self):
        slug = Deck.objects.get(mtgjson_file="NecronDynasties_40K").slug
        with self.assertNumQueries(2):  # deck + cartas, independente do tamanho
            res = self.client.get(f"/api/decks/{slug}/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["card_count"], 100)
        self.assertEqual(data["commanders"][0]["card"]["name"], "Szarekh, the Silent King")
        keys = [s["key"] for s in data["sections"]]
        self.assertEqual(keys[-1], "land")
        self.assertEqual(sum(s["count"] for s in data["sections"]) + 1, 100)

    def test_unknown_slug_404(self):
        self.assertEqual(self.client.get("/api/decks/nao-existe/").status_code, 404)


class DrawApiTests(ApiTestCase):
    def post(self, body):
        return self.client.post(reverse("draw"), body, content_type="application/json")

    def test_draw_two_distinct_active_decks(self):
        for _ in range(20):
            res = self.post({"players": 2})
            self.assertEqual(res.status_code, 201)
            entries = res.json()["entries"]
            self.assertEqual(len({e["deck"]["slug"] for e in entries}), 2)
            # A versão de colecionador está inativa e nunca é sorteada
            self.assertTrue(all(e["deck"]["is_active"] for e in entries))

    def test_names_are_kept_in_order(self):
        res = self.post({"names": ["Ana", "Beto"]})
        self.assertEqual(res.status_code, 201)
        self.assertEqual([e["player_name"] for e in res.json()["entries"]], ["Ana", "Beto"])

    def test_blank_names_get_default(self):
        res = self.post({"names": ["Ana", ""]})
        self.assertEqual([e["player_name"] for e in res.json()["entries"]], ["Ana", "Jogador 2"])

    def test_duplicate_names_rejected(self):
        self.assertEqual(self.post({"names": ["Ana", "ana"]}).status_code, 400)

    def test_names_and_players_must_match(self):
        self.assertEqual(self.post({"players": 3, "names": ["Ana", "Beto"]}).status_code, 400)

    def test_shareable_link(self):
        code = self.post({"names": ["Ana", "Beto"]}).json()["code"]
        res = self.client.get(f"/api/draw/{code}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["players"], 2)
        self.assertEqual(self.client.get("/api/draw/naoexiste/").status_code, 404)

    def test_not_enough_decks(self):
        res = self.post({"players": 3})  # só 2 ativos na fixture
        self.assertEqual(res.status_code, 400)
        self.assertIn("detail", res.json())

    def test_players_out_of_range(self):
        self.assertEqual(self.post({"players": 1}).status_code, 400)
        self.assertEqual(self.post({"players": 5}).status_code, 400)

    def test_filters(self):
        res = self.post({"players": 2, "filters": {"editions": ["40K", "who"], "year_from": 2022}})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["pool_size"], 2)
        res = self.post({"players": 2, "filters": {"year_to": 2010}})
        self.assertEqual(res.status_code, 400)

    def test_my_decks_include_inactive(self):
        slugs = list(Deck.objects.filter(edition__code="40K").values_list("slug", flat=True))
        res = self.post({"players": 2, "filters": {"deck_slugs": slugs}})
        self.assertEqual(res.status_code, 201)
        self.assertEqual({e["deck"]["slug"] for e in res.json()["entries"]}, set(slugs))

    def test_catalog_filter_by_slugs(self):
        slug = Deck.objects.first().slug
        self.assertEqual(self.client.get("/api/decks/", {"slugs": slug}).json()["count"], 1)
