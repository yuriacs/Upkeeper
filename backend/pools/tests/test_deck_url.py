import json

from django.test import SimpleTestCase

from pools.services.deck_url import DeckUrlError, fetch_deck
from pools.services.decklist import parse_decklist


def _card(name, qty=1, cats=(), set_code="cmr", number="1", deleted=False):
    return {
        "quantity": qty,
        "categories": list(cats),
        "deletedAt": "2024-01-01" if deleted else None,
        "card": {"oracleCard": {"name": name}, "edition": {"editioncode": set_code}, "collectorNumber": number},
    }


ARCHIDEKT = {
    "name": "Fungos",
    "categories": [
        {"name": "Commander", "includedInDeck": True},
        {"name": "Ramp", "includedInDeck": True},
        {"name": "Maybeboard", "includedInDeck": False},
        {"name": "Fora", "includedInDeck": False},
    ],
    "cards": [
        _card("Thelon of Havenwood", cats=["Commander"]),
        _card("Sol Ring", cats=["Ramp"], number="472"),
        _card("Forest", qty=30, cats=["Land"], set_code="", number=""),
        _card("Fire // Ice", cats=["Removal"]),
        _card("Lightning Bolt", cats=["Maybeboard"]),
        _card("Island", cats=["Fora"]),
        _card("Apagada", deleted=True),
    ],
}


class DeckUrlTests(SimpleTestCase):
    def fetch(self, url, body):
        calls = []

        def get(u, accept):
            calls.append(u)
            return body if isinstance(body, bytes) else json.dumps(body).encode()

        return fetch_deck(url, get=get), calls

    def test_archidekt(self):
        out, calls = self.fetch("https://archidekt.com/decks/123456/fungos?x=1", ARCHIDEKT)
        self.assertEqual(calls, ["https://archidekt.com/api/decks/123456/"])
        self.assertEqual(out["name"], "Fungos")
        self.assertEqual(out["warnings"], [])
        lines = parse_decklist(out["decklist"])
        self.assertEqual(
            [(l.quantity, l.name, l.is_commander) for l in lines],
            [(1, "Thelon of Havenwood", True), (1, "Sol Ring", False), (30, "Forest", False), (1, "Fire // Ice", False)],
        )
        self.assertEqual((lines[1].set_code, lines[1].collector_number), ("CMR", "472"))
        self.assertIn("Maybeboard\n1 Lightning Bolt (CMR) 1", out["decklist"])
        self.assertNotIn("Island", out["decklist"])
        self.assertNotIn("Apagada", out["decklist"])

    def test_archidekt_without_commander_warns(self):
        deck = {**ARCHIDEKT, "cards": ARCHIDEKT["cards"][1:3]}
        out, _ = self.fetch("archidekt.com/decks/9", deck)
        self.assertEqual(len(out["warnings"]), 1)

    def test_goldfish(self):
        out, calls = self.fetch("https://www.mtggoldfish.com/deck/6539015#paper", b"1 Sol Ring\n1 Island\n")
        self.assertEqual(calls, ["https://www.mtggoldfish.com/deck/download/6539015"])
        self.assertEqual(out["decklist"], "1 Sol Ring\n1 Island")

    def test_sites_that_block_and_unknown_links(self):
        for url in ("https://moxfield.com/decks/abc", "https://tappedout.net/mtg-decks/x/", "https://evil.example/decks/1"):
            with self.assertRaises(DeckUrlError):
                fetch_deck(url, get=lambda u, a: self.fail("não deveria buscar"))

    def test_only_built_urls_are_fetched(self):
        # Um host parecido não passa: o endereço buscado é sempre montado a partir do id
        with self.assertRaises(DeckUrlError):
            fetch_deck("https://archidekt.com.evil.example/decks/1", get=lambda u, a: self.fail("não deveria buscar"))
