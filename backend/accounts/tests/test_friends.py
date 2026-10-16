from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token

from accounts.friends import are_friends, friend_ids

User = get_user_model()


class FriendsApiTests(TestCase):
    """Pedido pelo nome de usuário; o outro aceita ou recusa."""

    def setUp(self):
        self.ana = User.objects.create_user("ana", "", "x")
        self.beto = User.objects.create_user("Beto", "", "x")
        self.caio = User.objects.create_user("caio", "", "x")

    def call(self, user, method, path, body=None):
        token = Token.objects.get_or_create(user=user)[0].key
        fn = getattr(self.client, method)
        return fn(f"/api/auth/friends/{path}", body or {}, content_type="application/json", HTTP_AUTHORIZATION=f"Token {token}")

    def test_request_accept_and_remove(self):
        res = self.call(self.ana, "post", "", {"username": "beto"})  # sem diferenciar maiúsculas
        self.assertEqual(res.status_code, 201)
        self.assertEqual([o["username"] for o in res.json()["outgoing"]], ["Beto"])
        incoming = self.call(self.beto, "get", "").json()["incoming"]
        self.assertEqual([i["username"] for i in incoming], ["ana"])
        self.assertFalse(are_friends(self.ana.id, self.beto.id))
        res = self.call(self.beto, "post", f"{incoming[0]['id']}/accept/")
        self.assertEqual([f["username"] for f in res.json()["friends"]], ["ana"])
        self.assertTrue(are_friends(self.beto.id, self.ana.id))
        self.assertEqual(friend_ids(self.ana.id), {self.beto.id})
        self.call(self.ana, "delete", f"{incoming[0]['id']}/")
        self.assertFalse(are_friends(self.ana.id, self.beto.id))

    def test_crossed_requests_become_friendship(self):
        self.call(self.ana, "post", "", {"username": "caio"})
        res = self.call(self.caio, "post", "", {"username": "ana"})
        self.assertEqual([f["username"] for f in res.json()["friends"]], ["ana"])

    def test_errors(self):
        self.assertEqual(self.call(self.ana, "post", "", {"username": "ninguem"}).status_code, 404)
        self.assertEqual(self.call(self.ana, "post", "", {"username": "ana"}).json()["code"], "self")
        self.call(self.ana, "post", "", {"username": "beto"})
        self.assertEqual(self.call(self.ana, "post", "", {"username": "beto"}).json()["code"], "already_sent")
        # só quem recebeu aceita; outra pessoa não mexe no pedido
        pending = self.call(self.beto, "get", "").json()["incoming"][0]["id"]
        self.assertEqual(self.call(self.ana, "post", f"{pending}/accept/").status_code, 404)
        self.call(self.caio, "delete", f"{pending}/")
        self.assertEqual(len(self.call(self.beto, "get", "").json()["incoming"]), 1)
        self.assertEqual(self.client.get("/api/auth/friends/").status_code, 401)
