from unittest import mock

from asgiref.sync import sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, TransactionTestCase
from rest_framework.authtoken.models import Token

from achievements import services
from achievements.catalog import GOALS, HOUR
from achievements.models import UserAchievement
from decks.models import Deck, Draw, Edition
from pools.models import UserDeck
from tables import consumers, state
from tables.routing import websocket_urlpatterns

User = get_user_model()
ROWS = [
    {"name": "Boss", "image": "", "quantity": 1, "is_commander": True, "type_line": "Legendary Creature"},
    {"name": "Bear", "image": "", "quantity": 99, "is_commander": False, "type_line": "Creature — Bear", "power": "2", "toughness": "2"},
]


def earned(uid) -> set[str]:
    return services.earned_keys(uid)


def game_table(players=(1, 2)) -> state.Table:
    t = state.Table(state.new_table("ACH1"))
    for uid in players:
        t.join(uid, f"p{uid}")
        t.load_deck(uid, {"kind": "precon", "ref": "x", "name": "X"}, ROWS)
        t.earned[uid] = set()
    return t


class TableTriggerTests(TestCase):
    def test_snake_eyes_needs_three_ones_in_a_row(self):
        t = game_table()
        with mock.patch.object(state._random, "randint", side_effect=[1, 1, 7, 1, 1, 1]):
            for _ in range(5):
                t.roll(1, 20)
            self.assertEqual(t.new_achievements, [])
            t.roll(1, 20)
        self.assertEqual(t.new_achievements, [(1, "snake_eyes")])
        self.assertEqual(t.data["log"][-1], {**t.data["log"][-1], "kind": "achievement", "key": "snake_eyes"})

    def test_other_dice_do_not_count(self):
        t = game_table()
        with mock.patch.object(state._random, "randint", return_value=1):
            for _ in range(3):
                t.roll(1, 6)
        self.assertEqual(t.new_achievements, [])

    def test_counters_creatures_and_empty_library(self):
        t = game_table()
        t.pass_turn(1)
        seat = t.seat_of(1)
        field = seat["zones"]["battlefield"]
        t.track_achievements()
        self.assertEqual(t.new_achievements, [])
        # 20 marcadores somados numa carta só
        t.counter(1, field[0]["id"], "+1/+1", 15)
        t.counter(1, field[0]["id"], "Charge", 5)
        # 10 criaturas (o comandante na zona do comandante não conta)
        for cid in seat["zones"]["library"][:9]:
            t.move(1, cid, "battlefield", 0.5, 0.5)
        t.track_achievements()
        self.assertEqual(t.new_achievements, [(1, "counter_hoarder")])
        t.move(1, seat["zones"]["library"][0], "battlefield", 0.5, 0.5)
        t.track_achievements()
        self.assertIn((1, "timmy"), t.new_achievements)
        seat["zones"]["library"].clear()
        t.track_achievements()
        self.assertIn((1, "library_empty"), t.new_achievements)
        # Uma vez só
        n = len(t.new_achievements)
        t.track_achievements()
        self.assertEqual(len(t.new_achievements), n)

    def test_nothing_before_the_game_starts_or_without_the_list(self):
        t = game_table()
        t.seat_of(1)["zones"]["library"].clear()
        t.track_achievements()  # ninguém passou o turno ainda
        self.assertEqual(t.new_achievements, [])
        t.pass_turn(1)
        del t.earned[1]  # lista ainda não carregada: não anuncia
        t.track_achievements()
        self.assertEqual(t.new_achievements, [])

    def test_summary_tracks_mulligan_low_life_turns_and_upkeeps(self):
        t = game_table()
        t.mulligan(2)
        t.pass_turn(1)  # turno 1: p1
        t.draw(1)
        t.draw(1)  # duas compras no mesmo turno contam uma
        t.change_life(2, -36)
        t.track_achievements()
        t.change_life(2, 30)
        t.pass_turn(1)  # turno 2: p2
        t.draw(1)  # fora do próprio turno não conta
        t.draw(2)
        t.track_achievements()
        t.end_game(1, 2)
        summary = t.game_summary()
        self.assertEqual(summary["winner"], 2)
        self.assertEqual(summary["players"], [1, 2])
        self.assertEqual(summary["seats"][1]["upkeeps"], 1)
        self.assertEqual(summary["seats"][1]["turns"], 1)
        self.assertEqual(summary["seats"][2], {**summary["seats"][2], "mulligan": True, "low": 4, "upkeeps": 1, "turns": 1})
        self.assertIsNone(t.game_summary())  # uma vez por partida
        t.new_game(1)
        self.assertIsNone(t.game_summary())  # partida nova ainda não começou

    def test_spectator_time(self):
        t = game_table()
        with mock.patch.object(state.time, "time", return_value=1000.0):
            t.watch(9, "viewer")
            t.watch(9, "viewer")  # segunda aba
        with mock.patch.object(state.time, "time", return_value=1600.0):
            self.assertEqual(t.unwatch(9), 0.0)
            self.assertEqual(t.unwatch(9), 600.0)


class RecordGameTests(TestCase):
    def setUp(self):
        cache.clear()
        self.users = [User.objects.create_user(f"u{i}", "", "x") for i in range(4)]
        self.ids = [u.id for u in self.users]
        ed = Edition.objects.create(code="T", name="T")
        self.mono = Deck.objects.create(name="Mono", slug="mono", edition=ed, color_identity="G")
        self.five = Deck.objects.create(name="Five", slug="five", edition=ed, color_identity="WUBRG")

    def summary(self, winner=None, seconds=600, decks=None, **seat):
        decks = decks or {}
        return {
            "players": self.ids,
            "seconds": seconds,
            "winner": winner,
            "seats": {
                uid: {
                    "deck": decks.get(uid, {"kind": "precon", "ref": "mono"}),
                    "mulligan": False, "low": 30, "turns": 8, "upkeeps": 7, **(seat if uid == winner else {}),
                }
                for uid in self.ids
            },
        }

    def test_winner_achievements(self):
        a = self.ids[0]
        got = services.record_game(self.summary(winner=a, mulligan=True, low=3, turns=5, seconds=2 * HOUR))
        self.assertEqual(
            {k for uid, k in got if uid == a},
            {"marathon", "mulligan_survivor", "speedrun", "comeback_kid"},
        )
        self.assertEqual(earned(self.ids[1]), {"marathon"})
        self.assertEqual(UserAchievement.objects.get(user_id=a, key="upkeeper").progress, 7)
        self.assertEqual(UserAchievement.objects.get(user_id=a, key="color_pie").progress, 1)
        services.record_game(self.summary(winner=a, decks={a: {"kind": "precon", "ref": "five"}}))
        self.assertIn("wubrg", earned(a))

    def test_color_pie_needs_the_five_mono_colors(self):
        a = self.ids[0]
        ed = Edition.objects.get(code="T")
        for c in "WUBR":
            Deck.objects.create(name=c, slug=f"m{c}", edition=ed, color_identity=c)
        for c in "WUBR":
            services.record_game(self.summary(winner=a, decks={a: {"kind": "precon", "ref": f"m{c}"}}))
            services.record_game(self.summary(winner=a, decks={a: {"kind": "precon", "ref": f"m{c}"}}))  # repetir não soma
        self.assertNotIn("color_pie", earned(a))
        services.record_game(self.summary(winner=a))  # verde
        self.assertIn("color_pie", earned(a))

    def test_borrowed_decks(self):
        a, b, c, outsider = self.ids[0], self.ids[1], self.ids[2], User.objects.create_user("z", "", "x")
        from_outside = UserDeck.objects.create(owner=outsider, name="Z", color_identity="UB")
        services.record_game(self.summary(winner=a, decks={a: {"kind": "user", "ref": str(from_outside.pk)}}))
        self.assertIn("not_my_deck", earned(a))
        self.assertNotIn("stolen_thunder", earned(a))
        bs = UserDeck.objects.create(owner=self.users[1], name="B", color_identity="R")
        services.record_game(self.summary(winner=c, decks={c: {"kind": "user", "ref": str(bs.pk)}}))
        self.assertTrue({"not_my_deck", "stolen_thunder"} <= earned(c))
        own = UserDeck.objects.create(owner=self.users[1], name="B2", color_identity="R")
        services.record_game(self.summary(winner=b, decks={b: {"kind": "user", "ref": str(own.pk)}}))
        self.assertNotIn("not_my_deck", earned(b))

    def test_playgroup_and_open_table(self):
        a = self.ids[0]
        for _ in range(9):
            services.record_game(self.summary())
        self.assertNotIn("playgroup", earned(a))
        services.record_game(self.summary())
        self.assertIn("playgroup", earned(a))
        others = [User.objects.create_user(f"o{i}", "", "x").id for i in range(17)]
        self.assertEqual(UserAchievement.objects.get(user_id=a, key="open_table").progress, 3)
        for i in range(17):
            services.record_game({"players": [a, others[i]], "seconds": 60, "winner": None, "seats": {}})
        self.assertIn("open_table", earned(a))
        self.assertEqual(UserAchievement.objects.get(user_id=a, key="open_table").data, {})

    def test_no_summary_or_single_player(self):
        self.assertEqual(services.record_game(None), [])
        self.assertEqual(services.record_game({"players": [self.ids[0]], "seats": {}}), [])

    def test_progress_watch_time_and_unseen(self):
        a = self.ids[0]
        for _ in range(3):
            self.assertFalse(services.add_watch_time(a, 20 * HOUR))  # uma sessão conta no máximo 12 h
        self.assertTrue(services.add_watch_time(a, 4 * HOUR))
        self.assertEqual(UserAchievement.objects.get(user_id=a, key="voyeur").progress, GOALS["voyeur"])
        for _ in range(24):
            services.add_progress(a, "host")
        self.assertTrue(services.add_progress(a, "host"))
        self.assertFalse(services.add_progress(a, "host"))
        auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.users[0]).key}"}
        self.assertEqual(self.client.get("/api/achievements/new/").status_code, 401)
        res = self.client.get("/api/achievements/new/", **auth).json()["achievements"]
        self.assertEqual([r["key"] for r in res], ["voyeur", "host"])
        res = self.client.post("/api/achievements/seen/", {"keys": ["voyeur"]}, content_type="application/json", **auth)
        self.assertEqual([r["key"] for r in res.json()["achievements"]], ["host"])

    def test_profile_lists_stored_achievements(self):
        a = self.ids[0]
        services.add_watch_time(a, 5 * HOUR)
        services.unlock(a, "timmy")
        data = self.client.get("/api/users/u0/").json()
        found = {x["key"]: x for x in data["achievements"]}
        self.assertEqual(found["voyeur"], {"key": "voyeur", "earned": False, "progress": 5, "goal": 40})
        self.assertTrue(found["timmy"]["earned"])
        self.assertEqual([x["key"] for x in data["achievements"]].count("shuffle_up"), 1)
        self.assertNotIn("builder", found)


class SignalTests(TransactionTestCase):
    def test_first_draw_first_deck_and_room(self):
        ana = User.objects.create_user("ana", "", "x")
        Draw.objects.create(code="SIG1", created_by=ana)
        UserDeck.objects.create(owner=ana, name="Mine")
        from rooms.services import create_room

        create_room("ana", ana, "precon", {})
        self.assertEqual(earned(ana.id), {"shuffle_up", "deckbuilders_pride"})
        self.assertEqual(UserAchievement.objects.get(user_id=ana.id, key="host").progress, 1)


class SocketTests(TransactionTestCase):
    def setUp(self):
        state.TABLES.clear()
        consumers._loading.clear()

    async def test_first_upkeep_and_host_on_sitting_down(self):
        user = await sync_to_async(User.objects.create_user)("ana", "", "x")
        token = await sync_to_async(lambda: Token.objects.create(user=user).key)()
        ws = WebsocketCommunicator(URLRouter(websocket_urlpatterns), "/ws/tables/ACHX/")
        await ws.connect()
        await ws.send_json_to({"type": "auth", "token": token})
        msg = await ws.receive_json_from()
        self.assertIn({"kind": "achievement", "key": "first_upkeep"}, [{k: e.get(k) for k in ("kind", "key")} for e in msg["log"]])
        await ws.disconnect()
        self.assertEqual(await sync_to_async(earned)(user.id), {"first_upkeep"})
        self.assertEqual(await sync_to_async(lambda: UserAchievement.objects.get(user=user, key="host").progress)(), 1)
