from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token

User = get_user_model()
SOL = "6ad8011d-3471-4369-9d68-b264cc027487"
SWORDS = "b1544f21-7e98-461b-aed5-e748b0168c52"


class FavoriteCardsTests(TestCase):
    def setUp(self):
        self.ana = User.objects.create_user("ana", "", "x")
        self.auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.ana).key}"}

    def test_add_list_remove(self):
        for oid in (SOL, SWORDS, SOL):  # marcar de novo não duplica
            self.assertEqual(self.client.put(f"/api/me/favorite-cards/{oid}/", **self.auth).status_code, 204)
        ids = self.client.get("/api/me/favorite-cards/", **self.auth).json()["oracle_ids"]
        self.assertEqual(sorted(ids), sorted([SOL, SWORDS]))
        self.client.delete(f"/api/me/favorite-cards/{SOL}/", **self.auth)
        self.assertEqual(self.client.get("/api/me/favorite-cards/", **self.auth).json()["oracle_ids"], [SWORDS])

    def test_needs_login_and_valid_id(self):
        self.assertEqual(self.client.get("/api/me/favorite-cards/").status_code, 401)
        self.assertEqual(self.client.put("/api/me/favorite-cards/nao-e-uuid/", **self.auth).status_code, 404)
