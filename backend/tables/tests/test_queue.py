from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token

from tables import queue, state
from tables.models import TableGame, TableSeat

User = get_user_model()


class QueueTests(TestCase):
    """Fila "Achar partida": junta jogadores compatíveis e abre a mesa com todos sentados."""

    def setUp(self):
        queue.reset()
        state.TABLES.clear()
        self.users = [User.objects.create_user(f"p{i}", "", "x") for i in range(6)]

    def call(self, user, method="get", body=None):
        token, _ = Token.objects.get_or_create(user=user)
        return getattr(self.client, method)("/api/tables/queue/", body or {}, content_type="application/json",
                                            HTTP_AUTHORIZATION=f"Token {token.key}").json()

    def test_four_compatible_players_get_a_full_table(self):
        a, b, c, d, e, _ = self.users
        self.call(a, "post", {"size": 4, "bracket": 3, "style": None})
        self.call(b, "post", {"size": 4, "bracket": None, "style": "relaxed"})
        self.call(e, "post", {"size": 4, "bracket": 2, "style": None})  # bracket diferente: fica
        status = self.call(c, "post", {"size": 4, "bracket": 3, "style": "relaxed"})
        self.assertIsNone(status["match"])
        self.assertEqual(status["mine"]["size"], 4)
        # Quem não está na fila vê quantos procuram, sem nomes
        waiting = self.call(self.users[5])["waiting"]
        self.assertEqual(sum(w["count"] for w in waiting), 4)
        self.assertNotIn("p0", str(waiting))
        code = self.call(d, "post", {"size": 4})["match"]
        self.assertTrue(code)
        for user in (a, b, c):
            self.assertEqual(self.call(user)["match"], code)
        self.assertIsNone(self.call(e)["match"])  # continua esperando
        data = TableGame.objects.get(code=code).data
        self.assertEqual(sorted(int(u) for u in data["seats"]), sorted(u.id for u in (a, b, c, d)))
        self.assertEqual((data["style"], data["rules"]["bracket"], data["max_seats"]), ("relaxed", 3, 4))
        self.assertEqual(TableSeat.objects.filter(table_id=code).count(), 4)
        table = state.Table(data)
        with self.assertRaises(state.TableFull):
            table.join(self.users[5].id, "p5")  # cheia: ninguém de fora senta

    def test_one_on_one_and_leaving(self):
        a, b, c = self.users[:3]
        self.call(a, "post", {"size": 2})
        self.call(a, "delete")
        self.assertIsNone(self.call(a)["mine"])
        self.call(b, "post", {"size": 2, "style": "competitive"})
        code = self.call(c, "post", {"size": 2, "style": "competitive"})["match"]
        self.assertEqual(TableGame.objects.get(code=code).data["max_seats"], 2)

    def test_whoever_stops_asking_leaves_the_queue(self):
        a, b = self.users[:2]
        with mock.patch("tables.queue.time.time", return_value=1000.0):
            self.call(a, "post", {"size": 2, "style": "janky"})
        with mock.patch("tables.queue.time.time", return_value=1000.0 + queue.STALE + 1):
            status = self.call(b, "post", {"size": 2})
        self.assertIsNone(status["match"])  # a saiu do site: não abre mesa com quem não está mais lá
        self.assertEqual(status["waiting"], [])

    def test_full_server_keeps_them_waiting(self):
        a, b = self.users[:2]
        self.call(a, "post", {"size": 2})
        with mock.patch("tables.state.check_new_table", side_effect=state.ServerFull):
            self.assertIsNone(self.call(b, "post", {"size": 2})["match"])
        self.assertTrue(self.call(b, "post", {"size": 2})["match"])  # abriu lugar
