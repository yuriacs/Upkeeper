import io

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image
from rest_framework.authtoken.models import Token

from decks.models import Card
from pools.models import CardArt, UserDeck, UserDeckCard
from pools.services import card_art

User = get_user_model()
SOL = "6ad8011d-3471-4369-9d68-b264cc027487"


def png(w=900, h=1200, exif=False):
    img = Image.new("RGB", (w, h), (200, 30, 30))
    out = io.BytesIO()
    if exif:
        e = Image.Exif()
        e[0x010F] = "Camera secreta"  # Make
        img.save(out, "JPEG", exif=e)
        return SimpleUploadedFile("foto.jpg", out.getvalue(), content_type="image/jpeg")
    img.save(out, "PNG")
    return SimpleUploadedFile("arte.png", out.getvalue(), content_type="image/png")


class CardArtTests(TestCase):
    def setUp(self):
        self.ana = User.objects.create_user("ana", "", "x")
        self.beto = User.objects.create_user("beto", "", "x")
        self.auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.ana).key}"}
        self.beto_auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.beto).key}"}
        card = Card.objects.create(scryfall_id="00000000-0000-0000-0000-000000000077", name="Sol Ring",
                                   type_line="Artifact", oracle_id=SOL, image_normal="https://cards.scryfall.io/sol.jpg")
        self.deck = UserDeck.objects.create(owner=self.ana, name="Deck da Ana")
        UserDeckCard.objects.create(deck=self.deck, card=card, quantity=1)

    def upload(self, f, auth=None, oracle_id=SOL):
        return self.client.post("/api/me/card-arts/", {"file": f, "oracle_id": oracle_id}, **(auth or self.auth))

    def test_upload_is_cleaned_and_served(self):
        res = self.upload(png(exif=True))
        self.assertEqual(res.status_code, 201)
        art = CardArt.objects.get()
        self.assertEqual((art.width, art.height), (card_art.WIDTH, card_art.HEIGHT))  # recortada na proporção
        with Image.open(io.BytesIO(bytes(art.image))) as img:
            self.assertEqual(img.format, "WEBP")
            self.assertFalse(img.getexif())  # sem metadados da foto
        image = self.client.get(f"/api/card-art/{art.key}/")
        self.assertEqual((image.status_code, image["Content-Type"]), (200, "image/webp"))
        self.assertIn("immutable", image["Cache-Control"])

    def test_not_an_image(self):
        fake = SimpleUploadedFile("x.png", b"<script>alert(1)</script>", content_type="image/png")
        self.assertEqual(self.upload(fake).json()["code"], "not_image")

    def test_assign_to_deck_card_and_table(self):
        from asgiref.sync import async_to_sync

        from tables import store

        key = self.upload(png()).json()["id"]
        res = self.client.put(f"/api/me/decks/{self.deck.pk}/arts/", {"oracle_id": SOL, "art": key},
                              content_type="application/json", **self.auth)
        self.assertEqual(list(res.json()["arts"]), [SOL])
        detail = self.client.get(f"/api/user-decks/{self.deck.pk}/").json()
        self.assertIn(key, detail["arts"][SOL])
        _, rows = async_to_sync(store.deck_cards)("user", str(self.deck.pk))
        self.assertIn(key, rows[0]["image"])  # na mesa, a carta vem com a arte
        # Outra pessoa não mexe no deck dela
        other = self.client.put(f"/api/me/decks/{self.deck.pk}/arts/", {"oracle_id": SOL, "art": key},
                                content_type="application/json", **self.beto_auth)
        self.assertEqual(other.status_code, 404)
        # ...mas usa a arte da Ana no Sol Ring do deck dele (a arte é da carta)
        deck_beto = UserDeck.objects.create(owner=self.beto, name="Deck do Beto")
        res = self.client.put(f"/api/me/decks/{deck_beto.pk}/arts/", {"oracle_id": SOL, "art": key},
                              content_type="application/json", **self.beto_auth)
        self.assertIn(key, res.json()["arts"][SOL])
        # Não em outra carta
        res = self.client.put(f"/api/me/decks/{deck_beto.pk}/arts/",
                              {"oracle_id": "d0d33d52-3d28-4635-b985-51e126289259", "art": key},
                              content_type="application/json", **self.beto_auth)
        self.assertEqual(res.status_code, 404)
        # Tirar a arte
        res = self.client.put(f"/api/me/decks/{self.deck.pk}/arts/", {"oracle_id": SOL, "art": None},
                              content_type="application/json", **self.auth)
        self.assertEqual(res.json()["arts"], {})

    def test_commander_art_at_the_table(self):
        from asgiref.sync import async_to_sync

        from tables import store

        atraxa = "d0d33d52-3d28-4635-b985-51e126289259"
        cmd = Card.objects.create(scryfall_id="00000000-0000-0000-0000-000000000078", name="Atraxa, Praetors' Voice",
                                  type_line="Legendary Creature — Phyrexian Angel Horror", oracle_id=atraxa,
                                  image_normal="https://cards.scryfall.io/atraxa.jpg")
        UserDeckCard.objects.create(deck=self.deck, card=cmd, quantity=1, is_commander=True)
        key = self.upload(png(), oracle_id=atraxa).json()["id"]
        self.client.put(f"/api/me/decks/{self.deck.pk}/arts/", {"oracle_id": atraxa, "art": key},
                        content_type="application/json", **self.auth)
        _, rows = async_to_sync(store.deck_cards)("user", str(self.deck.pk))
        commander = next(r for r in rows if r["is_commander"])
        self.assertIn(key, commander["image"])
        detail = self.client.get(f"/api/user-decks/{self.deck.pk}/").json()
        self.assertIn(key, detail["arts"][atraxa])

    def test_token_art(self):
        treasure = "00ef20b7-2e2a-4ee6-9d0b-2c7e88f5ae20"
        key = self.upload(png(), oracle_id=treasure).json()["id"]
        url = "/api/me/token-arts/"
        res = self.client.put(url, {"oracle_id": treasure, "art": key}, content_type="application/json", **self.auth)
        self.assertIn(key, res.json()["arts"][treasure])
        self.assertTrue(card_art.is_art_url(res.json()["arts"][treasure]))  # a mesa aceita essa imagem
        self.assertEqual(list(self.client.get(url, **self.auth).json()["arts"]), [treasure])
        # Cada um escolhe as suas fichas; o Beto pode usar a arte da Ana no Treasure dele
        self.assertEqual(self.client.get(url, **self.beto_auth).json()["arts"], {})
        other = self.client.put(url, {"oracle_id": treasure, "art": key}, content_type="application/json",
                                **self.beto_auth)
        self.assertIn(key, other.json()["arts"][treasure])
        # Tirar a arte
        res = self.client.put(url, {"oracle_id": treasure, "art": None}, content_type="application/json", **self.auth)
        self.assertEqual(res.json()["arts"], {})

    def test_upload_needs_a_card(self):
        res = self.client.post("/api/me/card-arts/", {"file": png()}, **self.auth)
        self.assertEqual((res.status_code, res.json()["code"]), (400, "bad_card"))

    def test_custom_tokens_are_a_separate_library(self):
        res = self.client.post("/api/me/card-arts/", {"file": png(), "kind": "token", "name": " Jellyfish ",
                                                      "power": "1", "toughness": "1"}, **self.auth)
        self.assertEqual(res.status_code, 201)
        token = res.json()
        self.assertEqual((token["name"], token["power"], token["toughness"]), ("Jellyfish", "1", "1"))
        self.assertTrue(card_art.is_art_url(token["url"]))  # a mesa aceita essa imagem
        # Fica só na lista de fichas: nem nas artes, nem nas soltas da galeria, nem serve de arte de carta
        self.assertEqual(self.client.get("/api/me/card-arts/", **self.auth).json()["arts"], [])
        tokens = self.client.get("/api/me/card-arts/?kind=token", **self.auth).json()["arts"]
        self.assertEqual([t["id"] for t in tokens], [token["id"]])
        gallery = self.client.get(f"/api/card-arts/{SOL}/", **self.auth).json()
        self.assertEqual((gallery["arts"], gallery["loose"], gallery["mine"]), ([], [], 0))
        res = self.client.put(f"/api/me/decks/{self.deck.pk}/arts/", {"oracle_id": SOL, "art": token["id"]},
                              content_type="application/json", **self.auth)
        self.assertEqual(res.status_code, 404)
        # Cada um tem as suas
        self.assertEqual(self.client.get("/api/me/card-arts/?kind=token", **self.beto_auth).json()["arts"], [])
        # Ficha sem nome é recusada
        res = self.client.post("/api/me/card-arts/", {"file": png(), "kind": "token", "name": " "}, **self.auth)
        self.assertEqual(res.json()["code"], "bad_name")

    def test_card_gallery_is_shared(self):
        mine = self.upload(png()).json()["id"]
        theirs = self.upload(png(), auth=self.beto_auth).json()["id"]
        self.upload(png(), oracle_id="d0d33d52-3d28-4635-b985-51e126289259")  # outra carta: fora
        # A do Beto é usada num deck: vem primeiro
        deck_beto = UserDeck.objects.create(owner=self.beto, name="Deck do Beto")
        self.client.put(f"/api/me/decks/{deck_beto.pk}/arts/", {"oracle_id": SOL, "art": theirs},
                        content_type="application/json", **self.beto_auth)
        res = self.client.get(f"/api/card-arts/{SOL}/", **self.auth).json()
        self.assertEqual([(a["id"], a["mine"]) for a in res["arts"]], [(theirs, False), (mine, True)])
        self.assertNotIn("owner", res["arts"][0])  # quem enviou não aparece
        self.assertEqual(res["mine"], 2)
        # Escondida pelo admin: some da galeria
        CardArt.objects.filter(key=theirs).update(hidden_at="2026-10-24T00:00:00Z")
        res = self.client.get(f"/api/card-arts/{SOL}/", **self.auth).json()
        self.assertEqual([a["id"] for a in res["arts"]], [mine])
        # Só o dono apaga
        self.client.delete(f"/api/me/card-arts/{mine}/", **self.beto_auth)
        self.assertTrue(CardArt.objects.filter(key=mine).exists())

    def test_old_art_without_card_joins_the_first_card_it_is_used_on(self):
        art = CardArt.objects.create(owner=self.ana, image=b"x", size=1)
        res = self.client.get(f"/api/card-arts/{SOL}/", **self.auth).json()
        self.assertEqual([a["id"] for a in res["loose"]], [str(art.key)])
        self.assertEqual(self.client.get(f"/api/card-arts/{SOL}/", **self.beto_auth).json()["loose"], [])
        self.client.put(f"/api/me/decks/{self.deck.pk}/arts/", {"oracle_id": SOL, "art": str(art.key)},
                        content_type="application/json", **self.auth)
        art.refresh_from_db()
        self.assertEqual(str(art.oracle_id), SOL)

    def test_one_art_per_copy(self):
        from asgiref.sync import async_to_sync

        from tables import store

        apostle = "595a15f0-77f3-4544-8acc-10630e12cc14"
        card = Card.objects.create(scryfall_id="00000000-0000-0000-0000-000000000079", name="Shadowborn Apostle",
                                   type_line="Creature — Human Cleric", oracle_id=apostle,
                                   image_normal="https://cards.scryfall.io/apostle.jpg")
        UserDeckCard.objects.create(deck=self.deck, card=card, quantity=5)
        keys = [self.upload(png(), oracle_id=apostle).json()["id"] for _ in range(3)]
        url = f"/api/me/decks/{self.deck.pk}/arts/"
        body = {"oracle_id": apostle, "arts": [{"art": keys[0], "copies": 2}, {"art": keys[1], "copies": 2},
                                               {"art": keys[2], "copies": 1}]}
        res = self.client.put(url, body, content_type="application/json", **self.auth).json()
        self.assertEqual([(a["id"], a["copies"]) for a in res["art_sets"][apostle]],
                         [(keys[0], 2), (keys[1], 2), (keys[2], 1)])
        self.assertIn(keys[0], res["arts"][apostle])  # quem só lê "arts" vê a primeira
        detail = self.client.get(f"/api/user-decks/{self.deck.pk}/").json()
        self.assertEqual(len(detail["art_sets"][apostle]), 3)
        # Na mesa: uma linha por arte, com as cópias dela
        _, rows = async_to_sync(store.deck_cards)("user", str(self.deck.pk))
        mine = [(r["image"], r["quantity"]) for r in rows if r["name"] == "Shadowborn Apostle"]
        self.assertEqual([n for _, n in mine], [2, 2, 1])
        self.assertEqual([k in image for k, (image, _) in zip(keys, mine)], [True, True, True])
        # Uma arte só ("art") troca todas
        res = self.client.put(url, {"oracle_id": apostle, "art": keys[1]}, content_type="application/json",
                              **self.auth).json()
        self.assertEqual([(a["id"], a["copies"]) for a in res["art_sets"][apostle]], [(keys[1], 1)])
        _, rows = async_to_sync(store.deck_cards)("user", str(self.deck.pk))
        self.assertEqual([r["quantity"] for r in rows if r["name"] == "Shadowborn Apostle"], [5])
        # Lista vazia tira; pedidos estranhos não passam
        bad = [{"art": keys[0], "copies": 0}], [{"art": keys[0], "copies": True}], [{"art": keys[0]}] * 61, "x"
        for arts in bad:
            res = self.client.put(url, {"oracle_id": apostle, "arts": arts}, content_type="application/json", **self.auth)
            self.assertEqual(res.status_code, 400, arts)
        res = self.client.put(url, {"oracle_id": apostle, "arts": [{"art": keys[0], "copies": 1},
                                                                    {"art": "00000000-0000-0000-0000-000000000000"}]},
                              content_type="application/json", **self.auth)
        self.assertEqual(res.status_code, 404)
        self.assertEqual(len(self.client.get(f"/api/user-decks/{self.deck.pk}/").json()["art_sets"][apostle]), 1)
        res = self.client.put(url, {"oracle_id": apostle, "arts": []}, content_type="application/json", **self.auth)
        self.assertEqual(res.json()["art_sets"], {})

    def test_split_copies(self):
        split = card_art.split_copies
        self.assertEqual(split([("a", 2), ("b", 1)], 3), [("a", 2), ("b", 1)])  # como pedido
        self.assertEqual(split([("a", 3), ("b", 3)], 10), [("a", 5), ("b", 5)])  # o deck tem mais cópias
        self.assertEqual(split([("a", 1), ("b", 1), ("c", 1)], 2), [("a", 1), ("b", 1)])  # tem menos que artes
        self.assertEqual(split([("a", 1)], 4), [("a", 4)])
        self.assertEqual(split([], 4), [])
        # 17 artes pedidas para 28 cópias num deck com 25: todas aparecem, as de 2 cópias primeiro
        wanted = [("a1", 2)] + [(f"b{i}", 1) for i in range(5)] + [(f"c{i}", 2) for i in range(7)] + [("d", 1)] + \
                 [(f"e{i}", 2) for i in range(3)]
        got = split(wanted, 25)
        self.assertEqual(sum(n for _, n in got), 25)
        self.assertEqual([u for u, _ in got], [u for u, _ in wanted])
        self.assertTrue(all(n <= dict(wanted)[u] for u, n in got))

    def test_upload_limit(self):
        from unittest import mock

        with mock.patch.object(card_art, "MAX_PER_USER", 1):
            self.assertEqual(self.upload(png()).status_code, 201)
            self.assertEqual(self.upload(png()).json()["code"], "too_many")
        self.assertEqual(self.client.get("/api/me/card-arts/", **self.auth).json()["max"], card_art.MAX_PER_USER)
        self.assertEqual(self.client.get("/api/me/card-arts/?kind=token", **self.auth).json()["max"],
                         card_art.MAX_TOKENS_PER_USER)

    def test_back_face_art(self):
        from asgiref.sync import async_to_sync

        from tables import store

        delver = "6ff4c11d-8f9e-4d3e-9d4f-1a7d0a4a7c11"
        card = Card.objects.create(scryfall_id="00000000-0000-0000-0000-000000000080",
                                   name="Delver of Secrets // Insectile Aberration", type_line="Creature — Human Wizard",
                                   oracle_id=delver, image_normal="https://cards.scryfall.io/delver.jpg",
                                   image_back="https://cards.scryfall.io/aberration.jpg")
        UserDeckCard.objects.create(deck=self.deck, card=card, quantity=1)
        front = self.upload(png(), oracle_id=delver).json()["id"]
        back = self.client.post("/api/me/card-arts/", {"file": png(), "oracle_id": delver, "face": "back"},
                                **self.auth).json()["id"]
        # Cada face tem a sua galeria
        gallery = lambda face="": [a["id"] for a in self.client.get(f"/api/card-arts/{delver}/{face}", **self.auth).json()["arts"]]  # noqa: E731
        self.assertEqual((gallery(), gallery("?face=back")), ([front], [back]))
        url = f"/api/me/decks/{self.deck.pk}/arts/"
        # A arte da frente não serve no verso (nem a do verso na frente)
        res = self.client.put(url, {"oracle_id": delver, "art": front, "face": "back"}, content_type="application/json",
                              **self.auth)
        self.assertEqual(res.status_code, 404)
        self.assertEqual(self.client.put(url, {"oracle_id": delver, "art": back}, content_type="application/json",
                                         **self.auth).status_code, 404)
        self.client.put(url, {"oracle_id": delver, "art": front}, content_type="application/json", **self.auth)
        res = self.client.put(url, {"oracle_id": delver, "art": back, "face": "back"}, content_type="application/json",
                              **self.auth).json()
        self.assertIn(front, res["arts"][delver])
        self.assertIn(back, res["back_arts"][delver])
        detail = self.client.get(f"/api/user-decks/{self.deck.pk}/").json()
        self.assertIn(back, detail["back_arts"][delver])
        # Na mesa, a carta vem com as duas artes (virar mostra a do verso)
        _, rows = async_to_sync(store.deck_cards)("user", str(self.deck.pk))
        row = next(r for r in rows if r["name"].startswith("Delver"))
        self.assertIn(front, row["image"])
        self.assertIn(back, row["back"])
        # Tirar o verso não mexe na frente
        res = self.client.put(url, {"oracle_id": delver, "art": None, "face": "back"}, content_type="application/json",
                              **self.auth).json()
        self.assertEqual((list(res["arts"]), res["back_arts"]), ([delver], {}))

    def test_back_art_needs_a_back(self):
        from asgiref.sync import async_to_sync

        from tables import store

        key = self.client.post("/api/me/card-arts/", {"file": png(), "oracle_id": SOL, "face": "back"},
                               **self.auth).json()["id"]
        self.client.put(f"/api/me/decks/{self.deck.pk}/arts/", {"oracle_id": SOL, "art": key, "face": "back"},
                        content_type="application/json", **self.auth)
        _, rows = async_to_sync(store.deck_cards)("user", str(self.deck.pk))
        self.assertEqual(rows[0]["back"], "")  # carta de uma face só não ganha verso na mesa
