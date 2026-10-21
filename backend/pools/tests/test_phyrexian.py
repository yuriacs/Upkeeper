from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase

from decks.models import Card
from decks.services import phyrexian
from pools.models import UserDeck, UserDeckCard

User = get_user_model()
JACE = "9a5d6f2d-5b2c-4b8f-8c64-5f0b3f1b6a11"


class PhyrexianPrintTests(TestCase):
    def setUp(self):
        self.ph = Card.objects.create(
            scryfall_id="00000000-0000-0000-0000-000000000325", name="Jace, the Perfected Mind", type_line="Legendary Planeswalker — Jace",
            oracle_id=JACE, set_code="ONE", collector_number="325", image_normal="https://cards.scryfall.io/ph.jpg",
        )
        ana = User.objects.create_user("ana", "", "x")
        self.deck = UserDeck.objects.create(
            owner=ana, name="Mill", decklist_text="1 Jace, the Perfected Mind (ONE) 325 [Wincon]\n1 Island (ONE) 325x",
        )
        UserDeckCard.objects.create(deck=self.deck, card=self.ph, quantity=1)

    def english(self):
        return {
            "id": "00000000-0000-0000-0000-000000000057", "name": "Jace, the Perfected Mind", "oracle_id": JACE,
            "set": "one", "collector_number": "57", "lang": "en", "type_line": "Legendary Planeswalker — Jace",
            "image_uris": {"normal": "https://cards.scryfall.io/en.jpg", "small": "https://cards.scryfall.io/en-s.jpg"},
        }

    def test_deck_moves_to_the_english_print(self):
        with mock.patch.object(phyrexian, "phyrexian_prints", return_value={("ONE", "325")}), \
                mock.patch.object(phyrexian, "_cheapest", return_value={JACE: self.english()}) as cheapest:
            self.assertEqual(phyrexian.replace_phyrexian_prints(log=lambda _: None), 1)
        self.assertEqual(cheapest.call_args.args[0], [JACE])
        row = UserDeckCard.objects.get(deck=self.deck)
        self.assertEqual((row.card.set_code, row.card.collector_number), ("ONE", "57"))
        self.assertEqual(row.card.image_normal, "https://cards.scryfall.io/en.jpg")
        self.deck.refresh_from_db()
        # Só a linha da carta muda na lista em texto
        self.assertEqual(self.deck.decklist_text, "1 Jace, the Perfected Mind (ONE) 57 [Wincon]\n1 Island (ONE) 325x")
        # Nada mais para trocar: não busca de novo
        with mock.patch.object(phyrexian, "phyrexian_prints", return_value={("ONE", "325")}), \
                mock.patch.object(phyrexian, "_cheapest") as cheapest:
            self.assertEqual(phyrexian.replace_phyrexian_prints(log=lambda _: None), 0)
        cheapest.assert_not_called()

    def test_merges_with_the_english_copy_already_in_the_deck(self):
        good = Card.objects.create(
            scryfall_id="00000000-0000-0000-0000-000000000057", name="Jace, the Perfected Mind", oracle_id=JACE,
            set_code="ONE", collector_number="57",
        )
        UserDeckCard.objects.create(deck=self.deck, card=good, quantity=1)
        with mock.patch.object(phyrexian, "phyrexian_prints", return_value={("ONE", "325")}), \
                mock.patch.object(phyrexian, "_cheapest", return_value={JACE: self.english()}):
            phyrexian.replace_phyrexian_prints(log=lambda _: None)
        rows = list(UserDeckCard.objects.filter(deck=self.deck))
        self.assertEqual([(r.card_id, r.quantity) for r in rows], [(good.id, 2)])
