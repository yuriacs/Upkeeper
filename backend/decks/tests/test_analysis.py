import random
import uuid
from unittest import mock

from django.core.management import call_command
from django.test import TestCase

from decks.models import Card, Deck, DeckCard, Edition, OracleTag, TagSync
from decks.services.analysis import analyze, label_for, refresh_power
from decks.services.draw import create_draw


def make_card(name, category="creature", cmc=3, tags=()):
    oid = uuid.uuid4()
    card = Card.objects.create(scryfall_id=uuid.uuid4(), oracle_id=oid, name=name, category=category, cmc=cmc)
    OracleTag.objects.bulk_create([OracleTag(oracle_id=oid, tag=t) for t in tags])
    return card


class AnalysisTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.ed = Edition.objects.create(code="AAA", name="A")
        cls.deck = Deck.objects.create(name="Teste", slug="teste", edition=cls.ed)
        add = lambda card, q=1, cmd=False: DeckCard.objects.create(  # noqa: E731
            deck=cls.deck, card=card, quantity=q, is_commander=cmd
        )
        add(make_card("Chefe", cmc=4), cmd=True)
        add(make_card("Sol Ring", "artifact", 1, ["ramp"]))
        add(make_card("Demonic Tutor", "sorcery", 2, ["tutor"]))
        add(make_card("Wrath of God", "sorcery", 4, ["removal", "board_wipe"]))
        add(make_card("Swords to Plowshares", "instant", 1, ["removal"]))
        add(make_card("Rhystic Study", "enchantment", 3, ["draw"]))
        add(make_card("Ancient Tomb", "land", 0, ["ramp"]))
        add(make_card("Bosque", "land", 0), q=30)

    def test_categories_and_counts(self):
        a = analyze(self.deck.deck_cards.select_related("card"), 2)
        cats = {k: v["count"] for k, v in a["categories"].items()}
        self.assertEqual(cats["fast_mana"], 2)  # Sol Ring + Ancient Tomb (terreno conta só como mana rápida)
        self.assertEqual(cats["ramp"], 1)  # Ancient Tomb não conta como ramp
        self.assertEqual(cats["tutor"], 1)
        self.assertEqual(cats["board_wipe"], 1)
        self.assertEqual(cats["removal"], 1)  # o Wrath conta só como board wipe
        self.assertEqual(a["categories"]["removal"]["cards"], ["Swords to Plowshares"])
        self.assertEqual(a["lands"], 31)
        self.assertEqual(a["avg_cmc"], round((4 + 1 + 2 + 4 + 1 + 3) / 6, 2))
        self.assertEqual({f["key"] for f in a["factors"]}, {"speed", "ramp", "draw", "tutor", "interaction", "protection", "combos"})

    def test_power_scale_and_bracket_bonus(self):
        rows = list(self.deck.deck_cards.select_related("card"))
        b2, b3, b4 = (analyze(rows, b)["power"] for b in (2, 3, 4))
        self.assertTrue(1.5 <= b2 < b3 < b4 <= 10)
        # Bracket 4 só por uma carta de destruição de terrenos: bônus do 3
        single = analyze(rows, 4, {"single_trigger": "Ruination"})["power"]
        self.assertEqual(single, b3)
        self.assertEqual(label_for(3.0), "Casual")
        self.assertEqual(label_for(9.5), "Competitivo")

    def test_refresh_power_and_detail_api(self):
        refresh_power(self.deck)
        self.assertIsNotNone(Deck.objects.get(pk=self.deck.pk).power)
        data = self.client.get("/api/decks/teste/").json()
        self.assertEqual(data["analysis"]["categories"]["tutor"]["cards"], ["Demonic Tutor"])
        self.assertEqual(data["power"], data["analysis"]["power"])

    def test_catalog_sort_and_filter_by_power(self):
        Deck.objects.create(name="Fraco", slug="fraco", edition=self.ed, power=2.5)
        Deck.objects.create(name="Forte", slug="forte", edition=self.ed, power=6.0)
        slugs = lambda q: [d["slug"] for d in self.client.get(f"/api/decks/?{q}").json()["results"]]  # noqa: E731
        self.assertEqual(slugs("ordering=-power&power_min=1"), ["forte", "fraco"])
        self.assertEqual(slugs("power_min=4"), ["forte"])
        self.assertEqual(slugs("power_max=4"), ["fraco"])

    def test_balanced_table_uses_power(self):
        for i, p in enumerate([2.0, 2.5, 3.0, 7.0, 7.5]):
            Deck.objects.create(name=f"P{i}", slug=f"p{i}", edition=self.ed, power=p, bracket=2)
        Deck.objects.filter(slug="teste").update(is_active=False)
        for seed in range(15):
            draw = create_draw(["A", "B", "C"], {"bracket_balance": True}, random.Random(seed))
            powers = [e.deck.power for e in draw.entries.all()]
            self.assertLessEqual(max(powers) - min(powers), 1.5)


class SyncTagsTests(TestCase):
    def test_sync_pages_and_recompute(self):
        oid1, oid2 = str(uuid.uuid4()), str(uuid.uuid4())
        pages = {
            "1": {"data": [{"oracle_id": oid1}], "has_more": True, "next_page": "https://x/page2"},
            "2": {"data": [{"card_faces": [{"oracle_id": oid2}]}], "has_more": False},
        }

        def fake(url, timeout=60):
            return pages["2"] if url.endswith("page2") else pages["1"]

        with mock.patch("decks.management.commands.sync_card_tags.fetch_json", side_effect=fake), \
                mock.patch("decks.management.commands.sync_card_tags.call_command") as recompute:
            call_command("sync_card_tags", "--pause", "0", stdout=mock.MagicMock())
        self.assertEqual(OracleTag.objects.filter(tag="tutor").count(), 2)
        self.assertEqual(TagSync.objects.get(tag="tutor").cards, 2)
        recompute.assert_called_once()
        # Recém-baixado: com --older-than nada é baixado de novo
        with mock.patch("decks.management.commands.sync_card_tags.fetch_json") as again:
            call_command("sync_card_tags", "--older-than", "30", stdout=mock.MagicMock())
        again.assert_not_called()


class DisplayNameTests(TestCase):
    def test_same_name_on_both_faces(self):
        from decks.services.analysis import display_name

        self.assertEqual(display_name("Okaun, Eye of Chaos // Okaun, Eye of Chaos"), "Okaun, Eye of Chaos")
        self.assertEqual(display_name("Fire // Ice"), "Fire // Ice")
