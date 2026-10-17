from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from accounts.models import PrivateProfile

from .browser import login as browser_login
from .browser import register as browser_register

User = get_user_model()


class UsernameChangeTests(TestCase):
    def setUp(self):
        cache.clear()
        self.token = browser_register(self.client, "ana", "ana@example.com", "senha-forte-123").json()["token"]
        browser_register(self.client, "beto", "beto@example.com", "senha-forte-123")
        self.auth = {"HTTP_AUTHORIZATION": f"Token {self.token}"}

    def put(self, name):
        return self.client.put("/api/auth/me/username/", {"username": name}, content_type="application/json", **self.auth)

    def test_change_and_login_with_new_name(self):
        res = self.put("Aninha")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["username"], "Aninha")
        self.assertIsNotNone(res.json()["username_next_change"])
        # A senha continua valendo com o nome novo (o salt é da conta, não do nome)
        self.assertEqual(browser_login(self.client, "aninha", "senha-forte-123").status_code, 200)

    def test_taken_invalid_and_cooldown(self):
        self.assertEqual(self.put("BETO").status_code, 400)  # já existe (sem diferenciar maiúsculas)
        self.assertEqual(self.put("a b").status_code, 400)
        self.assertEqual(self.put("Ana").status_code, 200)  # só maiúsculas: não conta para o intervalo
        self.assertEqual(self.put("ana2").status_code, 200)
        res = self.put("ana3")
        self.assertEqual(res.status_code, 400)  # uma troca por semana
        profile = PrivateProfile.objects.get(user__username="ana2")
        profile.username_changed_at = timezone.now() - timedelta(days=8)
        profile.save()
        self.assertEqual(self.put("ana3").status_code, 200)
