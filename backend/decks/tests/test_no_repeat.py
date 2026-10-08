import random

from django.contrib.auth import get_user_model
from django.test import TestCase

from decks.models import Deck, DrawEntry, Edition
from decks.services.draw import DrawError, create_draw, create_pool_draw
from pools.models import OwnedPrecon
from rooms.models import Room

User = get_user_model()


class NoRepeatTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        ed = Edition.objects.create(code="AAA", name="A")
        cls.decks = [
            Deck.objects.create(name=f"D{i}", slug=f"d{i}", edition=ed, color_identity=c) for i, c in enumerate("WUBRG")
        ]
        cls.ana = User.objects.create_user("ana", "ana@example.com", "senha-forte-123")
        cls.beto = User.objects.create_user("beto", "beto@example.com", "senha-forte-123")

    def received(self, name):
        return set(DrawEntry.objects.filter(player_name__iexact=name).values_list("deck_id", flat=True))

    def test_logged_users_never_repeat_until_exhausted(self):
        # 5 decks, 2 jogadores: cada um pode receber no máximo 5 decks diferentes
        for seed in range(5):
            create_draw(["ana", "beto"], {"no_repeat": True}, random.Random(seed), users=[self.ana, self.beto])
            for user in (self.ana, self.beto):
                got = list(DrawEntry.objects.filter(player=user).values_list("deck_id", flat=True))
                self.assertEqual(len(got), len(set(got)), user)
        with self.assertRaises(DrawError) as ctx:
            create_draw(["ana", "beto"], {"no_repeat": True}, random.Random(9), users=[self.ana, self.beto])
        self.assertIn("não repetir", ctx.exception.args[0])

    def test_without_filter_repeats_are_allowed(self):
        for seed in range(8):
            create_draw(["ana", "beto"], {}, random.Random(seed), users=[self.ana, self.beto])
        self.assertEqual(DrawEntry.objects.filter(player=self.ana).count(), 8)

    def test_anonymous_history_is_scoped_to_room(self):
        room = Room.objects.create(code="sala1")
        other = Room.objects.create(code="sala2")
        for seed in range(5):
            create_draw(["Caio", "Duda"], {"no_repeat": True}, random.Random(seed), room=room)
        got = list(DrawEntry.objects.filter(draw__room=room, player_name="Caio").values_list("deck_id", flat=True))
        self.assertEqual(len(got), len(set(got)))
        # Outra sala, mesmo nome: começa do zero
        create_draw(["Caio", "Duda"], {"no_repeat": True}, random.Random(0), room=other)

    def test_anonymous_history_by_creator(self):
        for seed in range(5):
            create_draw(["Caio"] + ["Duda"], {"no_repeat": True}, random.Random(seed), creator=self.ana)
        got = list(
            DrawEntry.objects.filter(draw__created_by=self.ana, player_name="Caio").values_list("deck_id", flat=True)
        )
        self.assertEqual(len(got), len(set(got)))

    def test_pool_no_repeat(self):
        for d in self.decks[:3]:
            OwnedPrecon.objects.create(user=self.ana, deck=d)
        for d in self.decks[3:]:
            OwnedPrecon.objects.create(user=self.beto, deck=d)
        # beto só pode receber decks da ana (3); depois disso esgota
        for seed in range(2):
            create_pool_draw(self.ana, [self.ana, self.beto], {"no_repeat": True}, random.Random(seed))
        got = list(DrawEntry.objects.filter(player=self.ana).values_list("deck_id", flat=True))
        self.assertEqual(len(got), len(set(got)))
        with self.assertRaises(DrawError):
            create_pool_draw(self.ana, [self.ana, self.beto], {"no_repeat": True}, random.Random(5))
