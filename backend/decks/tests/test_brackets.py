import random
import urllib.error
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings

from decks.models import Card, Deck, DeckCard, Edition
from decks.services.brackets import classify, refresh_bracket
from decks.services.draw import DrawError, create_draw


def card(name, **flags):
    return {"card": {"name": name}, "quantity": 1, "gameChanger": False, "massLandDenial": False,
            "extraTurn": False, "banned": False, **flags}


def combo(a, b, two=True, **flags):
    return {"definitelyTwoCard": two, "extraTurn": False, **flags,
            "combo": {"uses": [{"card": {"name": a}}, {"card": {"name": b}}]}}


class ClassifyTests(TestCase):
    def test_plain_deck_is_bracket_2(self):
        bracket, details = classify({"cards": [card("Sol Ring"), card("Llanowar Elves")], "combos": []})
        self.assertEqual(bracket, 2)
        self.assertEqual(details["game_changers"], [])

    def test_game_changers_and_combos_go_to_3(self):
        b, d = classify({"cards": [card("Rhystic Study", gameChanger=True)], "combos": []})
        self.assertEqual((b, d["game_changers"]), (3, ["Rhystic Study"]))
        b, d = classify({"cards": [], "combos": [combo("Thassa's Oracle", "Demonic Consultation")]})
        self.assertEqual((b, d["two_card_combos"]), (3, [["Demonic Consultation", "Thassa's Oracle"]]))
        # Combos de 3+ peças não contam como "2 cartas"
        b, _ = classify({"cards": [], "combos": [combo("A", "B", two=False)]})
        self.assertEqual(b, 2)

    def test_bracket_4_triggers(self):
        gcs = [card(f"GC{i}", gameChanger=True) for i in range(4)]
        self.assertEqual(classify({"cards": gcs, "combos": []})[0], 4)
        self.assertEqual(classify({"cards": gcs[:3], "combos": []})[0], 3)
        self.assertEqual(classify({"cards": [card("Armageddon", massLandDenial=True)], "combos": []})[0], 4)
        turns = [card(f"T{i}", extraTurn=True) for i in range(3)]
        self.assertEqual(classify({"cards": turns[:2], "combos": []})[0], 2)
        self.assertEqual(classify({"cards": turns, "combos": []})[0], 4)
        self.assertEqual(classify({"cards": [], "combos": [combo("A", "B", extraTurn=True)]})[0], 4)


class RefreshAndDrawTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        ed = Edition.objects.create(code="AAA", name="A")
        cls.cmd = Card.objects.create(scryfall_id="00000000-0000-0000-0000-000000000001", name="Cmd // Back")
        cls.gc = Card.objects.create(scryfall_id="00000000-0000-0000-0000-000000000002", name="Rhystic Study")
        cls.decks = []
        for i, colors in enumerate("WUBRG"):
            d = Deck.objects.create(name=f"D{i}", slug=f"d{i}", edition=ed, color_identity=colors)
            DeckCard.objects.create(deck=d, card=cls.cmd, is_commander=True)
            DeckCard.objects.create(deck=d, card=cls.gc, quantity=1)
            cls.decks.append(d)

    def test_refresh_saves_bracket_and_sends_front_face_names(self):
        sent = {}

        def fake(commanders, main):
            sent.update(commanders=commanders, main=main)
            return {"cards": [card("Rhystic Study", gameChanger=True)], "combos": []}

        self.assertTrue(refresh_bracket(self.decks[0], fetch=fake))
        deck = Deck.objects.get(pk=self.decks[0].pk)
        self.assertEqual(deck.bracket, 3)
        self.assertEqual(deck.bracket_details["game_changers"], ["Rhystic Study"])
        self.assertIsNotNone(deck.bracket_checked_at)
        self.assertEqual(sent["commanders"], ["Cmd // Back"])  # nome inteiro: só a frente o Spellbook não acha
        self.assertEqual(sent["main"], [("Rhystic Study", 1)])

    def test_refresh_failure_keeps_deck_untouched(self):
        def down(*_):
            raise urllib.error.URLError("fora do ar")

        self.assertFalse(refresh_bracket(self.decks[1], fetch=down))
        self.assertIsNone(Deck.objects.get(pk=self.decks[1].pk).bracket)

    def test_disabled_in_tests_without_explicit_fetch(self):
        self.assertFalse(refresh_bracket(self.decks[2]))

    def test_catalog_filter_and_serializers(self):
        Deck.objects.filter(pk__in=[self.decks[0].pk, self.decks[1].pk]).update(bracket=2)
        Deck.objects.filter(pk=self.decks[2].pk).update(bracket=4, bracket_details={"mass_land_denial": ["Armageddon"]})
        slugs = lambda q: sorted(d["slug"] for d in self.client.get(f"/api/decks/?bracket={q}").json()["results"])  # noqa: E731
        self.assertEqual(slugs("2"), ["d0", "d1"])
        self.assertEqual(slugs("4"), ["d2"])
        detail = self.client.get("/api/decks/d2/").json()
        self.assertEqual((detail["bracket"], detail["bracket_details"]["mass_land_denial"]), (4, ["Armageddon"]))

    def test_draw_max_bracket_and_balance(self):
        brackets = [2, 2, 3, 4, None]
        for d, b in zip(self.decks, brackets):
            Deck.objects.filter(pk=d.pk).update(bracket=b)
        for seed in range(20):
            draw = create_draw(["A", "B", "C"], {"max_bracket": 3}, random.Random(seed))
            self.assertNotIn("d3", [e.deck.slug for e in draw.entries.all()])  # o bracket 4 nunca entra
        for seed in range(20):
            draw = create_draw(["A", "B", "C"], {"bracket_balance": True}, random.Random(seed))
            got = [b for b in (e.deck.bracket for e in draw.entries.all()) if b is not None]
            self.assertLessEqual(max(got) - min(got), 1)
        # 4 jogadores com até bracket 2: só há d0, d1 e o sem bracket → não fecha
        with self.assertRaises(DrawError):
            create_draw(["A", "B", "C", "D"], {"max_bracket": 2}, random.Random(1))

    def test_command_computes_missing_and_tolerates_outage(self):
        fake = lambda *_: {"cards": [], "combos": []}  # noqa: E731
        with override_settings(BRACKETS_ENABLED=True), \
                mock.patch("decks.services.brackets.spellbook_estimate", side_effect=fake):
            call_command("estimate_brackets", "--pause", "0", stdout=mock.MagicMock())
        self.assertEqual(set(Deck.objects.values_list("bracket", flat=True)), {2})

        def down(*_):
            raise urllib.error.URLError("x")

        Deck.objects.update(bracket=None)
        with override_settings(BRACKETS_ENABLED=True), \
                mock.patch("decks.services.brackets.spellbook_estimate", side_effect=down):
            call_command("estimate_brackets", "--pause", "0", stdout=mock.MagicMock())  # não levanta
        self.assertEqual(set(Deck.objects.values_list("bracket", flat=True)), {None})


class SingleTriggerTests(TestCase):
    def test_single_land_denial_card_is_flagged(self):
        b, d = classify({"cards": [card("Ruination", massLandDenial=True)], "combos": []})
        self.assertEqual((b, d["single_trigger"]), (4, "Ruination"))
        gcs = [card(f"GC{i}", gameChanger=True) for i in range(4)]
        b, d = classify({"cards": [card("Ruination", massLandDenial=True), *gcs], "combos": []})
        self.assertEqual((b, d["single_trigger"]), (4, None))


class TwoFacesRecalcTests(TestCase):
    """Decks com carta de duas faces são recalculados uma vez (antes elas não eram reconhecidas)."""

    def test_once_for_decks_with_two_faced_cards(self):
        from io import StringIO

        from django.utils import timezone

        from decks.models import TagSync

        ed = Edition.objects.create(code="BBB", name="B")
        dfc = Card.objects.create(scryfall_id="00000000-0000-0000-0000-000000000011", name="Tergrid, God of Fright // Tergrid's Lantern")
        plain = Card.objects.create(scryfall_id="00000000-0000-0000-0000-000000000012", name="Sol Ring")
        with_dfc = Deck.objects.create(name="Com", slug="com", edition=ed, bracket=2, bracket_checked_at=timezone.now())
        without = Deck.objects.create(name="Sem", slug="sem", edition=ed, bracket=2, bracket_checked_at=timezone.now())
        DeckCard.objects.create(deck=with_dfc, card=dfc, is_commander=True)
        DeckCard.objects.create(deck=with_dfc, card=plain)
        DeckCard.objects.create(deck=without, card=plain)

        with mock.patch("decks.management.commands.estimate_brackets.refresh_bracket", return_value=True) as refresh:
            call_command("estimate_brackets", pause=0, stdout=StringIO())
            self.assertEqual([c.args[0].pk for c in refresh.call_args_list], [with_dfc.pk])
            self.assertTrue(TagSync.objects.filter(tag="~brackets:full-names").exists())
            refresh.reset_mock()
            call_command("estimate_brackets", pause=0, stdout=StringIO())
            refresh.assert_not_called()
