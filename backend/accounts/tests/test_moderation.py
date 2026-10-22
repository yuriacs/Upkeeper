import io
from unittest import mock

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image
from rest_framework.authtoken.models import Token

from accounts.models import ImageReport, UploadBlock
from config.throttles import ReportThrottle
from decks.models import Card
from pools.models import TokenArt, UserDeck, UserDeckCard

User = get_user_model()
SOL = "6ad8011d-3471-4369-9d68-b264cc027487"
TREASURE = "8a3c8b58-2a8e-4d1d-9c86-6f4a5bb1b0a1"


def png(size=(600, 800)):
    out = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(out, "PNG")
    return SimpleUploadedFile("arte.png", out.getvalue(), content_type="image/png")


class ImageModerationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.ana = User.objects.create_user("ana", "", "x")
        self.beto = User.objects.create_user("beto", "", "x")
        self.dono = User.objects.create_user("dono", "", "x", is_staff=True)
        self.ana_auth = self.auth(self.ana)
        self.beto_auth = self.auth(self.beto)
        self.admin_auth = self.auth(self.dono)
        card = Card.objects.create(scryfall_id="00000000-0000-0000-0000-000000000077", name="Sol Ring",
                                   type_line="Artifact", oracle_id=SOL, image_normal="https://cards.scryfall.io/sol.jpg")
        self.deck = UserDeck.objects.create(owner=self.ana, name="Deck da Ana")
        UserDeckCard.objects.create(deck=self.deck, card=card, quantity=1)

    @staticmethod
    def auth(user):
        return {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=user).key}"}

    def avatar(self):
        return self.client.post("/api/auth/me/avatar/", {"file": png()}, **self.ana_auth).json()["avatar"]

    def art(self):
        art = self.client.post("/api/me/card-arts/", {"file": png()}, **self.ana_auth).json()
        self.client.put(f"/api/me/decks/{self.deck.pk}/arts/", {"oracle_id": SOL, "art": art["id"]},
                        content_type="application/json", **self.ana_auth)
        self.client.put("/api/me/token-arts/", {"oracle_id": TREASURE, "art": art["id"]},
                        content_type="application/json", **self.ana_auth)
        return art["url"]

    def report(self, url, auth=None):
        return self.client.post("/api/auth/report-image/", {"url": url}, content_type="application/json",
                                **(auth or self.beto_auth))

    def queue(self):
        return self.client.get("/api/admin/reports/", **self.admin_auth).json()["reports"]

    def resolve(self, key, action, block=False):
        return self.client.post(f"/api/admin/reports/{key}/", {"action": action, "block": block},
                                content_type="application/json", **self.admin_auth)

    def test_report_avatar_and_hide(self):
        url = self.avatar()
        self.assertEqual(self.report(url).status_code, 204)
        self.assertEqual(self.report(url).status_code, 204)  # de novo: não conta duas vezes
        self.assertEqual(self.report(url, self.admin_auth).status_code, 204)
        [row] = self.queue()
        self.assertEqual((row["kind"], row["owner"], row["count"], row["url"]), ("avatar", "ana", 2, url))
        self.assertNotIn("reporter", row)  # quem denunciou não aparece para o dono nem na fila

        self.assertEqual(self.client.get(url).status_code, 200)  # já na memória do processo
        self.assertEqual(self.resolve(row["key"], "hide").status_code, 204)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertIsNone(self.client.get("/api/users/ana/").json()["avatar"])  # volta ao ícone
        self.assertIsNone(self.client.get("/api/auth/me/", **self.ana_auth).json()["avatar"])
        self.assertEqual(self.queue(), [])
        self.assertEqual(set(ImageReport.objects.values_list("status", flat=True)), {ImageReport.Status.HIDDEN})
        self.assertEqual(self.report(url).status_code, 404)  # escondida: nada mais a denunciar

        # Sem bloqueio, uma foto nova substitui a escondida
        self.assertEqual(self.client.post("/api/auth/me/avatar/", {"file": png()}, **self.ana_auth).status_code, 201)

    def test_report_art_hide_and_block(self):
        url = self.art()
        self.assertEqual(self.report(url).status_code, 204)
        [row] = self.queue()
        self.assertEqual((row["kind"], row["owner_blocked"]), ("art", False))
        self.assertEqual(self.resolve(row["key"], "hide", block=True).status_code, 204)

        self.assertEqual(self.client.get(url).status_code, 404)
        detail = self.client.get(f"/api/user-decks/{self.deck.pk}/").json()
        self.assertEqual(detail["arts"], {})  # a carta volta à imagem original
        self.assertEqual(self.client.get("/api/me/token-arts/", **self.ana_auth).json()["arts"], {})
        self.assertTrue(TokenArt.objects.exists())  # a escolha fica, só a imagem some
        self.assertEqual(self.client.get("/api/me/card-arts/", **self.ana_auth).json()["arts"], [])

        # Conta bloqueada: não envia foto nem arte nova
        blocked = self.client.post("/api/me/card-arts/", {"file": png()}, **self.ana_auth)
        self.assertEqual((blocked.status_code, blocked.json()["code"]), (403, "uploads_blocked"))
        blocked = self.client.post("/api/auth/me/avatar/", {"file": png()}, **self.ana_auth)
        self.assertEqual((blocked.status_code, blocked.json()["code"]), (403, "uploads_blocked"))

        # O admin libera de novo
        self.assertEqual(self.client.delete("/api/admin/upload-blocks/ana/", **self.admin_auth).status_code, 204)
        self.assertFalse(UploadBlock.objects.exists())
        self.assertEqual(self.client.post("/api/me/card-arts/", {"file": png()}, **self.ana_auth).status_code, 201)

    def test_dismiss_keeps_the_image(self):
        url = self.art()
        self.report(url)
        key = self.queue()[0]["key"]
        self.assertEqual(self.resolve(key, "dismiss").status_code, 204)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.queue(), [])
        self.assertEqual(self.resolve(key, "hide").status_code, 404)  # nada aberto para essa imagem

    def test_bad_reports(self):
        url = self.avatar()
        self.assertEqual(self.report(url, self.ana_auth).json()["code"], "own_image")
        self.assertEqual(self.report("https://example.com/x.png").status_code, 404)
        missing = f"{settings.PUBLIC_API_BASE}/api/avatar/00000000-0000-0000-0000-000000000000/"
        self.assertEqual(self.report(missing).status_code, 404)
        self.assertEqual(self.client.post("/api/auth/report-image/", {"url": url},
                                          content_type="application/json").status_code, 401)
        self.assertFalse(ImageReport.objects.exists())

    def test_only_staff_moderates(self):
        url = self.avatar()
        self.report(url)
        key = ImageReport.objects.get().key
        self.assertEqual(self.client.get("/api/admin/reports/", **self.beto_auth).status_code, 403)
        self.assertEqual(self.client.post(f"/api/admin/reports/{key}/", {"action": "hide"},
                                          content_type="application/json", **self.beto_auth).status_code, 403)
        self.assertEqual(self.client.delete("/api/admin/upload-blocks/ana/", **self.beto_auth).status_code, 403)
        self.assertEqual(self.client.get(url).status_code, 200)

    def test_report_limit(self):
        url = self.avatar()
        with mock.patch.object(ReportThrottle, "rate", "2/day", create=True):
            codes = [self.report(url).status_code for _ in range(3)]
        self.assertEqual(codes, [204, 204, 429])
