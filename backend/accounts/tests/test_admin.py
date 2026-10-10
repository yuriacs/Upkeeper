import importlib
from io import StringIO

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from rest_framework.authtoken.models import Token

from decks.models import Deck, Draw, DrawEntry, Edition
from pools.models import OwnedPrecon

User = get_user_model()


class AdminPanelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user("dono", "dono@example.com", "senha-forte-123", is_staff=True)
        cls.ana = User.objects.create_user("ana", "ana@example.com", "senha-forte-123")
        ed = Edition.objects.create(code="AAA", name="A")
        deck = Deck.objects.create(name="D0", slug="d0", edition=ed)
        OwnedPrecon.objects.create(user=cls.ana, deck=deck)
        draw = Draw.objects.create(code="x1", winner_position=0)
        DrawEntry.objects.create(draw=draw, position=0, player_name="ana", player=cls.ana, deck=deck)
        DrawEntry.objects.create(draw=draw, position=1, player_name="dono", player=cls.admin, deck=deck)

    def get(self, url, user=None):
        headers = {"HTTP_AUTHORIZATION": f"Token {Token.objects.get_or_create(user=user)[0].key}"} if user else {}
        return self.client.get(url, **headers)

    def test_only_staff_can_see(self):
        for url in ["/api/admin/overview/", "/api/admin/users/"]:
            self.assertEqual(self.get(url).status_code, 401)
            self.assertEqual(self.get(url, self.ana).status_code, 403)
            self.assertEqual(self.get(url, self.admin).status_code, 200)

    def test_overview_numbers(self):
        data = self.get("/api/admin/overview/", self.admin).json()
        self.assertEqual(data["users"]["total"], 2)
        self.assertEqual(data["users"]["with_pool"], 1)
        self.assertEqual(data["content"]["games"], 1)
        self.assertEqual(len(data["signups_by_day"]), data["days"])
        self.assertEqual(sum(d["count"] for d in data["signups_by_day"]), 2)
        self.assertEqual(data["top_owned"], [{"slug": "d0", "name": "D0", "owners": 1}])

    def test_users_list_counts_search_and_order(self):
        res = self.get("/api/admin/users/?ordering=wins", self.admin).json()
        self.assertEqual(res["count"], 2)
        top = res["results"][0]
        self.assertEqual((top["username"], top["precons"], top["draws"], top["games"], top["wins"]), ("ana", 1, 1, 1, 1))
        res = self.get("/api/admin/users/?search=dono@", self.admin).json()
        self.assertEqual([u["username"] for u in res["results"]], ["dono"])

    def test_me_exposes_admin_flag(self):
        self.assertTrue(self.get("/api/auth/me/", self.admin).json()["is_admin"])
        self.assertFalse(self.get("/api/auth/me/", self.ana).json()["is_admin"])

    def test_owner_migration_and_command(self):
        User.objects.create_user("nihil", "Yurimaxqi@Gmail.com", "senha-forte-123")
        mod = importlib.import_module("accounts.migrations.0001_grant_site_admin")
        mod.grant(django_apps, None)
        self.assertTrue(User.objects.get(username="nihil").is_staff)
        call_command("grant_admin", "ana@example.com", stdout=StringIO())
        self.assertTrue(User.objects.get(username="ana").is_staff)
        call_command("grant_admin", "ana@example.com", "--revoke", stdout=StringIO())
        self.assertFalse(User.objects.get(username="ana").is_staff)

    def test_opening_the_site_counts_as_activity(self):
        self.assertIsNone(User.objects.get(pk=self.ana.pk).last_login)
        self.get("/api/auth/me/", self.ana)
        first = User.objects.get(pk=self.ana.pk).last_login
        self.assertIsNotNone(first)
        self.get("/api/auth/me/", self.ana)  # menos de 1 hora depois: não grava de novo
        self.assertEqual(User.objects.get(pk=self.ana.pk).last_login, first)
