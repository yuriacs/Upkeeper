from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token

from accounts.serializers import profile_of
from decks.models import Card, Deck, DeckCard, Edition
from social import drafts
from social.feed import week_feed
from social.models import SocialPost
from tables import store

User = get_user_model()


class SocialTests(TestCase):
    def setUp(self):
        ed = Edition.objects.create(code="SOC", name="Social")
        self.cards = []
        for i, name in enumerate(["Giada, Font of Hope", "Lathliss, Dragon Queen"]):
            c = Card.objects.create(scryfall_id=f"00000000-0000-0000-0000-{i:012d}", name=name, type_line="Creature",
                                    image_art_crop=f"https://cards.scryfall.io/art/{i}.jpg", price_usd=Decimal("2.00"))
            self.cards.append(c)
        self.angels = Deck.objects.create(name="Anjos", slug="anjos", edition=ed, face_commander=self.cards[0],
                                          bracket=2, price_usd=Decimal("50.00"))
        self.dragons = Deck.objects.create(name="Dragões", slug="dragoes", edition=ed, face_commander=self.cards[1],
                                           bracket=2, price_usd=Decimal("60.00"))
        DeckCard.objects.create(deck=self.angels, card=self.cards[0], quantity=1)
        self.ana = User.objects.create_user("ana", "", "x")
        self.beto = User.objects.create_user("beto", "", "x")
        self.admin = User.objects.create_user("admin", "", "x", is_staff=True)
        store.save_table_result.func({
            "seats": {
                "1": {"user_id": self.ana.id, "deck": {"kind": "precon", "ref": "anjos"}},
                "2": {"user_id": self.beto.id, "deck": {"kind": "precon", "ref": "dragoes"}},
            },
            "result": {"winner": self.ana.id, "turn": 7},
        }, None)

    def auth(self, user):
        return {"HTTP_AUTHORIZATION": f"Token {Token.objects.get_or_create(user=user)[0].key}"}

    def test_feed_only_shows_players_who_opted_in(self):
        data = week_feed()
        self.assertEqual(data["numbers"]["games"], 1)
        self.assertEqual(data["top_commanders"][0]["name"], "Giada, Font of Hope")
        self.assertEqual(data["top_players"], [])
        p = profile_of(self.ana)
        p.social_opt_in = True
        p.save()
        self.assertEqual([x["username"] for x in week_feed()["top_players"]], ["ana"])
        self.assertIsNotNone(data["featured_precon"])

    def test_generate_drafts_and_x_limit(self):
        res = self.client.post("/api/admin/social/posts/generate/", {"kind": "ranking", "network": "both"},
                               content_type="application/json", **self.auth(self.admin))
        self.assertEqual(res.status_code, 201)
        posts = {p["network"]: p for p in res.json()}
        self.assertLessEqual(len(posts["x"]["text"]), drafts.X_LIMIT)
        self.assertNotIn("http", posts["x"]["text"])
        self.assertEqual(len(posts["instagram"]["slides"]), 2)
        self.assertIn("#MTG", posts["instagram"]["text"])
        pid = posts["x"]["id"]
        res = self.client.patch(f"/api/admin/social/posts/{pid}/", {"status": "published"},
                                content_type="application/json", **self.auth(self.admin))
        self.assertIsNotNone(res.json()["published_at"])
        self.assertEqual(SocialPost.objects.count(), 2)

    def test_only_admins(self):
        self.assertEqual(self.client.get("/api/admin/social/feed/", **self.auth(self.ana)).status_code, 403)
        self.assertEqual(self.client.get("/api/admin/social/feed/", **self.auth(self.admin)).status_code, 200)

    def test_social_opt_in_endpoint(self):
        res = self.client.put("/api/auth/me/social/", {"opt_in": True}, content_type="application/json", **self.auth(self.ana))
        self.assertTrue(res.json()["social_opt_in"])
