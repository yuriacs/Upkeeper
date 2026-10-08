from django.test import TestCase

from decks.models import Card
from decks.services.scryfall import apply_scryfall_data


class ApplyScryfallDataTests(TestCase):
    def make_card(self):
        return Card.objects.create(
            scryfall_id="12a3400d-7a8b-4bae-9a4f-c9a1bc741e68", name="X", oracle_text="frente"
        )

    def test_single_faced(self):
        card = self.make_card()
        apply_scryfall_data(card, {"image_uris": {"normal": "n.jpg", "small": "s.jpg", "art_crop": "a.jpg"},
                                   "oracle_text": "texto", "type_line": "Creature"})
        self.assertEqual((card.image_normal, card.image_back), ("n.jpg", ""))
        self.assertIsNotNone(card.scryfall_synced_at)

    def test_double_faced(self):
        card = self.make_card()
        apply_scryfall_data(card, {"card_faces": [
            {"image_uris": {"normal": "f.jpg"}, "oracle_text": "A"},
            {"image_uris": {"normal": "b.jpg"}, "oracle_text": "B"},
        ]})
        self.assertEqual((card.image_normal, card.image_back), ("f.jpg", "b.jpg"))
        self.assertEqual(card.oracle_text, "A\n//\nB")
