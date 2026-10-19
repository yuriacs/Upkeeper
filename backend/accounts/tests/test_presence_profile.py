from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token

from accounts import presence
from accounts.models import Friendship
from tables import state

User = get_user_model()


class PresenceInviteTests(TestCase):
    def setUp(self):
        presence.reset()
        state.TABLES.clear()
        self.ana = User.objects.create_user("ana", "", "x")
        self.beto = User.objects.create_user("beto", "", "x")
        self.caio = User.objects.create_user("caio", "", "x")
        Friendship.objects.create(from_user=self.ana, to_user=self.beto, accepted=True, accepted_at=timezone.now())

    def tearDown(self):
        state.TABLES.clear()
        presence.reset()

    def call(self, user, method, path, body=None):
        token = Token.objects.get_or_create(user=user)[0].key
        fn = getattr(self.client, method)
        return fn(f"/api/auth/friends/{path}", body or {}, content_type="application/json", HTTP_AUTHORIZATION=f"Token {token}")

    def test_online_table_and_invite(self):
        friends = self.call(self.ana, "get", "").json()["friends"]
        self.assertEqual((friends[0]["username"], friends[0]["online"]), ("beto", False))
        table = state.Table(state.new_table("INV1"))
        state.TABLES["INV1"] = table
        table.join(self.ana.id, "ana")
        friend = self.call(self.beto, "get", "").json()["friends"][0]
        self.assertEqual((friend["online"], friend["table"]), (True, "INV1"))  # conectada à mesa
        # Só convida amigo, e só para a mesa em que está sentado
        self.assertEqual(self.call(self.ana, "post", "invite/", {"username": "caio", "code": "INV1"}).status_code, 403)
        self.assertEqual(self.call(self.beto, "post", "invite/", {"username": "ana", "code": "INV1"}).status_code, 400)
        self.assertEqual(self.call(self.ana, "post", "invite/", {"username": "beto", "code": "inv1"}).status_code, 204)
        invites = self.call(self.beto, "get", "").json()["invites"]
        self.assertEqual([(i["from"], i["code"]) for i in invites], [("ana", "INV1")])
        left = self.call(self.beto, "delete", f"invites/{invites[0]['id']}/").json()["invites"]
        self.assertEqual(left, [])


class PublicProfileTests(TestCase):
    def setUp(self):
        cache.clear()
        self.ana = User.objects.create_user("Ana", "", "x")

    def test_profile_and_achievements(self):
        res = self.client.get("/api/users/ana/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual((data["username"], data["stats"]["games"]), ("Ana", 0))
        earned = {a["key"]: a["earned"] for a in data["achievements"]}
        self.assertFalse(earned["first_game"])
        self.assertNotIn("email", str(data))
        self.assertEqual(self.client.get("/api/users/ninguem/").status_code, 404)
