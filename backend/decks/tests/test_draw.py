import random

from django.test import TestCase

from decks.models import Deck, Edition
from decks.services.draw import (
    COLORS_DISTINCT,
    COLORS_NO_OVERLAP,
    DrawError,
    create_draw,
    run_draw,
)


class DrawRulesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        a = Edition.objects.create(code="AAA", name="Coleção A")
        b = Edition.objects.create(code="BBB", name="Coleção B")
        decks = [
            ("Branco", "W", a), ("Branco 2", "W", a), ("Azul", "U", a), ("Preto", "B", a),
            ("Esper", "WUB", b), ("Gruul", "RG", b), ("Jund", "BRG", b),
        ]
        for i, (name, colors, edition) in enumerate(decks):
            Deck.objects.create(name=name, slug=f"d{i}", edition=edition, color_identity=colors)

    def test_distinct_identities(self):
        for seed in range(30):
            decks, _ = run_draw(4, {"color_rule": COLORS_DISTINCT}, random.Random(seed))
            identities = [d.color_identity for d in decks]
            self.assertEqual(len(set(identities)), 4)

    def test_no_overlap(self):
        for seed in range(30):
            decks, _ = run_draw(3, {"color_rule": COLORS_NO_OVERLAP}, random.Random(seed))
            used = "".join(d.color_identity for d in decks)
            self.assertEqual(len(used), len(set(used)), used)

    def test_no_overlap_impossible(self):
        # A única mesa possível de 4 sem cores em comum é W, U, B e RG
        decks, _ = run_draw(4, {"color_rule": COLORS_NO_OVERLAP}, random.Random(1))
        self.assertEqual(sorted(d.color_identity for d in decks)[0:1], ["B"])
        Deck.objects.filter(color_identity="RG").update(is_active=False)
        with self.assertRaises(DrawError):
            run_draw(4, {"color_rule": COLORS_NO_OVERLAP}, random.Random(1))

    def test_same_edition(self):
        for seed in range(20):
            decks, _ = run_draw(3, {"same_edition": True}, random.Random(seed))
            self.assertEqual(len({d.edition_id for d in decks}), 1)
        # Só a coleção A tem 4 decks
        decks, _ = run_draw(4, {"same_edition": True}, random.Random(0))
        self.assertEqual({d.edition.code for d in decks}, {"AAA"})
        with self.assertRaises(DrawError):
            run_draw(4, {"same_edition": True, "editions": ["BBB"]})

    def test_same_edition_and_distinct_colors(self):
        # Coleção A tem W, W, U, B: para 4 jogadores com cores diferentes não dá
        with self.assertRaises(DrawError):
            run_draw(4, {"same_edition": True, "color_rule": COLORS_DISTINCT}, random.Random(0))
        decks, _ = run_draw(3, {"same_edition": True, "color_rule": COLORS_DISTINCT}, random.Random(0))
        self.assertEqual(len({d.color_identity for d in decks}), 3)

    def test_create_draw_saves_entries_and_code(self):
        draw = create_draw(["Ana", "Beto", "Caio"], {})
        self.assertEqual(len(draw.code), 6)
        self.assertEqual(list(draw.entries.values_list("player_name", flat=True)), ["Ana", "Beto", "Caio"])

    def test_every_position_can_get_any_deck(self):
        # Sanidade contra viés: o primeiro jogador não fica sempre com o "primeiro" deck
        first = {run_draw(2, {"color_rule": COLORS_DISTINCT}, random.Random(s))[0][0].slug for s in range(60)}
        self.assertGreater(len(first), 3)
