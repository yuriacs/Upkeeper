import io
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from PIL import Image
from rest_framework.authtoken.models import Token

from accounts import supporter
from accounts.models import Playmat, Supporter
from tables import state

User = get_user_model()


def picture():
    out = io.BytesIO()
    Image.new("RGB", (2000, 1500), (90, 30, 140)).save(out, "PNG")
    return SimpleUploadedFile("mesa.png", out.getvalue(), content_type="image/png")


class SupporterTests(TestCase):
    def setUp(self):
        self.ana = User.objects.create_user("ana", "", "x")
        self.dono = User.objects.create_user("dono", "", "x", is_staff=True)
        self.auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.ana).key}"}
        self.admin = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.dono).key}"}

    def grant(self, name="ana", **extra):
        return self.client.post("/api/admin/supporters/", {"username": name, **extra},
                                content_type="application/json", **self.admin)

    def me(self):
        return self.client.get("/api/auth/me/", **self.auth).json()["supporter"]

    def test_admin_grants_30_days_and_renewal_adds_up(self):
        self.assertFalse(self.me()["active"])
        self.assertEqual(self.grant("@Ana").status_code, 201)  # com @ e sem diferenciar maiúsculas
        first = Supporter.objects.get(user=self.ana).until
        self.assertAlmostEqual((first - timezone.now()).total_seconds(), 30 * 86400, delta=60)
        self.grant()
        second = Supporter.objects.get(user=self.ana).until
        self.assertEqual(second - first, timedelta(days=30))  # renovou antes de vencer: soma
        info = self.me()
        self.assertTrue(info["active"])
        self.assertTrue(info["ever"])
        self.assertTrue(self.client.get("/api/users/ana/").json()["supporter"])
        listed = self.client.get("/api/admin/supporters/", **self.admin).json()
        self.assertEqual((listed["active"], listed["supporters"][0]["username"]), (1, "ana"))

    def test_finds_the_account_from_the_pix_id(self):
        nihil = User.objects.create_user("nihil_magic.99", "", "x")
        self.assertEqual(self.grant("NIHILMAGIC99").status_code, 201)  # identificador do Pix: só letras e números
        self.assertTrue(supporter.is_active(nihil))
        self.assertEqual(self.grant("Upkeeper ana").status_code, 201)  # descrição inteira colada
        self.assertTrue(supporter.is_active(self.ana))

    def test_expired_restarts_from_now(self):
        Supporter.objects.create(user=self.ana, until=timezone.now() - timedelta(days=90), times=1)
        self.grant()
        until = Supporter.objects.get(user=self.ana).until
        self.assertAlmostEqual((until - timezone.now()).total_seconds(), 30 * 86400, delta=60)

    def test_revoke_and_errors(self):
        self.grant()
        self.assertEqual(self.client.delete("/api/admin/supporters/ana/", **self.admin).status_code, 204)
        self.assertFalse(self.me()["active"])
        self.assertEqual(self.grant("ninguem").status_code, 404)
        self.assertEqual(self.grant(days=0).status_code, 400)
        # Só admin ativa
        res = self.client.post("/api/admin/supporters/", {"username": "ana"}, content_type="application/json",
                               **self.auth)
        self.assertEqual(res.status_code, 403)

    def test_choices_sleeve_and_wall(self):
        patch = lambda data: self.client.patch(  # noqa: E731
            "/api/auth/me/supporter/", data, content_type="application/json", **self.auth
        )
        self.assertEqual(patch({"sleeve": "azure"}).status_code, 403)  # nunca apoiou
        self.grant()
        self.assertEqual(patch({"sleeve": "pink-unicorn"}).status_code, 400)
        res = patch({"sleeve": "azure", "on_wall": True}).json()
        self.assertEqual((res["sleeve"], res["on_wall"]), ("azure", True))
        wall = self.client.get("/api/supporters/").json()["supporters"]
        self.assertEqual([w["username"] for w in wall], ["ana"])
        patch({"on_wall": False})
        self.assertEqual(self.client.get("/api/supporters/").json()["supporters"], [])
        # Venceu: sai do mural mesmo tendo escolhido aparecer
        patch({"on_wall": True})
        supporter.revoke(self.ana)
        self.assertEqual(self.client.get("/api/supporters/").json()["supporters"], [])

    def test_playmat_only_for_supporters(self):
        res = self.client.post("/api/auth/me/playmat/", {"file": picture()}, **self.auth)
        self.assertEqual(res.json()["code"], "not_supporter")
        self.grant()
        res = self.client.post("/api/auth/me/playmat/", {"file": picture()}, **self.auth)
        self.assertEqual(res.status_code, 201)
        url = res.json()["playmat"]
        with Image.open(io.BytesIO(bytes(Playmat.objects.get(user=self.ana).image))) as img:
            self.assertEqual((img.format, img.size), ("WEBP", (1280, 720)))
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.me()["playmat"], url)
        self.client.delete("/api/auth/me/playmat/", **self.auth)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_playmat_can_be_reported_and_hidden(self):
        self.grant()
        url = self.client.post("/api/auth/me/playmat/", {"file": picture()}, **self.auth).json()["playmat"]
        beto = User.objects.create_user("beto", "", "x")
        beto_auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=beto).key}"}
        res = self.client.post("/api/auth/report-image/", {"url": url}, content_type="application/json", **beto_auth)
        self.assertEqual(res.status_code, 204)
        queue = self.client.get("/api/admin/reports/", **self.admin).json()["reports"]
        self.assertEqual((queue[0]["kind"], queue[0]["url"]), ("playmat", url))
        key = queue[0]["key"]
        self.client.post(f"/api/admin/reports/{key}/", {"action": "hide"}, content_type="application/json",
                         **self.admin)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertIsNone(self.me()["playmat"])

    def test_table_shows_perks_only_while_active(self):
        self.grant()
        Supporter.objects.filter(user=self.ana).update(sleeve="crimson")
        t = state.Table(state.new_table("APOIO"))
        t.join(self.ana.id, "ana", None, supporter.cosmetics(self.ana))
        p = next(p for p in t.view(self.ana.id)["players"] if p["id"] == self.ana.id)
        self.assertEqual((p["supporter"], p["sleeve"], p["playmat"]), (True, "crimson", None))
        supporter.revoke(self.ana)
        t.join(self.ana.id, "ana", None, supporter.cosmetics(self.ana))  # voltou depois de vencer
        p = next(p for p in t.view(self.ana.id)["players"] if p["id"] == self.ana.id)
        self.assertEqual((p["supporter"], p["sleeve"]), (False, None))

    def test_export_includes_supporter(self):
        self.assertIsNone(self.client.get("/api/auth/me/export/", **self.auth).json()["supporter"])
        self.grant()
        self.assertIn("until", self.client.get("/api/auth/me/export/", **self.auth).json()["supporter"])
