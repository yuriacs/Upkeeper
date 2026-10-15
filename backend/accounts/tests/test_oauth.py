from unittest import mock
from urllib.parse import parse_qs, urlsplit

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token

from accounts import oauth
from accounts.models import SocialAccount
from accounts.privacy import email_digest

User = get_user_model()
CLIENTS = {"google": {"id": "gid", "secret": "gsecret"}, "discord": {"id": "did", "secret": "dsecret"}}


@override_settings(OAUTH_CLIENTS=CLIENTS, FRONTEND_URL="https://site.test")
class OAuthTests(TestCase):
    def setUp(self):
        cache.clear()

    def post(self, url, body, token=None):
        headers = {"HTTP_AUTHORIZATION": f"Token {token}"} if token else {}
        return self.client.post(url, body, content_type="application/json", **headers)

    def begin(self, provider="google", mode="login", token=None):
        res = self.post(f"/api/auth/oauth/{provider}/start/", {"mode": mode}, token)
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()
        state = parse_qs(urlsplit(data["url"]).query)["state"][0]
        return state, data["nonce"], data["url"]

    def finish(self, profile, provider="google", state=None, nonce=None, token=None, mode="login"):
        if state is None:
            state, nonce, _ = self.begin(provider, mode, token)
        with mock.patch.object(oauth, "fetch_profile", return_value=profile) as fetch:
            res = self.post(
                f"/api/auth/oauth/{provider}/complete/", {"code": "abc", "state": state, "nonce": nonce}, token
            )
        return res, fetch

    def test_providers_and_start_url(self):
        self.assertEqual(self.client.get("/api/auth/oauth/providers/").json()["providers"], ["google", "discord"])
        _, nonce, url = self.begin()
        self.assertTrue(url.startswith("https://accounts.google.com/o/oauth2/v2/auth?"))
        self.assertIn("redirect_uri=https%3A%2F%2Fsite.test%2Fentrar%2Fsocial%2Fgoogle", url)
        self.assertTrue(nonce)
        with self.settings(OAUTH_CLIENTS={"google": {"id": "", "secret": ""}}):
            self.assertEqual(self.client.get("/api/auth/oauth/providers/").json()["providers"], [])
            res = self.post("/api/auth/oauth/google/start/", {})
            self.assertEqual(res.json()["code"], "not_configured")

    def test_first_login_creates_account_then_logs_in(self):
        profile = {"uid": "g-1", "email": "ana@gmail.com", "name": "Ana Lúcia"}
        res, _ = self.finish(profile)
        self.assertEqual(res.status_code, 201)
        user = User.objects.get(private__email_digest=email_digest("ana@gmail.com"))
        self.assertEqual(user.email, "")  # só a impressão digital
        self.assertEqual(user.username, "Ana_Lucia")
        self.assertFalse(user.has_usable_password())
        self.assertEqual(res.json()["user"]["social"], ["google"])
        self.assertFalse(res.json()["user"]["has_password"])
        # segunda vez: mesma conta
        res, _ = self.finish(profile)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(User.objects.count(), 1)

    def test_state_needs_the_same_browser_nonce(self):
        state, _, _ = self.begin()
        res, fetch = self.finish({"uid": "x", "email": "", "name": "x"}, state=state, nonce="outro")
        self.assertEqual(res.json()["code"], "invalid_state")
        fetch.assert_not_called()
        # state de outro serviço também não vale
        res, _ = self.finish({"uid": "x", "email": "", "name": "x"}, provider="discord", state=state, nonce="n")
        self.assertEqual(res.json()["code"], "invalid_state")

    def test_existing_email_is_not_merged_automatically(self):
        User.objects.create_user("nihil", "nihil@gmail.com", "senha-forte-123")
        res, _ = self.finish({"uid": "g-2", "email": "nihil@gmail.com", "name": "Nihil"})
        self.assertEqual(res.json()["code"], "email_in_use")
        self.assertFalse(SocialAccount.objects.exists())

    def test_connect_from_account_page(self):
        user = User.objects.create_user("nihil", "nihil@gmail.com", "senha-forte-123")
        token = Token.objects.create(user=user).key
        # ligar exige login
        self.assertEqual(self.post("/api/auth/oauth/discord/start/", {"mode": "connect"}).status_code, 401)
        res, _ = self.finish({"uid": "d-1", "email": "", "name": "nihil"}, "discord", token=token, mode="connect")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["user"]["social"], ["discord"])
        # agora o Discord entra direto nesta conta
        res, _ = self.finish({"uid": "d-1", "email": "", "name": "nihil"}, "discord")
        self.assertEqual(res.json()["user"]["username"], "nihil")
        # o mesmo Discord não liga em outra conta
        other = User.objects.create_user("beto", "beto@x.com", "senha-forte-123")
        res, _ = self.finish(
            {"uid": "d-1", "email": "", "name": "x"}, "discord", token=Token.objects.create(user=other).key,
            mode="connect",
        )
        self.assertEqual(res.json()["code"], "already_linked")

    def test_connect_state_is_bound_to_the_account(self):
        ana = User.objects.create_user("ana", "ana@x.com", "senha-forte-123")
        beto = User.objects.create_user("beto", "beto@x.com", "senha-forte-123")
        state, nonce, _ = self.begin("google", "connect", Token.objects.create(user=ana).key)
        res, _ = self.finish(
            {"uid": "g-9", "email": "", "name": "x"}, state=state, nonce=nonce,
            token=Token.objects.create(user=beto).key,
        )
        self.assertEqual(res.json()["code"], "invalid_state")

    def test_unverified_email_is_not_saved_and_usernames_are_unique(self):
        User.objects.create_user("Ana", "a@x.com", "senha-forte-123")
        with mock.patch.object(oauth, "_http") as http:
            http.side_effect = [
                {"access_token": "t"},
                {"id": "77", "email": "fake@x.com", "verified": False, "global_name": "Ana"},
            ]
            profile = oauth.fetch_profile("discord", "code")
        self.assertEqual(profile, {"uid": "77", "email": "", "name": "Ana"})
        res, _ = self.finish(profile, "discord")
        self.assertEqual(res.json()["user"]["username"], "Ana2")
        self.assertFalse(res.json()["user"]["has_email"])

    def test_delete_account_without_password(self):
        res, _ = self.finish({"uid": "g-5", "email": "eva@gmail.com", "name": "Eva"})
        token = res.json()["token"]
        headers = {"HTTP_AUTHORIZATION": f"Token {token}"}
        res = self.client.delete("/api/auth/me/", {"confirm": "outra"}, content_type="application/json", **headers)
        self.assertEqual(res.status_code, 400)
        res = self.client.delete("/api/auth/me/", {"confirm": "eva"}, content_type="application/json", **headers)
        self.assertEqual(res.status_code, 204)
        self.assertFalse(User.objects.exists())
        self.assertFalse(SocialAccount.objects.exists())
