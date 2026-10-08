from django.test import TestCase
from django.urls import reverse


class HealthTests(TestCase):
    def test_health_returns_ok(self):
        res = self.client.get(reverse("health"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "ok")
