import random

from asgiref.sync import sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from tables import consumers, state
from tables.routing import websocket_urlpatterns
from tournaments import services
from tournaments.models import Match, Tournament


def make_users(n, prefix="p"):
    User = get_user_model()
    return [User.objects.create_user(username=f"{prefix}{i}", email=f"{prefix}{i}@x.com", password="pw-123456") for i in range(n)]


def make_tournament(organizer, kind="bracket", **extra):
    return services.create(organizer, {"name": "Copa", "kind": kind, **extra})


def fill(t, users):
    for u in users:
        services.join(t, u, set())


def bracket(t, r):
    return list(t.matches.filter(round=r).order_by("slot"))


def win(t, match):
    """O lado de cima da partida ganha."""
    services.set_result(t, match, [match.seats.order_by("side").first().entry])
    t.refresh_from_db()


class PodSizesTests(TestCase):
    def test_pods_of_four_and_three(self):
        self.assertEqual(services.pod_sizes(4), [4])
        self.assertEqual(services.pod_sizes(3), [3])
        self.assertEqual(services.pod_sizes(6), [3, 3])
        self.assertEqual(services.pod_sizes(7), [4, 3])
        self.assertEqual(services.pod_sizes(9), [3, 3, 3])
        self.assertEqual(services.pod_sizes(10), [4, 3, 3])
        self.assertIsNone(services.pod_sizes(5))
        self.assertIsNone(services.pod_sizes(2))


class BracketTests(TestCase):
    def setUp(self):
        self.users = make_users(5)
        self.t = make_tournament(self.users[0])
        fill(self.t, self.users)

    def test_five_players_get_three_byes_and_a_champion(self):
        services.start(self.t, random.Random(1))
        self.t.refresh_from_db()
        self.assertEqual(self.t.status, Tournament.RUNNING)
        self.assertEqual(self.t.rounds, 3)  # chave de 8
        first = bracket(self.t, 1)
        self.assertEqual(len(first), 4)
        self.assertEqual(sum(m.done for m in first), 3)  # 3 byes já resolvidos
        self.assertEqual(self.t.matches.count(), 4 + 2 + 1)
        # Só a partida real da 1ª rodada fica em aberto
        open_match = next(m for m in first if not m.done)
        self.assertEqual(open_match.seats.count(), 2)
        win(self.t, open_match)
        while self.t.status == Tournament.RUNNING:
            m = self.t.matches.filter(done=False).order_by("round", "slot").first()
            win(self.t, m)
        self.assertEqual(self.t.status, Tournament.FINISHED)
        final = bracket(self.t, 3)[0]
        self.assertEqual(self.t.champion_id, final.winner_id)

    def test_correction_blocked_after_next_match(self):
        services.start(self.t, random.Random(2))
        self.t.refresh_from_db()
        m = self.t.matches.filter(round=1, done=False).first()
        a, b = [s.entry for s in m.seats.order_by("side")]
        services.set_result(self.t, m, [a])
        # Corrigir troca quem foi para a próxima rodada
        services.set_result(self.t, m, [b])
        nxt = self.t.matches.get(round=2, slot=m.slot // 2)
        self.assertIn(b.pk, nxt.seats.values_list("entry_id", flat=True))
        self.assertNotIn(a.pk, nxt.seats.values_list("entry_id", flat=True))
        win(self.t, nxt)
        with self.assertRaises(services.TournamentError) as err:
            services.set_result(self.t, m, [a])
        self.assertEqual(err.exception.code, "locked")

    def test_drop_gives_walkover(self):
        services.start(self.t, random.Random(3))
        self.t.refresh_from_db()
        m = self.t.matches.filter(round=1, done=False).first()
        a, b = [s.entry for s in m.seats.order_by("side")]
        services.drop(self.t, a)
        m.refresh_from_db()
        self.assertTrue(m.done)
        self.assertEqual(m.winner_id, b.pk)

    def test_report_from_table_only_once(self):
        services.start(self.t, random.Random(4))
        m = Match.objects.filter(tournament=self.t, round=1, done=False).first()
        a, b = [s.entry for s in m.seats.order_by("side")]
        self.assertTrue(services.report_from_table(m.pk, b.user_id, None))
        self.assertFalse(services.report_from_table(m.pk, a.user_id, None))  # já encerrada
        m.refresh_from_db()
        self.assertEqual(m.winner_id, b.pk)

    def test_report_ignores_outsider(self):
        services.start(self.t, random.Random(4))
        m = Match.objects.filter(tournament=self.t, round=1, done=False).first()
        outsider = make_users(1, "x")[0]
        self.assertFalse(services.report_from_table(m.pk, outsider.id, None))


class PairsTests(TestCase):
    def test_pairs_formed_at_start(self):
        users = make_users(6)
        t = make_tournament(users[0], team_size=2)
        self.assertEqual(t.team_size, 2)
        fill(t, users)
        services.start(t, random.Random(5))
        t.refresh_from_db()
        teams = list(t.entries.all())
        self.assertEqual(len(teams), 3)
        self.assertTrue(all(e.partner_id for e in teams))
        self.assertEqual(sorted(u for e in teams for u in e.user_ids()), sorted(u.id for u in users))
        self.assertEqual(t.rounds, 2)

    def test_odd_players_cannot_start(self):
        users = make_users(5)
        t = make_tournament(users[0], team_size=2)
        fill(t, users)
        with self.assertRaises(services.TournamentError) as err:
            services.start(t)
        self.assertEqual(err.exception.code, "pairs_players")


class LeagueTests(TestCase):
    def setUp(self):
        self.users = make_users(7)
        self.t = make_tournament(self.users[0], kind="league", rounds=2)
        fill(self.t, self.users)

    def play_round(self):
        for m in self.t.matches.filter(round=self.t.round, done=False):
            entries = [s.entry for s in m.seats.order_by("side")]
            services.set_result(self.t, m, entries)
            self.t.refresh_from_db()

    def test_rounds_points_and_champion(self):
        services.start(self.t, random.Random(6))
        self.t.refresh_from_db()
        self.assertEqual(self.t.round, 1)
        sizes = sorted(m.seats.count() for m in self.t.matches.filter(round=1))
        self.assertEqual(sizes, [3, 4])
        self.play_round()
        self.assertEqual(self.t.round, 2)  # rodada nova sorteada sozinha
        self.assertEqual(self.t.matches.filter(round=2).count(), 2)
        self.play_round()
        self.assertEqual(self.t.status, Tournament.FINISHED)
        table = services.standings(self.t)
        self.assertEqual(sum(r["points"] for r in table), 2 * ((3 + 2 + 1 + 0) + (3 + 2 + 1)))
        self.assertEqual(self.t.champion_id, table[0]["entry"])

    def test_absent_player_scores_nothing(self):
        services.start(self.t, random.Random(7))
        m = self.t.matches.filter(round=1).order_by("-slot").first()
        entries = [s.entry for s in m.seats.order_by("side")]
        user_order = [e.user_id for e in entries[:-1]]  # o último não apareceu
        self.assertTrue(services.report_from_table(m.pk, user_order[0], user_order))
        absent = m.seats.get(entry=entries[-1])
        self.assertIsNone(absent.place)
        self.assertEqual(m.seats.get(entry=entries[0]).place, 1)

    def test_five_players_cannot_start(self):
        t = make_tournament(self.users[1], kind="league", rounds=1)
        fill(t, self.users[:5])
        with self.assertRaises(services.TournamentError) as err:
            services.start(t)
        self.assertEqual(err.exception.code, "league_players")


class ApiTests(TestCase):
    def setUp(self):
        self.users = make_users(3)
        self.client = APIClient()

    def as_user(self, user):
        self.client.force_authenticate(user)

    def test_create_join_start_and_detail(self):
        self.as_user(self.users[0])
        res = self.client.post("/api/tournaments/", {"name": "  Copa  da  casa ", "kind": "bracket", "max_bracket": 3}, format="json")
        self.assertEqual(res.status_code, 201)
        pk = res.json()["id"]
        t = Tournament.objects.get(pk=pk)
        self.assertEqual(t.name, "Copa da casa")
        self.assertEqual(t.rules["bracket"], 3)
        for u in self.users:
            self.as_user(u)
            self.assertEqual(self.client.post(f"/api/tournaments/{pk}/join/").status_code, 200)
        self.as_user(self.users[1])
        self.assertEqual(self.client.post(f"/api/tournaments/{pk}/start/").status_code, 403)
        self.as_user(self.users[0])
        data = self.client.post(f"/api/tournaments/{pk}/start/").json()
        self.assertEqual(data["status"], "running")
        self.assertEqual(len(data["entries"]), 3)
        listing = self.client.get("/api/tournaments/").json()["tournaments"]
        self.assertEqual(listing[0]["id"], pk)
        self.assertTrue(listing[0]["joined"])

    def test_friends_only_hidden_and_closed(self):
        t = make_tournament(self.users[0], friends_only=True)
        self.as_user(self.users[1])
        self.assertEqual(self.client.get("/api/tournaments/").json()["tournaments"], [])
        res = self.client.post(f"/api/tournaments/{t.pk}/join/")
        self.assertEqual(res.json()["code"], "friends_only")

    def test_organizer_sets_result(self):
        t = make_tournament(self.users[0])
        fill(t, self.users[:2])
        services.start(t)
        m = t.matches.get()
        loser = m.seats.order_by("side").first().entry
        winner = m.seats.order_by("side").last().entry
        self.as_user(self.users[0])
        data = self.client.post(f"/api/tournaments/{t.pk}/matches/{m.pk}/result/", {"order": [winner.pk]}, format="json").json()
        self.assertEqual(data["status"], "finished")
        self.assertEqual(data["champion"], winner.pk)
        self.assertNotEqual(loser.pk, winner.pk)

    def test_limit_of_active_tournaments(self):
        self.as_user(self.users[0])
        for _ in range(services.ACTIVE_PER_USER):
            self.client.post("/api/tournaments/", {"name": "x", "kind": "bracket"}, format="json")
        res = self.client.post("/api/tournaments/", {"name": "x", "kind": "bracket"}, format="json")
        self.assertEqual(res.json()["code"], "too_many")


app = URLRouter(websocket_urlpatterns)


class TournamentTableTests(TransactionTestCase):
    """A mesa da partida: só senta quem está nela, e o fim confirmado avança o torneio."""

    def setUp(self):
        state.TABLES.clear()
        consumers._loading.clear()

    async def open(self, user, code):
        token = await sync_to_async(lambda: Token.objects.get_or_create(user=user)[0].key)()
        ws = WebsocketCommunicator(app, f"/ws/tables/{code}/")
        connected, _ = await ws.connect()
        self.assertTrue(connected)
        await ws.send_json_to({"type": "auth", "token": token})
        return ws

    async def latest(self, ws):
        msg = await ws.receive_json_from()
        while not await ws.receive_nothing(timeout=0.05):
            msg = await ws.receive_json_from()
        return msg

    async def until_closed(self, ws):
        """A partida confirmada fecha a mesa: lê até a conexão fechar."""
        while (await ws.receive_output(timeout=2))["type"] != "websocket.close":
            pass

    def setup_league(self):
        users = make_users(4)
        t = make_tournament(users[0], kind="league", rounds=1)
        fill(t, users)
        services.start(t, random.Random(8))
        return users, t, t.matches.get()

    async def test_only_pod_players_sit_and_placings_count(self):
        users, t, match = await sync_to_async(self.setup_league)()
        outsider = (await sync_to_async(make_users)(1, "x"))[0]
        ws_out = await self.open(outsider, match.code)
        msg = await ws_out.receive_json_from()
        self.assertEqual(msg, {"type": "bye", "code": 4412, "watch": True})  # não está na partida: não senta
        sockets = [await self.open(u, match.code) for u in users]
        for ws in sockets:
            await self.latest(ws)
        table = state.TABLES[match.code]
        self.assertEqual(table.options()["tournament"]["kind"], "league")
        ids = [u.id for u in users]
        # Liga: sem a ordem de todos, não dá
        await sockets[0].send_json_to({"type": "end_game", "winner": ids[2]})
        err = await self.latest(sockets[0])
        self.assertEqual(err.get("code"), "bad_placings")
        order = [ids[2], ids[0], ids[3], ids[1]]
        await sockets[0].send_json_to({"type": "end_game", "winner": ids[2], "placings": order})
        await self.latest(sockets[1])
        await sockets[1].send_json_to({"type": "end_vote", "approve": True})
        await self.until_closed(sockets[1])

        def check():
            t.refresh_from_db()
            places = {s.entry.user_id: s.place for s in Match.objects.get(pk=match.pk).seats.select_related("entry")}
            return t.status, places

        status, places = await sync_to_async(check)()
        self.assertEqual(status, Tournament.FINISHED)
        self.assertEqual(places, {ids[2]: 1, ids[0]: 2, ids[3]: 3, ids[1]: 4})

    async def test_teammate_cannot_confirm(self):
        def setup():
            users = make_users(4)
            t = make_tournament(users[0], team_size=2)
            fill(t, users)
            services.start(t, random.Random(9))
            m = t.matches.get()
            teams = [s.entry.user_ids() for s in m.seats.order_by("side")]
            return {u.id: u for u in users}, m, teams

        users, match, teams = await sync_to_async(setup)()
        a1, a2 = teams[0]
        b1 = teams[1][0]
        ws = {uid: await self.open(users[uid], match.code) for uid in (a1, a2, b1)}
        for w in ws.values():
            await self.latest(w)
        await ws[a1].send_json_to({"type": "end_game", "winner": a1})
        await self.latest(ws[a2])
        await ws[a2].send_json_to({"type": "end_vote", "approve": True})
        self.assertEqual((await self.latest(ws[a2])).get("code"), "teammate_vote")
        await ws[b1].send_json_to({"type": "end_vote", "approve": True})
        await self.until_closed(ws[b1])
        winner = await sync_to_async(lambda: Match.objects.get(pk=match.pk).winner.user_ids())()
        self.assertIn(a1, winner)
