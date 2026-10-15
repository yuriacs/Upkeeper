from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.authtoken.models import Token

from .browser import login as browser_login
from .browser import register as browser_register

User = get_user_model()


class AuthTests(TestCase):
    def setUp(self):
        cache.clear()

    def post(self, url, body, token=None):
        headers = {"HTTP_AUTHORIZATION": f"Token {token}"} if token else {}
        return self.client.post(url, body, content_type="application/json", **headers)

    def register(self, username="nihil", email="nihil@example.com", password="dragoes-vermelhos-42"):
        return browser_register(self.client, username, email, password)

    def test_register_returns_token(self):
        res = self.register()
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["user"]["username"], "nihil")
        self.assertTrue(res.json()["token"])

    def test_register_rejects_duplicates(self):
        self.register()
        self.assertEqual(self.register(email="outro@example.com").status_code, 400)  # usuário repetido
        res = self.register(username="NIHIL2", email=" NIHIL@Example.com ")  # e-mail repetido
        self.assertEqual(res.status_code, 400)
        self.assertIn("email", res.json())

    def test_register_requires_derived_key_and_vault(self):
        # O cliente antigo mandava a senha: não é mais aceito (a senha não pode chegar ao servidor)
        res = self.post("/api/auth/register/", {"username": "ana", "email": "ana@x.com", "password": "senha-forte-1"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("auth_key", res.json())
        self.assertFalse(User.objects.filter(username="ana").exists())

    def test_login_with_username_or_email(self):
        self.register()
        for login in ["nihil", "NIHIL", "nihil@example.com", " Nihil@Example.COM"]:
            res = browser_login(self.client, login, "dragoes-vermelhos-42")
            self.assertEqual(res.status_code, 200, login)
        self.assertEqual(browser_login(self.client, "nihil", "errada").status_code, 400)
        # Mandar a senha em vez da chave derivada não entra
        res = self.post("/api/auth/login/", {"login": "nihil", "password": "dragoes-vermelhos-42"})
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


class ResetHistoryTests(TestCase):
    def test_reset_requires_login_and_clears(self):
        from decks.models import Draw, DrawEntry

        user = User.objects.create_user("ana", "ana@example.com", "senha-forte-123")
        draw = Draw.objects.create(code="abc123")
        DrawEntry.objects.create(draw=draw, position=1, player_name="ana", player=user)
        self.assertEqual(self.client.post("/api/auth/me/history/reset/").status_code, 401)
        token = Token.objects.create(user=user)
        res = self.client.post("/api/auth/me/history/reset/", HTTP_AUTHORIZATION=f"Token {token.key}")
        self.assertEqual(res.json(), {"cleared": 1})
        self.assertFalse(DrawEntry.objects.get().in_history)


class LanguageTests(TestCase):
    def test_messages_follow_accept_language(self):
        body = {"login": "ninguem", "password": "x"}
        en = self.client.post("/api/auth/login/", body, content_type="application/json")
        self.assertEqual(en.json()["detail"], "Wrong username or password.")  # inglês é o padrão
        pt = self.client.post(
            "/api/auth/login/", body, content_type="application/json", HTTP_ACCEPT_LANGUAGE="pt-BR"
        )
        self.assertEqual(pt.json()["detail"], "Usuário ou senha incorretos.")


class LoginLockTests(TestCase):
    """Senhas erradas seguidas numa conta (de qualquer IP) bloqueiam o login dela por um tempo."""

    def setUp(self):
        cache.clear()
        User.objects.create_user("nihil", "nihil@example.com", "dragoes-vermelhos-42")

    def login(self, password, ip="1.1.1.1", login="nihil"):
        return self.client.post(
            "/api/auth/login/",
            {"login": login, "password": password},
            content_type="application/json",
            HTTP_X_FORWARDED_FOR=ip,
        )

    def test_wrong_passwords_lock_the_account_from_any_ip(self):
        with self.settings(LOGIN_MAX_FAILURES=3):
            for i in range(3):
                self.assertEqual(self.login("errada", ip=f"9.9.9.{i}").status_code, 400)
            # trocar de IP (ou inventar um) não adianta, e nem a senha certa entra enquanto bloqueado
            self.assertEqual(self.login("errada", ip="8.8.8.8").status_code, 429)
            self.assertEqual(self.login("dragoes-vermelhos-42", ip="7.7.7.7").status_code, 429)
            # o e-mail da mesma conta também conta como a mesma conta
            self.assertEqual(self.login("dragoes-vermelhos-42", login="nihil@example.com").status_code, 429)

    def test_success_resets_the_count(self):
        with self.settings(LOGIN_MAX_FAILURES=3):
            self.login("errada")
            self.login("errada")
            self.assertEqual(self.login("dragoes-vermelhos-42").status_code, 200)
            self.assertEqual(self.login("errada").status_code, 400)
            self.assertEqual(self.login("errada").status_code, 400)
            self.assertEqual(self.login("dragoes-vermelhos-42").status_code, 200)


class ClientIpTests(TestCase):
    def ip(self, xff, remote="10.0.0.1"):
        from django.test import RequestFactory

        from config.throttles import client_ip

        meta = {"REMOTE_ADDR": remote}
        if xff is not None:
            meta["HTTP_X_FORWARDED_FOR"] = xff
        return client_ip(RequestFactory().get("/", **meta))

    def test_trusted_proxies_ignores_invented_values(self):
        with self.settings(TRUSTED_PROXIES=1):
            self.assertEqual(self.ip("6.6.6.6, 1.2.3.4"), "1.2.3.4")  # o primeiro foi inventado
        with self.settings(TRUSTED_PROXIES=2):
            self.assertEqual(self.ip("6.6.6.6, 1.2.3.4, 172.16.0.9"), "1.2.3.4")
            self.assertEqual(self.ip("1.2.3.4"), "1.2.3.4")
        with self.settings(TRUSTED_PROXIES=0):
            self.assertEqual(self.ip(None), "10.0.0.1")
