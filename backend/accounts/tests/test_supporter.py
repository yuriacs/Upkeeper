import io
from datetime import timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from PIL import Image
from rest_framework.authtoken.models import Token

from accounts import supporter
from accounts.models import DonationClaim, Playmat, SleeveArt, Supporter
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
            self.assertEqual((img.format, img.size), ("WEBP", (1920, 640)))  # o formato do campo na mesa
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


class DonationClaimTests(TestCase):
    def setUp(self):
        self.ana = User.objects.create_user("ana", "", "x")
        self.bia = User.objects.create_user("bia", "", "x")
        self.dono = User.objects.create_user("dono", "", "x", is_staff=True)
        self.auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.ana).key}"}
        self.auth_bia = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.bia).key}"}
        self.admin = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.dono).key}"}

    def donation(self, method="get", data=None, auth=None):
        return getattr(self.client, method)(
            "/api/auth/me/donation/", data, content_type="application/json", **(auth or self.auth)
        )

    def queue(self):
        return self.client.get("/api/admin/donations/", **self.admin).json()["donations"]

    def resolve(self, pk, action):
        return self.client.post(f"/api/admin/donations/{pk}/", {"action": action}, content_type="application/json",
                                **self.admin)

    def test_cents_are_kept_and_not_shared(self):
        mine = self.donation().json()
        self.assertTrue(1 <= mine["cents"] <= 99)
        self.assertIsNone(mine["claimed_at"])
        self.assertEqual(self.donation().json()["cents"], mine["cents"])  # os mesmos enquanto valem
        self.assertNotEqual(self.donation(auth=self.auth_bia).json()["cents"], mine["cents"])
        self.assertEqual(self.queue(), [])  # só reservar não entra na fila

    def test_expired_reservation_gets_new_cents(self):
        self.donation()
        DonationClaim.objects.filter(user=self.ana).update(
            created_at=timezone.now() - timedelta(hours=supporter.RESERVE_HOURS + 1)
        )
        self.donation()
        row = DonationClaim.objects.get(user=self.ana)
        self.assertAlmostEqual((timezone.now() - row.created_at).total_seconds(), 0, delta=60)

    def test_claim_goes_to_the_queue_and_grant_activates(self):
        cents = self.donation().json()["cents"]
        claimed = self.donation("post", {}).json()
        self.assertIsNotNone(claimed["claimed_at"])
        [item] = self.queue()
        self.assertEqual((item["username"], item["cents"], item["gift"]), ("ana", cents, None))
        self.assertEqual(self.resolve(item["id"], "grant").status_code, 201)
        self.assertTrue(supporter.is_active(self.ana))
        self.assertEqual(self.queue(), [])
        self.assertFalse(DonationClaim.objects.exists())  # o aviso some depois de ativar

    def test_gift_activates_the_friend(self):
        self.assertEqual(self.donation("post", {"gift": "ninguem"}).status_code, 404)
        self.assertEqual(self.donation("post", {"gift": "@Bia"}).json()["gift"], "bia")
        self.assertEqual(self.queue()[0]["gift"], "bia")
        self.resolve(self.queue()[0]["id"], "grant")
        self.assertTrue(supporter.is_active(self.bia))
        self.assertFalse(supporter.is_active(self.ana))

    def test_gift_to_yourself_is_for_you(self):
        self.assertIsNone(self.donation("post", {"gift": "ana"}).json()["gift"])

    def test_reject_cancel_and_expiry(self):
        self.donation("post", {})
        self.assertEqual(self.resolve(self.queue()[0]["id"], "reject").status_code, 204)
        self.assertFalse(supporter.is_active(self.ana))
        self.assertEqual(self.queue(), [])
        self.donation("post", {})
        self.assertEqual(self.donation("delete").status_code, 204)
        self.assertEqual(self.queue(), [])
        self.donation("post", {})
        DonationClaim.objects.update(claimed_at=timezone.now() - timedelta(days=supporter.CLAIM_DAYS + 1))
        self.assertEqual(self.queue(), [])  # aviso velho sai da fila

    def test_only_admin_sees_and_resolves(self):
        self.donation("post", {})
        pk = DonationClaim.objects.get().pk
        self.assertEqual(self.client.get("/api/admin/donations/", **self.auth).status_code, 403)
        res = self.client.post(f"/api/admin/donations/{pk}/", {"action": "grant"}, content_type="application/json",
                               **self.auth)
        self.assertEqual(res.status_code, 403)
        self.assertEqual(self.resolve(pk, "talvez").status_code, 400)
        self.assertEqual(self.resolve(pk + 1, "grant").status_code, 404)
        self.assertEqual(self.client.get("/api/auth/me/donation/").status_code, 401)


class FounderTests(TestCase):
    def setUp(self):
        self.ana = User.objects.create_user("ana", "", "x")
        self.bia = User.objects.create_user("bia", "", "x")
        self.dono = User.objects.create_user("dono", "", "x", is_staff=True)
        self.auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.ana).key}"}
        self.admin = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.dono).key}"}

    def grant(self, name="ana", **extra):
        return self.client.post("/api/admin/supporters/", {"username": name, **extra},
                                content_type="application/json", **self.admin)

    def after_deadline(self):
        return mock.patch.object(supporter, "FOUNDER_UNTIL", timezone.now() - timedelta(days=1))

    def test_any_activation_before_the_deadline_is_founder_forever(self):
        self.assertEqual(self.grant(amount=500).json()["total_cents"], 500)
        self.assertTrue(supporter.is_founder(self.ana))
        Supporter.objects.filter(user=self.ana).update(until=timezone.now() - timedelta(days=90))
        profile = self.client.get("/api/users/ana/").json()
        self.assertEqual((profile["supporter"], profile["founder"]), (False, True))  # venceu, o selo fica
        self.assertTrue(self.client.get("/api/auth/me/", **self.auth).json()["supporter"]["founder"])

    def test_after_the_deadline_only_the_total_counts(self):
        with self.after_deadline():
            self.grant(amount=6000)
            self.assertFalse(supporter.is_founder(self.ana))
            self.grant(amount=4000)  # R$ 100 somados
            self.assertTrue(supporter.is_founder(self.ana))
        self.assertEqual(Supporter.objects.get(user=self.ana).total_cents, 10_000)

    def test_gift_counts_for_who_paid(self):
        with self.after_deadline():
            self.client.post("/api/auth/me/donation/", {"gift": "bia"}, content_type="application/json", **self.auth)
            pk = DonationClaim.objects.get().pk
            res = self.client.post(f"/api/admin/donations/{pk}/", {"action": "grant", "amount": 10_000},
                                   content_type="application/json", **self.admin)
            self.assertEqual(res.status_code, 201)
        self.assertTrue(supporter.is_active(self.bia))
        self.assertFalse(supporter.is_active(self.ana))
        self.assertEqual(Supporter.objects.get(user=self.ana).total_cents, 10_000)
        self.assertTrue(supporter.is_founder(self.ana))
        self.assertFalse(supporter.is_founder(self.bia))

    def test_bad_amount(self):
        self.assertEqual(self.grant(amount=-1).status_code, 400)
        self.assertEqual(self.grant(amount="10,00").status_code, 400)
        self.assertFalse(Supporter.objects.exists())

    def test_credits_page_and_opt_out(self):
        self.grant()
        with self.after_deadline():
            self.grant("bia")  # depois do prazo e sem R$ 100: não entra
        names = lambda: [f["username"] for f in self.client.get("/api/supporters/credits/").json()["founders"]]  # noqa: E731
        self.assertEqual(names(), ["ana"])
        res = self.client.patch("/api/auth/me/supporter/", {"in_credits": False}, content_type="application/json",
                                **self.auth)
        self.assertFalse(res.json()["in_credits"])
        self.assertEqual(names(), [])


class FounderPerkTests(TestCase):
    """Sleeve com imagem, foil, moldura e título: Fundador com o apoio ativo."""

    def setUp(self):
        self.ana = User.objects.create_user("ana", "", "x")
        self.dono = User.objects.create_user("dono", "", "x", is_staff=True)
        self.auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.ana).key}"}
        self.admin = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.dono).key}"}

    def patch(self, data):
        return self.client.patch("/api/auth/me/supporter/", data, content_type="application/json", **self.auth)

    def upload(self):
        return self.client.post("/api/auth/me/sleeve/", {"file": picture()}, **self.auth)

    def test_only_active_founders_upload_a_sleeve(self):
        self.assertEqual(self.upload().json()["code"], "not_founder")
        with mock.patch.object(supporter, "FOUNDER_UNTIL", timezone.now() - timedelta(days=1)):
            supporter.grant(self.ana)  # apoiador, mas não Fundador
        self.assertEqual(self.upload().json()["code"], "not_founder")
        supporter.grant(self.ana)  # dentro do prazo: Fundador
        res = self.upload()
        self.assertEqual(res.status_code, 201)
        url = res.json()["sleeve_image"]
        with Image.open(io.BytesIO(bytes(SleeveArt.objects.get(user=self.ana).image))) as img:
            self.assertEqual(img.format, "WEBP")
            self.assertGreater(img.size[1], img.size[0])  # formato de carta, em pé
        self.assertEqual(self.client.get(url).status_code, 200)
        self.client.delete("/api/auth/me/sleeve/", **self.auth)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_sleeve_can_be_reported_and_hidden(self):
        supporter.grant(self.ana)
        url = self.upload().json()["sleeve_image"]
        beto = User.objects.create_user("beto", "", "x")
        beto_auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=beto).key}"}
        res = self.client.post("/api/auth/report-image/", {"url": url}, content_type="application/json", **beto_auth)
        self.assertEqual(res.status_code, 204)
        [item] = self.client.get("/api/admin/reports/", **self.admin).json()["reports"]
        self.assertEqual((item["kind"], item["url"]), ("sleeve", url))
        self.client.post(f"/api/admin/reports/{item['key']}/", {"action": "hide"}, content_type="application/json",
                         **self.admin)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(supporter.cosmetics(self.ana)["sleeve_image"], "")

    def test_choices_and_where_they_show(self):
        supporter.grant(self.ana)
        self.assertEqual(self.patch({"title": "Rei de tudo"}).status_code, 400)  # só da lista
        self.assertEqual(self.patch({"foil": "sim"}).status_code, 400)
        info = self.patch({"title": "kingmaker", "foil": True, "frame": True}).json()
        self.assertEqual((info["title"], info["foil"], info["founder_perks"]), ("kingmaker", True, True))
        profile = self.client.get("/api/users/ana/").json()
        self.assertEqual((profile["title"], profile["frame"]), ("kingmaker", True))
        seat = supporter.cosmetics(self.ana)
        self.assertEqual((seat["foil"], seat["frame"]), (True, True))
        t = state.Table(state.new_table("FUNDA"))
        t.join(self.ana.id, "ana", None, seat)
        p = next(p for p in t.view(self.ana.id)["players"] if p["id"] == self.ana.id)
        self.assertEqual((p["foil"], p["frame"]), (True, True))
        supporter.revoke(self.ana)  # venceu: o selo de Fundador fica, os enfeites somem
        profile = self.client.get("/api/users/ana/").json()
        self.assertEqual((profile["founder"], profile["title"], profile["frame"]), (True, "", False))
        self.assertEqual(supporter.cosmetics(self.ana)["foil"], False)
        t.join(self.ana.id, "ana", None, supporter.cosmetics(self.ana))
        p = next(p for p in t.view(self.ana.id)["players"] if p["id"] == self.ana.id)
        self.assertEqual((p["foil"], p["frame"], p["sleeve_image"]), (False, False, None))
