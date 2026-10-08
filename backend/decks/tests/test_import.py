from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.db.models import Sum
from django.test import TestCase

from decks.models import Card, Deck, normalize_colors
from decks.services.mtgjson import categorize

FIXTURES = Path(__file__).parent / "fixtures" / "mtgjson"


def run_import(*args):
    out = StringIO()
    call_command("import_mtgjson", "--local-dir", str(FIXTURES), "--skip-editions", *args, stdout=out)
    return out.getvalue()


class HelpersTests(TestCase):
    def test_categorize_priority(self):
        self.assertEqual(categorize(["Artifact", "Creature"]), Card.Category.CREATURE)
        self.assertEqual(categorize(["Artifact", "Land"]), Card.Category.LAND)
        self.assertEqual(categorize(["Kindred", "Instant"]), Card.Category.INSTANT)
        self.assertEqual(categorize(["Conspiracy"]), Card.Category.OTHER)

    def test_normalize_colors(self):
        self.assertEqual(normalize_colors(["G", "W", "U"]), "WUG")
        self.assertEqual(normalize_colors([]), "")


class ImportTests(TestCase):
    def test_imports_only_commander_decks(self):
        run_import()
        self.assertEqual(Deck.objects.count(), 3)
        self.assertFalse(Deck.objects.filter(mtgjson_file="ArcanisSGuile_10E").exists())

    def test_every_deck_has_100_cards(self):
        run_import()
        for deck in Deck.objects.all():
            total = deck.deck_cards.aggregate(t=Sum("quantity"))["t"]
            self.assertEqual(total, 100, deck.name)

    def test_commander_and_colors(self):
        run_import()
        necron = Deck.objects.get(mtgjson_file="NecronDynasties_40K")
        self.assertEqual(necron.face_commander.name, "Szarekh, the Silent King")
        self.assertEqual(necron.color_identity, "B")
        self.assertEqual(necron.deck_cards.filter(is_commander=True).count(), 1)

    def test_partner_commanders(self):
        run_import()
        doctor = Deck.objects.get(mtgjson_file="BlastFromThePast_WHO")
        self.assertEqual(doctor.deck_cards.filter(is_commander=True).count(), 2)

    def test_collector_edition_is_inactive(self):
        run_import()
        self.assertFalse(Deck.objects.get(mtgjson_file="ForcesOfTheImperiumCollectorSEdition_40K").is_active)
        self.assertTrue(Deck.objects.get(mtgjson_file="NecronDynasties_40K").is_active)

    def test_cards_are_shared_between_decks(self):
        run_import()
        sol_rings = Card.objects.filter(name="Sol Ring")
        # Uma linha por impressão, reaproveitada por todos os decks que a usam
        self.assertEqual(sol_rings.count(), len({c.scryfall_id for c in sol_rings}))

    def test_import_is_idempotent(self):
        run_import()
        cards, decks = Card.objects.count(), Deck.objects.count()
        out = run_import()
        self.assertIn("3 já existiam", out)
        self.assertEqual((Card.objects.count(), Deck.objects.count()), (cards, decks))

    def test_update_keeps_manual_changes_to_is_active(self):
        run_import()
        Deck.objects.filter(mtgjson_file="NecronDynasties_40K").update(is_active=False)
        run_import("--update")
        self.assertFalse(Deck.objects.get(mtgjson_file="NecronDynasties_40K").is_active)
        self.assertEqual(Deck.objects.get(mtgjson_file="NecronDynasties_40K").deck_cards.aggregate(
            t=Sum("quantity"))["t"], 100)
