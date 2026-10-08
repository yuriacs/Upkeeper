from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

User = get_user_model()


class AuthTests(TestCase):
    def setUp(self):
        cache.clear()

    def post(self, url, body, token=None):
        headers = {"HTTP_AUTHORIZATION": f"Token {token}"} if token else {}
        return self.client.post(url, body, content_type="application/json", **headers)

    def register(self, username="nihil", email="nihil@example.com", password="dragoes-vermelhos-42"):
        return self.post("/api/auth/register/", {"username": username, "email": email, "password": password})

    def test_register_returns_token(self):
        res = self.register()
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["user"]["username"], "nihil")
        self.assertTrue(res.json()["token"])

    def test_register_rejects_duplicates_and_weak_password(self):
        self.register()
        self.assertEqual(self.register(email="outro@example.com").status_code, 400)  # usuário repetido
        self.assertEqual(self.register(username="NIHIL2", email="NIHIL@example.com").status_code, 400)
        res = self.register(username="ana", email="ana@example.com", password="12345678")
        self.assertEqual(res.status_code, 400)
        self.assertIn("password", res.json())

    def test_login_with_username_or_email(self):
        self.register()
        for login in ["nihil", "NIHIL", "nihil@example.com"]:
            res = self.post("/api/auth/login/", {"login": login, "password": "dragoes-vermelhos-42"})
            self.assertEqual(res.status_code, 200, login)
        res = self.post("/api/auth/login/", {"login": "nihil", "password": "errada"})
        self.assertEqual(res.status_code, 400)

    def test_me_and_logout(self):
        token = self.register().json()["token"]
        res = self.client.get("/api/auth/me/", HTTP_AUTHORIZATION=f"Token {token}")
        self.assertEqual(res.json()["username"], "nihil")
        self.assertEqual(self.post("/api/auth/logout/", {}, token).status_code, 204)
        res = self.client.get("/api/auth/me/", HTTP_AUTHORIZATION=f"Token {token}")
        self.assertEqual(res.status_code, 401)

    def test_anonymous_me_is_401(self):
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
