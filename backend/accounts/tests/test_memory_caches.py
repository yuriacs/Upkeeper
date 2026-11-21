from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from accounts import auth, friends
from accounts.models import Friendship
from achievements import services
from achievements.models import UserAchievement

User = get_user_model()


class MemoryCacheTests(TestCase):
    def setUp(self):
        auth.clear()
        friends.forget_rows()
        self.ana = User.objects.create_user("ana", password="x")
        self.bia = User.objects.create_user("bia", password="x")
        self.token = Token.objects.create(user=self.ana)
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION=f"Token {self.token.key}")

    def tearDown(self):
        auth.clear()
        friends.forget_rows()

    def test_token_is_read_once(self):
        self.assertEqual(self.api.get("/api/achievements/new/").status_code, 200)
        self.assertEqual(self.api.get("/api/auth/friends/").status_code, 200)
        with CaptureQueriesContext(connection) as queries:
            self.assertEqual(self.api.get("/api/achievements/new/").status_code, 200)
            self.assertEqual(self.api.get("/api/auth/friends/").status_code, 200)
        # Nem o token, nem as conquistas, nem as amizades: tudo da memória
        self.assertEqual(len(queries), 0, [q["sql"] for q in queries])

    def test_logout_and_suspension_take_effect_at_once(self):
        self.assertEqual(self.api.get("/api/auth/friends/").status_code, 200)
        self.token.delete()
        self.assertEqual(self.api.get("/api/auth/friends/").status_code, 401)
        token = Token.objects.create(user=self.ana)
        self.api.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        self.assertEqual(self.api.get("/api/auth/friends/").status_code, 200)
        self.ana.is_active = False
        self.ana.save()
        self.assertEqual(self.api.get("/api/auth/friends/").status_code, 401)

    def test_friend_changes_show_up_right_away(self):
        self.assertEqual(self.api.get("/api/auth/friends/").json()["incoming"], [])
        row = Friendship.objects.create(from_user=self.bia, to_user=self.ana)
        self.assertEqual([i["username"] for i in self.api.get("/api/auth/friends/").json()["incoming"]], ["bia"])
        row.delete()
        self.assertEqual(self.api.get("/api/auth/friends/").json()["incoming"], [])

    def test_new_achievement_clears_the_unseen_cache(self):
        self.assertEqual(services.unseen(self.ana.id), [])
        batch = services.Batch([self.ana.id], ["first_upkeep"])
        batch.unlock(self.ana.id, "first_upkeep")
        batch.save()
        self.assertEqual([a["key"] for a in services.unseen(self.ana.id)], ["first_upkeep"])
        services.mark_seen(self.ana.id, ["first_upkeep"])
        self.assertEqual(services.unseen(self.ana.id), [])
        self.assertTrue(UserAchievement.objects.get(user=self.ana, key="first_upkeep").seen)
