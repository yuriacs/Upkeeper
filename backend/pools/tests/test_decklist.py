from django.test import SimpleTestCase

from pools.services.decklist import DecklistError, parse_decklist


class ParseDecklistTests(SimpleTestCase):
    def test_moxfield_arena_format(self):
        lines = parse_decklist("Commander\n1 Jace, Multiverse Architect (FRC) 1\n\nDeck\n1 Sol Ring (FRC) 52\n4 Plains")
        self.assertEqual([(l.quantity, l.name, l.is_commander) for l in lines], [
            (1, "Jace, Multiverse Architect", True), (1, "Sol Ring", False), (4, "Plains", False),
        ])
        self.assertEqual((lines[1].set_code, lines[1].collector_number), ("FRC", "52"))

    def test_archidekt_format(self):
        lines = parse_decklist("1x Atraxa, Praetors' Voice (c16) 28 [Commander{top}]\n1x Sol Ring (c16) 272 [Ramp]")
        self.assertTrue(lines[0].is_commander)
        self.assertFalse(lines[1].is_commander)
        self.assertEqual(lines[0].set_code, "c16")

    def test_plain_and_comments(self):
        lines = parse_decklist("// meu deck\nSol Ring\n2x Island\n\nSideboard\n1 Lightning Bolt")
        self.assertEqual([(l.quantity, l.name) for l in lines], [(1, "Sol Ring"), (2, "Island")])

    def test_split_and_flags(self):
        lines = parse_decklist("1 Fire // Ice (MH2) 290 *F*\n1 Kenrith, the Returned King *CMDR*")
        self.assertEqual(lines[0].name, "Fire // Ice")
        self.assertTrue(lines[1].is_commander)

    def test_moxfield_plain_export_single_commander(self):
        lines = parse_decklist("1 Trostani, Selesnya's Voice\n\n1 Blossoming Sands\n7 Forest")
        self.assertEqual([l.is_commander for l in lines], [True, False, False])

    def test_moxfield_plain_export_partners(self):
        text = "1 Okaun, Eye of Chaos\n1 Zndrsplt, Eye of Wisdom\n\n1 Cascade Bluffs\n9 Island\n1 Sol Ring"
        lines = parse_decklist(text)
        self.assertEqual([l.name for l in lines if l.is_commander], ["Okaun, Eye of Chaos", "Zndrsplt, Eye of Wisdom"])

    def test_no_blank_line_first_card_is_commander(self):
        lines = parse_decklist("1 Kenrith, the Returned King\n1 Sol Ring\n1 Arcane Signet")
        self.assertEqual([l.is_commander for l in lines], [True, False, False])

    def test_explicit_section_wins(self):
        lines = parse_decklist("1 Sol Ring\n\nCommander\n1 Kenrith, the Returned King")
        self.assertEqual([l.name for l in lines if l.is_commander], ["Kenrith, the Returned King"])

    def test_sideboard_markers_are_left_out(self):
        text = (
            "1x Atraxa, Praetors' Voice (c16) 28 [Commander{top}]\n"
            "1x Sol Ring (c16) 272 [Ramp]\n"
            "1x Lightning Bolt (m10) 146 [Sideboard]\n"
            "1x Counterspell (mh2) 267 [Maybeboard{noDeck}{noPrice}]\n"
            "1x Swords to Plowshares (c16) 1 [Removal{noDeck}]\n"
            "SB: 1 Duress\n"
        )
        self.assertEqual([l.name for l in parse_decklist(text)], ["Atraxa, Praetors' Voice", "Sol Ring"])

    def test_comment_section_header(self):
        lines = parse_decklist("//Commander\n1 Kenrith, the Returned King\n//Main\n1 Sol Ring\n//Sideboard\n1 Duress")
        self.assertEqual([(l.name, l.is_commander) for l in lines], [("Kenrith, the Returned King", True), ("Sol Ring", False)])

    def test_trailing_block_past_100_is_sideboard(self):
        text = "1 Kenrith, the Returned King\n\n1 Sol Ring\n98 Island\n\n1 Duress\n2 Negate"
        lines = parse_decklist(text)
        self.assertEqual(sum(l.quantity for l in lines), 100)
        self.assertNotIn("Duress", [l.name for l in lines])
        # sem passar de 100, o último bloco continua no deck
        lines = parse_decklist("1 Kenrith, the Returned King\n\n1 Sol Ring\n90 Island\n\n1 Duress")
        self.assertIn("Duress", [l.name for l in lines])

    def test_errors(self):
        with self.assertRaises(DecklistError):
            parse_decklist("   \n// nada")
