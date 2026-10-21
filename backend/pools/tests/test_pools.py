import random
import uuid
from io import StringIO
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase

from accounts.tests.browser import register
from decks.models import Card, Deck, Edition
from decks.services.draw import DrawError, run_pool_draw
from pools.models import OwnedPrecon, UserDeck
from pools.services.decklist import DecklistError
from pools.services.import_deck import save_user_deck

User = get_user_model()
FIXTURES = Path(__file__).resolve().parents[2] / "decks" / "tests" / "fixtures" / "mtgjson"


def fake_fetch(requests):
    """Simula o Scryfall: só conhece 'Carta Nova'."""
    found = {}
    for i, r in enumerate(requests):
        if r.get("name", "").casefold() == "carta nova":
            found[i] = Card.objects.create(
                scryfall_id=uuid.uuid4(), name="Carta Nova", type_line="Creature — Elf",
                category="creature", color_identity="G", image_normal="https://img/x.jpg",
            )
    return found


class ImportDeckTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("import_mtgjson", "--local-dir", str(FIXTURES), "--skip-editions", stdout=StringIO())
        Card.objects.update(image_normal="https://img/card.jpg")
        cls.user = User.objects.create_user("ana", "ana@example.com", "senha-forte-123")

    def test_import_uses_local_cards_and_scryfall(self):
        text = "Commander\n1 Szarekh, the Silent King\n\nDeck\n1 Sol Ring\n1 Carta Nova\n97 Swamp"
        deck, warnings = save_user_deck(self.user, "Necron caseiro", text, fetch=fake_fetch)
        self.assertEqual(deck.face_commander.name, "Szarekh, the Silent King")
        self.assertEqual(deck.color_identity, "B")
        self.assertEqual(sum(dc.quantity for dc in deck.deck_cards.all()), 100)
        self.assertEqual(warnings, [])

    def test_saving_again_only_touches_what_changed(self):
        text = "Commander\n1 Szarekh, the Silent King\n\nDeck\n1 Sol Ring\n97 Swamp"
        deck, _ = save_user_deck(self.user, "Necron", text, fetch=fake_fetch)
        self.assertTrue(deck.cards_changed)
        deck.bracket, deck.bracket_details = 3, {"game_changers": ["X"]}
        deck.save()
        rows = {r.card.name: r.pk for r in deck.deck_cards.select_related("card")}

        # Só o nome (ou as categorias) mudou: as cartas e o bracket ficam
        deck, _ = save_user_deck(self.user, "Necron novo", text + " [Lands]", deck=deck, fetch=fake_fetch)
        self.assertFalse(deck.cards_changed)
        self.assertEqual(deck.added_cards, set())
        self.assertEqual(UserDeck.objects.get(pk=deck.pk).bracket, 3)

        # Entra uma carta e a quantidade de outra muda: as outras linhas continuam as mesmas
        text2 = "Commander\n1 Szarekh, the Silent King\n\nDeck\n1 Sol Ring\n1 Carta Nova\n96 Swamp"
        deck, _ = save_user_deck(self.user, "Necron novo", text2, deck=deck, fetch=fake_fetch)
        self.assertTrue(deck.cards_changed)
        self.assertEqual([Card.objects.get(pk=i).name for i in deck.added_cards], ["Carta Nova"])
        after = {r.card.name: (r.pk, r.quantity) for r in deck.deck_cards.select_related("card")}
        self.assertEqual(after["Sol Ring"][0], rows["Sol Ring"])
        self.assertEqual(after["Swamp"], (rows["Swamp"], 96))
        self.assertIsNone(UserDeck.objects.get(pk=deck.pk).bracket)  # cartas mudaram: recalcula

    def test_finding_cards_takes_few_queries(self):
        from pools.services.decklist import parse_decklist
        from pools.services.import_deck import _find_local

        names = list(Card.objects.exclude(image_normal="").values_list("name", flat=True).distinct()[:60])
        lines = parse_decklist("\n".join(f"1 {n}" for n in names) + "\n1 Sol Ring (ZZZ) 999")
        # Impressões pedidas e nomes exatos (a das cartas de duas faces só se faltar alguma)
        with self.assertNumQueries(2):
            found = _find_local(lines)
        self.assertEqual(len(found), len(names))

    def test_commander_from_field(self):
        deck, warnings = save_user_deck(
            self.user, "X", "1 Szarekh, the Silent King\n1 Sol Ring", commanders=["szarekh, the silent king"],
            fetch=fake_fetch,
        )
        self.assertEqual(deck.deck_cards.filter(is_commander=True).count(), 1)
        self.assertTrue(warnings)  # só 2 cartas

    def test_commander_field_accepts_quantity_prefix(self):
        deck, _ = save_user_deck(
            self.user, "X", "1 Sol Ring\n1 Szarekh, the Silent King", commanders=["1 Szarekh, the Silent King"],
            fetch=fake_fetch,
        )
        self.assertEqual(deck.face_commander.name, "Szarekh, the Silent King")
        self.assertEqual(deck.deck_cards.filter(is_commander=True).count(), 1)

    def test_sideboard_category_stays_out(self):
        text = "1x Szarekh, the Silent King [Commander{top}]\n1x Sol Ring [Ramp]\n1x Carta Nova [Sideboard]"
        deck, _ = save_user_deck(self.user, "X", text, fetch=fake_fetch)
        self.assertEqual(sorted(dc.card.name for dc in deck.deck_cards.all()), ["Sol Ring", "Szarekh, the Silent King"])

    def test_migration_drops_saved_sideboard(self):
        import importlib

        from django.apps import apps

        text = "1x Szarekh, the Silent King [Commander{top}]\n1x Sol Ring [Ramp]\n1x Carta Nova [Ramp]"
        deck, _ = save_user_deck(self.user, "X", text, fetch=fake_fetch)
        # como ficava antes: a lista diz Sideboard, mas a carta entrou no deck
        deck.decklist_text = text.replace("Carta Nova [Ramp]", "Carta Nova [Sideboard]")
        deck.save()
        importlib.import_module("pools.migrations.0004_drop_sideboard_cards").drop_sideboard(apps, None)
        self.assertEqual(sorted(dc.card.name for dc in deck.deck_cards.all()), ["Sol Ring", "Szarekh, the Silent King"])

    def test_unknown_cards(self):
        with self.assertRaises(DecklistError) as ctx:
            save_user_deck(self.user, "X", "Commander\n1 Szarekh, the Silent King\nDeck\n1 Carta Inventada",
                           fetch=fake_fetch)
        self.assertIn("Carta Inventada", ctx.exception.details[0])


class PoolDrawTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        ed = Edition.objects.create(code="AAA", name="A")
        cls.users = [User.objects.create_user(n, f"{n}@example.com", "senha-forte-123") for n in ["ana", "beto", "caio"]]
        cls.decks = {}
        for i, (owner, colors) in enumerate([(0, "W"), (0, "U"), (1, "B"), (1, "R"), (2, "G")]):
            d = Deck.objects.create(name=f"D{i}", slug=f"d{i}", edition=ed, color_identity=colors)
            OwnedPrecon.objects.create(user=cls.users[owner], deck=d)

    def test_nobody_gets_own_deck(self):
        for seed in range(40):
            items, _ = run_pool_draw(self.users, {}, random.Random(seed))
            for player, item in zip(self.users, items):
                self.assertNotEqual(player.pk, item.owner.pk)
            self.assertEqual(len({i.key for i in items}), 3)

    def test_same_precon_owned_by_two_people_goes_to_one_player(self):
        shared = Deck.objects.get(slug="d4")
        OwnedPrecon.objects.create(user=self.users[0], deck=shared)
        for seed in range(40):
            items, _ = run_pool_draw(self.users[:2], {}, random.Random(seed))
            self.assertEqual(len({i.key for i in items}), 2)

    def test_impossible(self):
        OwnedPrecon.objects.filter(user=self.users[1]).delete()
        OwnedPrecon.objects.filter(user=self.users[2]).delete()
        with self.assertRaises(DrawError):
            run_pool_draw(self.users[:2], {}, random.Random(0))

    def test_user_decks_join_the_pool(self):
        OwnedPrecon.objects.filter(user=self.users[0]).delete()
        UserDeck.objects.create(owner=self.users[0], name="Caseiro", color_identity="WU")
        items, size = run_pool_draw(self.users[:2], {}, random.Random(3))
        self.assertEqual(size, 3)
        self.assertEqual(items[1].user_deck.name, "Caseiro")  # beto recebe o deck da ana


class PoolApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        ed = Edition.objects.create(code="AAA", name="A")
        for i, colors in enumerate("WUBR"):
            Deck.objects.create(name=f"D{i}", slug=f"d{i}", edition=ed, color_identity=colors)

    def setUp(self):
        cache.clear()

    def signup(self, name):
        res = register(self.client, name, f"{name}@example.com", "senha-forte-123")
        return res.json()["token"]

    def auth(self, token):
        return {"HTTP_AUTHORIZATION": f"Token {token}"}

    def test_my_precons_sync_and_toggle(self):
        t = self.signup("ana")
        res = self.client.post("/api/me/precons/", {"slugs": ["d0", "d1", "nao-existe"]},
                               content_type="application/json", **self.auth(t))
        self.assertEqual(sorted(res.json()["slugs"]), ["d0", "d1"])
        res = self.client.delete("/api/me/precons/d0/", **self.auth(t))
        self.assertEqual(res.json()["slugs"], ["d1"])
        self.assertEqual(self.client.put("/api/me/precons/d2/", **self.auth(t)).status_code, 200)
        self.assertEqual(self.client.get("/api/me/precons/").status_code, 401)

    def test_pool_draw_only_in_rooms(self):
        ta = self.signup("ana")
        res = self.client.post("/api/draw/", {"mode": "pool", "names": ["ana", "beto"]},
                               content_type="application/json", **self.auth(ta))
        self.assertEqual(res.status_code, 400)
        self.assertIn("rooms", res.json()["detail"])

    def test_user_deck_crud_and_public_view(self):
        ta = self.signup("ana")
        Card.objects.create(scryfall_id=uuid.uuid4(), name="Chefe", category="creature", color_identity="R",
                            image_normal="https://img/c.jpg")
        Card.objects.create(scryfall_id=uuid.uuid4(), name="Mountain", category="land", image_normal="https://img/m.jpg")
        body = {"name": "Meu deck", "decklist": "Commander\n1 Chefe\nDeck\n99 Mountain"}
        res = self.client.post("/api/me/decks/", body, content_type="application/json", **self.auth(ta))
        self.assertEqual(res.status_code, 201, res.json())
        pk = res.json()["slug"]
        self.assertEqual(res.json()["card_count"], 100)
        self.assertEqual(res.json()["warnings"], [])
        self.assertEqual(len(self.client.get("/api/me/decks/", **self.auth(ta)).json()), 1)
        public = self.client.get(f"/api/user-decks/{pk}/").json()
        self.assertEqual(public["owner"], "ana")
        self.assertNotIn("decklist_text", public)
        tb = self.signup("beto")
        self.assertEqual(self.client.delete(f"/api/me/decks/{pk}/", **self.auth(tb)).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/me/decks/{pk}/", **self.auth(ta)).status_code, 204)
