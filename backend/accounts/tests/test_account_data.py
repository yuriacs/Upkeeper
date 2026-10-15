from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from config.throttles import DeckImportThrottle
from decks.models import Deck, DrawEntry, Edition
from decks.services.draw import create_draw
from pools.models import OwnedPrecon, UserDeck
from rooms.models import Room, RoomPlayer

from .browser import auth_key
from .browser import login as browser_login
from .browser import register as browser_register

User = get_user_model()


class AccountDataTests(TestCase):
    def setUp(self):
        cache.clear()
        ed = Edition.objects.create(code="AAA", name="A")
        for i, c in enumerate("WUB"):
            Deck.objects.create(name=f"D{i}", slug=f"d{i}", edition=ed, color_identity=c)
        res = browser_register(self.client, "ana", "ana@example.com", "senha-forte-123")
        self.token = res.json()["token"]
        self.user = User.objects.get(username="ana")
        self.auth = {"HTTP_AUTHORIZATION": f"Token {self.token}"}

    def test_export(self):
        OwnedPrecon.objects.create(user=self.user, deck=Deck.objects.get(slug="d0"))
        UserDeck.objects.create(owner=self.user, name="Meu deck", decklist_text="1 Sol Ring")
        create_draw(["ana", "Beto"], {}, users=[self.user, None])
        res = self.client.get("/api/auth/me/export/", **self.auth)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertNotIn("ana@example.com", res.content.decode())  # o servidor não tem o e-mail legível
        self.assertTrue(data["private_profile"]["encrypted_profile_aes_gcm"])
        self.assertEqual(data["owned_precons"], ["D0"])
        self.assertEqual(data["decks"][0]["decklist"], "1 Sol Ring")
        self.assertEqual(len(data["draws_received"]), 1)
        self.assertIn("attachment", res["Content-Disposition"])

    def test_delete_requires_password_and_removes_personal_data(self):
        UserDeck.objects.create(owner=self.user, name="Meu deck")
        draw = create_draw(["ana", "Beto"], {}, users=[self.user, None])
        room = Room.objects.create(code="sala1")
        RoomPlayer.objects.create(room=room, name="ana", user=self.user)

        res = self.client.delete("/api/auth/me/", {"password": "errada"}, content_type="application/json", **self.auth)
        self.assertEqual(res.status_code, 400)
        self.assertTrue(User.objects.filter(username="ana").exists())

        salt = self.user.private.kdf_salt
        res = self.client.delete(
            "/api/auth/me/", {"auth_key": auth_key("senha-forte-123", salt)}, content_type="application/json",
            **self.auth,
        )
        self.assertEqual(res.status_code, 204)
        self.assertFalse(User.objects.filter(username="ana").exists())
        self.assertFalse(UserDeck.objects.exists())
        self.assertFalse(Room.objects.filter(code="sala1").exists())  # ficou vazia
        names = list(DrawEntry.objects.filter(draw=draw).values_list("player_name", flat=True))
        self.assertEqual(names, ["(conta excluída)", "Beto"])  # o sorteio continua, sem o nome
        self.assertEqual(self.client.get("/api/auth/me/", **self.auth).status_code, 401)


class ThrottleTests(TestCase):
    def test_deck_import_is_limited(self):
        cache.clear()
        user = User.objects.create_user("ana", "ana@example.com", "senha-forte-123")
        token = browser_login(self.client, "ana", "senha-forte-123").json()["token"]
        auth = {"HTTP_AUTHORIZATION": f"Token {token}"}
        body = {"name": "X", "decklist": "1 Carta Que Nao Existe"}
        with mock.patch.object(DeckImportThrottle, "rate", "2/hour", create=True), \
                mock.patch("pools.services.import_deck.fetch_cards", return_value={}):
            codes = [self.client.post("/api/me/decks/", body, content_type="application/json", **auth).status_code
                     for _ in range(3)]
            # Leitura não gasta o limite
            self.assertEqual(self.client.get("/api/me/decks/", **auth).status_code, 200)
        self.assertEqual(codes, [400, 400, 429])
