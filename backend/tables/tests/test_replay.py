from unittest import mock

from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token

from tables import state, store
from tables.models import GameReplay

User = get_user_model()
IMG = "https://cards.scryfall.io/normal/x.jpg"


def rows(n, prefix):
    return [
        {"name": f"{prefix} {i}", "image": IMG, "back": "", "quantity": 1, "type_line": "Creature", "is_commander": i == 0,
         "power": "1", "toughness": "1", "loyalty": "", "oracle_text": "", "mana_cost": "", "cmc": 1}
        for i in range(n)
    ]


class ReplayTests(TestCase):
    def setUp(self):
        self.ana = User.objects.create_user("ana", "", "x")
        self.beto = User.objects.create_user("beto", "", "x")
        self.caio = User.objects.create_user("caio", "", "x")
        self.t = t = state.Table(state.new_table("REPLAY1"))
        for user in (self.ana, self.beto):
            t.join(user.id, user.username)
            t.load_deck(user.id, {"kind": "precon", "ref": "x", "name": f"Deck de {user.username}"},
                        rows(20, user.username))
        self.clock = 1000.0
        patcher = mock.patch("tables.state.time.time", side_effect=lambda: self.clock)
        patcher.start()
        self.addCleanup(patcher.stop)

    def play(self):
        t = self.t

        def act(fn, *args):  # como o consumer: depois de cada ação, a foto para rever ação a ação
            fn(*args)
            t.replay_frame()

        act(t.pass_turn, self.ana.id)  # turno 1: ana
        act(t.draw_to, self.ana.id, 1, "battlefield")
        act(t.chat, self.ana.id, "boa sorte")
        self.clock += 90
        act(t.pass_turn, self.ana.id)  # turno 2: beto
        act(t.change_life, self.beto.id, -3)
        act(t.create_token, self.beto.id, "Soldier", IMG)
        self.clock += 60
        act(t.end_game, self.beto.id, self.beto.id)

    def test_turn_by_turn_with_names_and_no_chat(self):
        self.play()
        replay = self.t.take_replay()
        self.assertEqual([t["turn"] for t in replay["turns"]], [1, 2])
        first, second = replay["turns"]
        self.assertEqual((first["player"], first["took"]), ("ana", 90))
        ana_board = next(b for b in first["boards"] if b["user"] == self.ana.id)
        self.assertEqual(len(ana_board["field"]), 2)  # comandante + a carta posta no campo
        names = replay["cards"]  # nome e imagem uma vez só, por id
        self.assertTrue(all(names[c["id"]]["name"] and names[c["id"]]["image"] for c in ana_board["field"]))
        self.assertNotIn("chat", [e["kind"] for e in first["events"]])
        beto_board = next(b for b in second["boards"] if b["user"] == self.beto.id)
        self.assertEqual(beto_board["life"], 37)
        self.assertIn("Soldier", [c.get("name") for c in beto_board["field"]])  # ficha com nome e imagem
        self.assertEqual(replay["winner"], "beto")
        self.assertIsNone(self.t.take_replay())  # uma vez só

    def test_action_by_action_frames(self):
        self.play()
        replay = self.t.take_replay()
        first, second = replay["turns"]
        draw = next(e for e in first["events"] if e["kind"] == "draw_to")
        ana = next(b for b in draw["b"] if b["seat"] == 1)
        self.assertEqual(len(ana["field"]), 2)  # o campo logo depois de pôr a carta
        self.assertTrue(replay["cards"][ana["field"][1]["id"]]["name"])
        self.assertEqual((ana["gy"], ana["ex"]), ([], []))  # cemitério e exílio (as pilhas da mesa)
        self.assertEqual(len(ana["hd"]), ana["counts"]["hand"])  # a mão aberta, ao rever
        self.assertTrue(all(replay["cards"][cid]["name"] for cid in ana["hd"]))
        self.assertNotIn("user", ana)
        life = next(e for e in second["events"] if e["kind"] == "life")
        self.assertEqual([(b["seat"], b["life"]) for b in life["b"]], [(2, 37)])  # só o lugar que mudou
        commander = next(c for c in ana["field"] if c.get("commander"))
        self.assertEqual(commander["slot"], 0)  # na zona do comandante
        self.assertTrue({"id", "x", "y", "tapped"} <= set(ana["field"][1]))  # posição no campo, como na mesa
        token = next(e for e in second["events"] if e["kind"] == "token")
        soldier = next(c for c in token["b"][0]["field"] if c.get("name") == "Soldier")
        self.assertTrue(soldier["token"])

    def test_old_frames_without_positions(self):
        """Mesa que já estava aberta antes das posições: as fotos antigas continuam legíveis."""
        self.play()
        for turn in self.t.data["replay"]:
            for b in turn["boards"]:
                b["field"] = [[e[0], e[1]] for e in b["field"]] + [["", 0]]
        boards = self.t.take_replay()["turns"][0]["boards"]
        self.assertTrue(all(c["name"] for c in boards[0]["field"][:-1]))
        self.assertTrue(boards[0]["field"][-1]["face_down"])

    def test_face_down_card_has_no_link_to_its_name(self):
        self.play()
        item = self.t.seat_of(self.beto.id)["zones"]["battlefield"][0]
        item["face_down"] = True
        replay = self.t.take_replay()  # a foto do fim do último turno já pega a carta virada
        board = next(b for b in replay["turns"][-1]["boards"] if b["seat"] == 2)
        hidden = next(c for c in board["field"] if c.get("face_down"))
        self.assertNotEqual(hidden["id"], item["id"])
        self.assertNotIn("name", hidden)

    def test_saved_and_only_players_see_it(self):
        self.play()
        pk = async_to_sync(store.save_replay)(self.t.take_replay())
        self.assertEqual(GameReplay.objects.get(pk=pk).turns, 2)

        def get(user, url):
            return self.client.get(url, HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=user).key}")

        listing = get(self.ana, "/api/tables/replays/").json()["replays"]
        self.assertEqual((listing[0]["id"], listing[0]["winner"]), (pk, "beto"))
        detail = self.client.get(f"/api/tables/replays/{pk}/",
                                 HTTP_AUTHORIZATION=f"Token {Token.objects.get(user=self.ana).key}").json()
        self.assertEqual([p["name"] for p in detail["players"]], ["ana", "beto"])
        self.assertEqual(detail["you"], 1)  # o lugar de quem está vendo (o campo dele fica embaixo)
        self.assertEqual(get(self.caio, f"/api/tables/replays/{pk}/").status_code, 404)  # não jogou

    def test_deleted_account_leaves_no_name(self):
        from accounts.services import DELETED_NAME, delete_account

        self.play()
        pk = async_to_sync(store.save_replay)(self.t.take_replay())
        delete_account(self.ana)
        from tables.views import _replay_data

        data = _replay_data(GameReplay.objects.get(pk=pk))
        self.assertEqual([p["name"] for p in data["players"]], [DELETED_NAME, "beto"])
        self.assertNotIn('"ana"', str(data).replace("'", '"'))


class RestoreTests(TestCase):
    """Rever → Restaurar mesa: a partida que fechou sem vencedor volta como estava."""

    def setUp(self):
        from accounts import presence

        presence.reset()
        state.TABLES.clear()
        self.ana = User.objects.create_user("ana", "", "x")
        self.beto = User.objects.create_user("beto", "", "x")
        self.caio = User.objects.create_user("caio", "", "x")
        self.t = t = state.Table(state.new_table("RESTO1"))
        for user in (self.ana, self.beto):
            t.join(user.id, user.username)
            t.load_deck(user.id, {"kind": "precon", "ref": f"deck-{user.username}", "name": f"Deck de {user.username}"},
                        rows(20, user.username))

        def act(fn, *args):
            fn(*args)
            t.replay_frame()

        act(t.pass_turn, self.ana.id)  # turno 1: ana
        act(t.draw, self.ana.id, 7)
        act(t.draw_to, self.ana.id, 1, "battlefield")
        act(t.draw_to, self.ana.id, 2, "graveyard")
        act(t.pass_turn, self.ana.id)  # turno 2: beto
        act(t.draw, self.beto.id, 7)
        act(t.change_life, self.beto.id, -5)
        act(t.create_token, self.beto.id, "Soldier", IMG)

    def post(self, user, pk):
        token, _ = Token.objects.get_or_create(user=user)
        return self.client.post(f"/api/tables/replays/{pk}/restore/", HTTP_AUTHORIZATION=f"Token {token.key}")

    def close(self, keep=True):
        """Como closer.close_table: a cópia da mesa antes de take_replay."""
        resume = self.t.resume_data() if keep else None
        return async_to_sync(store.save_replay)(self.t.take_replay(), resume)

    def restored(self, code):
        from tables.models import TableGame

        return state.Table(TableGame.objects.get(code=code).data)

    def test_snapshot_comes_back_exactly(self):
        before = json_copy(self.t.data["seats"])
        pk = self.close()
        res = self.post(self.ana, pk)
        self.assertEqual(res.status_code, 200)
        code = res.json()["code"]
        self.assertEqual(code, "RESTO1")  # o código antigo estava livre
        t = self.restored(code)
        for key, seat in before.items():
            now = t.data["seats"][key]
            for zone in ("library", "hand", "graveyard", "battlefield"):
                self.assertEqual(now["zones"][zone], seat["zones"][zone], zone)
            self.assertEqual(now["life"], seat["life"])
        self.assertEqual(t.data["turn"]["number"], 2)
        self.assertEqual(t.data["turn"]["player"], self.beto.id)
        self.assertIsNone(t.data["result"])
        self.assertTrue(t.started)  # ninguém de fora senta
        # O outro jogador recebe convite e vê a mesa em "Suas mesas"; restaurar de novo leva à mesma mesa
        from accounts import presence

        self.assertEqual([i["code"] for i in presence._invites[self.beto.id]], [code])
        self.assertEqual(self.post(self.beto, pk).json()["code"], code)
        self.assertEqual(self.post(self.caio, pk).status_code, 404)  # não jogou

    def test_replay_continues_and_replaces_the_old_one(self):
        pk = self.close()
        code = self.post(self.ana, pk).json()["code"]
        t = self.restored(code)
        t.change_life(self.beto.id, -1)
        t.replay_frame()
        t.pass_turn(self.beto.id)  # turno 3: ana
        t.replay_frame()
        from tables.views import _replay_data

        new_pk = async_to_sync(store.save_replay)(t.take_replay(), None)
        self.assertFalse(GameReplay.objects.filter(pk=pk).exists())  # a nova substitui a de antes
        replay = _replay_data(GameReplay.objects.get(pk=new_pk))
        self.assertEqual([x["turn"] for x in replay["turns"]], [1, 2, 3])  # o turno 2 não repete
        events = [e["kind"] for e in replay["turns"][1]["events"]]
        self.assertIn("token", events)  # o que aconteceu antes de fechar
        self.assertIn("restored", events)
        self.assertEqual(GameReplay.objects.get(pk=new_pk).turns, 3)
        self.assertNotIn("prefix", str(t.data.keys()).replace("prefix_turns", ""))

    def test_old_replay_is_rebuilt_from_the_last_picture(self):
        before = json_copy(self.t.data["seats"])
        pk = self.close(keep=False)  # partida salva antes da cópia da mesa existir
        decks = {f"deck-{u}": ({"kind": "precon", "ref": f"deck-{u}", "name": u}, rows(20, u)) for u in ("ana", "beto")}
        with mock.patch("tables.store.deck_cards_sync", side_effect=lambda kind, ref: decks.get(ref)):
            code = self.post(self.ana, pk).json()["code"]
        t = self.restored(code)
        for key, seat in before.items():
            now = t.data["seats"][key]
            for zone in ("hand", "graveyard", "battlefield"):
                self.assertEqual(zone_names(now, zone), zone_names(seat, zone), zone)
            self.assertEqual(len(now["zones"]["library"]), len(seat["zones"]["library"]))
            self.assertEqual(now["life"], seat["life"])
        self.assertEqual((t.data["turn"]["number"], t.data["turn"]["player"]), (2, self.beto.id))
        ids = [c for s in t.data["seats"].values() for c in s["cards"]]
        self.assertEqual(len(ids), len(set(ids)))  # nenhum id repetido entre jogadores

    def test_game_with_winner_cannot_be_restored(self):
        self.t.end_game(self.beto.id, self.beto.id)
        pk = self.close()
        self.assertEqual(self.post(self.ana, pk).status_code, 400)


def zone_names(seat, zone):
    ids = [i["id"] if isinstance(i, dict) else i for i in seat["zones"][zone]]
    return sorted(seat["cards"][c]["name"] for c in ids)


def json_copy(value):
    import json

    return json.loads(json.dumps(value))
