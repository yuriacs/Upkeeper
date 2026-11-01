import io

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image
from rest_framework.authtoken.models import Token

from accounts import supporter
from accounts.models import DeckPlaymat, Supporter
from pools.models import UserDeck
from tables import state

User = get_user_model()


def picture(color=(90, 30, 140)):
    out = io.BytesIO()
    Image.new("RGB", (2000, 1500), color).save(out, "PNG")
    return SimpleUploadedFile("mesa.png", out.getvalue(), content_type="image/png")


class DeckPlaymatTests(TestCase):
    """Fundo do campo por deck montado: só Fundador com apoio ativo; sem fundo, vale o do perfil."""

    def setUp(self):
        self.ana = User.objects.create_user("ana", "", "x")
        self.beto = User.objects.create_user("beto", "", "x")
        self.deck = UserDeck.objects.create(owner=self.ana, name="Seu Siribreja")
        self.other = UserDeck.objects.create(owner=self.ana, name="Outro")
        self.auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.ana).key}"}
        self.beto_auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.beto).key}"}

    def url(self, deck=None):
        return f"/api/auth/me/decks/{(deck or self.deck).pk}/playmat/"

    def upload(self, deck=None, auth=None):
        return self.client.post(self.url(deck), {"file": picture()}, **(auth or self.auth))

    def test_only_founders_with_active_support(self):
        self.assertEqual(self.upload().json()["code"], "not_founder")  # nunca apoiou
        supporter.grant(self.ana)
        Supporter.objects.filter(user=self.ana).update(founder_at=None)  # apoiador comum
        self.assertEqual(self.upload().json()["code"], "not_founder")
        Supporter.objects.filter(user=self.ana).update(founder_at=Supporter.objects.get(user=self.ana).since)
        res = self.upload()
        self.assertEqual(res.status_code, 201)
        url = res.json()["playmat"]
        with Image.open(io.BytesIO(bytes(DeckPlaymat.objects.get(deck=self.deck).image))) as img:
            self.assertEqual((img.format, img.size), ("WEBP", (1920, 640)))
        self.assertEqual(self.client.get(url).status_code, 200)  # mesmo endereço público do fundo do perfil
        self.assertEqual(self.client.get(self.url(), **self.auth).json()["playmat"], url)
        self.assertIsNone(self.client.get(self.url(self.other), **self.auth).json()["playmat"])  # padrão: nenhum

    def test_only_the_deck_owner(self):
        supporter.grant(self.beto)
        self.assertEqual(self.upload(auth=self.beto_auth).status_code, 404)
        self.assertEqual(self.client.get(self.url(), **self.beto_auth).status_code, 404)

    def test_remove_goes_back_to_profile(self):
        supporter.grant(self.ana)
        url = self.upload().json()["playmat"]
        self.assertIsNone(self.client.delete(self.url(), **self.auth).json()["playmat"])
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertFalse(DeckPlaymat.objects.exists())

    def test_table_switches_background_with_the_deck(self):
        supporter.grant(self.ana)
        profile = self.client.post("/api/auth/me/playmat/", {"file": picture()}, **self.auth).json()["playmat"]
        mine = self.upload().json()["playmat"]
        t = state.Table(state.new_table("FUNDO"))
        t.join(self.ana.id, "ana", None, supporter.cosmetics(self.ana))

        def shown():
            return next(p for p in t.view(self.ana.id)["players"] if p["id"] == self.ana.id)["playmat"]

        self.assertEqual(shown(), profile)  # sem deck: o do perfil
        t.load_deck(self.ana.id, {"kind": "user", "ref": str(self.deck.pk), "name": "Seu Siribreja"}, [])
        self.assertEqual(shown(), mine)
        t.load_deck(self.ana.id, {"kind": "user", "ref": str(self.other.pk), "name": "Outro"}, [])
        self.assertEqual(shown(), profile)  # deck sem fundo: o do perfil
        t.load_deck(self.ana.id, {"kind": "precon", "ref": "algum-precon", "name": "Precon"}, [])
        self.assertEqual(shown(), profile)
        # Venceu o apoio: o fundo do deck some (e o do perfil, que é de apoiador, também)
        t.load_deck(self.ana.id, {"kind": "user", "ref": str(self.deck.pk), "name": "Seu Siribreja"}, [])
        supporter.revoke(self.ana)
        t.join(self.ana.id, "ana", None, supporter.cosmetics(self.ana))
        self.assertIsNone(shown())

    def test_other_players_deck_does_not_bring_its_background(self):
        supporter.grant(self.ana)
        self.upload()
        t = state.Table(state.new_table("POOL"))
        t.join(self.beto.id, "beto", None, supporter.cosmetics(self.beto))
        t.load_deck(self.beto.id, {"kind": "user", "ref": str(self.deck.pk), "name": "Seu Siribreja"}, [])
        p = next(p for p in t.view(self.beto.id)["players"] if p["id"] == self.beto.id)
        self.assertIsNone(p["playmat"])  # sorteio da deckpool: o deck da Ana com outro jogador

    def test_report_and_hide(self):
        supporter.grant(self.ana)
        url = self.upload().json()["playmat"]
        res = self.client.post("/api/auth/report-image/", {"url": url}, content_type="application/json",
                               **self.beto_auth)
        self.assertEqual(res.status_code, 204)
        dono = User.objects.create_user("dono", "", "x", is_staff=True)
        admin = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=dono).key}"}
        [report] = self.client.get("/api/admin/reports/", **admin).json()["reports"]
        self.assertEqual((report["kind"], report["url"]), ("playmat", url))
        self.client.post(f"/api/admin/reports/{report['key']}/", {"action": "hide"}, content_type="application/json",
                         **admin)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertIsNone(self.client.get(self.url(), **self.auth).json()["playmat"])
        self.assertEqual(supporter.cosmetics(self.ana)["deck_playmats"], {})
