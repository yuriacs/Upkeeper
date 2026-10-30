"""
Ninguém do site lê os dados pessoais: nem quem tem acesso ao banco, nem o admin.
Se um teste daqui falhar depois de mudar modelos, leia PRIVACIDADE.md antes de "consertar".
"""

import re

from django.apps import apps
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.db import connection
from django.test import TestCase
from rest_framework.authtoken.models import Token

from accounts.models import PrivateProfile
from accounts.privacy import email_digest

from .browser import auth_key, new_salt, register, register_body, vault
from .browser import login as browser_login

User = get_user_model()


def all_text_in_db() -> str:
    """Tudo o que está gravado em todas as tabelas, como texto (para procurar vazamentos)."""
    chunks = []
    with connection.cursor() as cur:
        for table in connection.introspection.table_names():
            cur.execute(f'SELECT * FROM "{table}"')
            chunks.extend(str(v) for row in cur.fetchall() for v in row)
    return "\n".join(chunks)


class NoPlaintextTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_email_and_password_never_reach_the_database(self):
        register(self.client, "ana", "Ana.Secreta@Example.com", "senha-muito-secreta")
        dump = all_text_in_db().lower()
        self.assertNotIn("ana.secreta", dump)
        self.assertNotIn("senha-muito-secreta", dump)
        profile = PrivateProfile.objects.get(user__username="ana")
        self.assertEqual(profile.email_digest, email_digest("ana.secreta@example.com"))
        self.assertTrue(profile.has_vault)

    def test_any_user_save_hides_the_email(self):
        # createsuperuser, código novo, testes: o e-mail nunca fica legível
        User.objects.create_user("beto", "beto@example.com", "x-senha-123", first_name="Beto", last_name="Silva")
        user = User.objects.get(username="beto")
        self.assertEqual((user.email, user.first_name, user.last_name), ("", "", ""))
        self.assertEqual(user.private.email_digest, email_digest("beto@example.com"))
        self.assertNotIn("beto@example.com", all_text_in_db())

    def test_me_and_admin_list_do_not_show_email(self):
        token = register(self.client, "ana", "ana@example.com", "senha-forte-123").json()["token"]
        me = self.client.get("/api/auth/me/", HTTP_AUTHORIZATION=f"Token {token}").json()
        self.assertNotIn("email", me)
        self.assertTrue(me["has_email"])
        self.assertEqual(me["auth_scheme"], "derived")
        admin = User.objects.create_user("chefe", "", "x", is_staff=True)
        res = self.client.get("/api/admin/users/?search=example", HTTP_AUTHORIZATION=f"Token {Token.objects.create(user=admin).key}")
        self.assertEqual(res.json()["count"], 0)  # busca por e-mail não existe mais
        self.assertNotIn("ana@example.com", res.content.decode())


class PreloginTests(TestCase):
    def setUp(self):
        cache.clear()

    def pre(self, login):
        return self.client.post("/api/auth/prelogin/", {"login": login}, content_type="application/json").json()

    def test_unknown_login_looks_like_a_real_one(self):
        register(self.client, "ana", "ana@example.com", "senha-forte-123")
        real, fake = self.pre("ana"), self.pre("ninguem")
        self.assertEqual(real.keys(), fake.keys())
        self.assertEqual(fake["scheme"], "derived")
        self.assertEqual(self.pre("ninguem"), fake)  # sempre o mesmo salt falso
        self.assertEqual(self.pre("ana@example.com"), real)


class LegacyUpgradeTests(TestCase):
    """Contas criadas antes desta mudança: mandam a senha uma última vez e passam para o modo novo."""

    def setUp(self):
        cache.clear()
        User.objects.create_user("velho", "velho@example.com", "senha-antiga-123")

    def test_upgrade_on_login(self):
        pre = self.client.post("/api/auth/prelogin/", {"login": "velho"}, content_type="application/json").json()
        self.assertEqual(pre["scheme"], "legacy")
        res = browser_login(self.client, "velho@example.com", "senha-antiga-123")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["user"]["auth_scheme"], "derived")
        self.assertFalse(User.objects.get(username="velho").check_password("senha-antiga-123"))
        # Daqui em diante a senha não serve mais: só a chave derivada
        res = self.client.post("/api/auth/login/", {"login": "velho", "password": "senha-antiga-123"},
                               content_type="application/json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(browser_login(self.client, "velho", "senha-antiga-123").status_code, 200)

    def test_still_logged_in_legacy_account_must_sign_in_again_for_vault(self):
        token = Token.objects.create(user=User.objects.get(username="velho")).key
        res = self.client.put("/api/auth/me/vault/", {**vault(), "version": 0}, content_type="application/json",
                              HTTP_AUTHORIZATION=f"Token {token}")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["code"], "relogin")


class VaultTests(TestCase):
    def setUp(self):
        cache.clear()
        self.token = register(self.client, "ana", "ana@example.com", "senha-forte-123").json()["token"]
        self.h = {"HTTP_AUTHORIZATION": f"Token {self.token}"}

    def call(self, method, url, body=None):
        return getattr(self.client, method)(url, body or {}, content_type="application/json", **self.h)

    def test_get_and_update_with_version(self):
        v = self.call("get", "/api/auth/me/vault/").json()
        self.assertTrue(v["exists"])
        self.assertEqual(v["secret"], "password")
        new = vault()["data"]
        res = self.call("patch", "/api/auth/me/vault/", {"data": new, "version": v["version"]})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["data"], new)
        # Versão velha (outra aba): recusa em vez de sobrescrever
        res = self.call("patch", "/api/auth/me/vault/", {"data": vault()["data"], "version": v["version"]})
        self.assertEqual(res.status_code, 409)

    def test_rejects_malformed_or_huge_data(self):
        v = self.call("get", "/api/auth/me/vault/").json()
        for data in ["não é base64!", "", "QUJD", "A" * 100_000]:
            res = self.call("patch", "/api/auth/me/vault/", {"data": data, "version": v["version"]})
            self.assertEqual(res.status_code, 400, data[:20])

    def test_password_account_cannot_change_salt_via_vault(self):
        before = PrivateProfile.objects.get(user__username="ana").kdf_salt
        v = self.call("get", "/api/auth/me/vault/").json()
        body = {**vault(), "salt": new_salt(), "version": v["version"]}
        # Sem provar a senha (ou com a senha errada), não troca o cofre
        self.assertEqual(self.call("put", "/api/auth/me/vault/", body).status_code, 400)
        body["auth_key"] = auth_key("errada", before)
        self.assertEqual(self.call("put", "/api/auth/me/vault/", body).status_code, 400)
        body["auth_key"] = auth_key("senha-forte-123", before)
        res = self.call("put", "/api/auth/me/vault/", body)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(PrivateProfile.objects.get(user__username="ana").kdf_salt, before)

    def test_change_email(self):
        res = self.call("put", "/api/auth/me/email/", {"email": "ANA@example.com"})
        self.assertTrue(res.json()["matches"])
        register(self.client, "beto", "beto@example.com", "senha-forte-123")
        self.assertEqual(self.call("put", "/api/auth/me/email/", {"email": "beto@example.com"}).status_code, 400)
        res = self.call("put", "/api/auth/me/email/", {"email": "nova@example.com"})
        self.assertFalse(res.json()["matches"])
        self.assertEqual(browser_login(self.client, "nova@example.com", "senha-forte-123").status_code, 200)
        self.assertEqual(browser_login(self.client, "ana@example.com", "senha-forte-123").status_code, 400)

    def test_vault_password_for_account_without_password(self):
        user = User.objects.create(username="social")
        user.set_unusable_password()
        user.save()
        h = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=user).key}"}
        v = self.client.get("/api/auth/me/vault/", **h).json()
        self.assertEqual((v["exists"], v["secret"]), (False, "vault_password"))
        res = self.client.put("/api/auth/me/vault/", {**vault(), "version": 0}, content_type="application/json", **h)
        self.assertEqual(res.status_code, 400)  # precisa do salt da senha do cofre
        salt = new_salt()
        res = self.client.put("/api/auth/me/vault/", {**vault(), "salt": salt, "version": 0},
                              content_type="application/json", **h)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["salt"], salt)


class PasswordResetTests(TestCase):
    def setUp(self):
        cache.clear()
        register(self.client, "ana", "ana@example.com", "senha-forte-123")

    def forgot(self, email):
        return self.client.post("/api/auth/password/forgot/", {"email": email}, content_type="application/json")

    def link_parts(self):
        body = mail.outbox[-1].body
        m = re.search(r"/reset-password#u=([\w-]+)&t=([\w-]+)", body)
        return m.group(1), m.group(2)

    def test_same_answer_with_or_without_account(self):
        self.assertEqual(self.forgot("ninguem@example.com").json(), {"sent": True})
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(self.forgot("Ana@Example.com").json(), {"sent": True})
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["ana@example.com"])  # o endereço digitado, não um gravado
        self.forgot("ana@example.com")
        self.assertEqual(len(mail.outbox), 1)  # um e-mail a cada 2 minutos por conta
        self.assertNotIn("ana@example.com", all_text_in_db())

    def test_reset_rewraps_vault_and_logs_out_everywhere(self):
        old_token = browser_login(self.client, "ana", "senha-forte-123").json()["token"]
        self.forgot("ana@example.com")
        uid, token = self.link_parts()
        check = self.client.post("/api/auth/password/reset/check/", {"uid": uid, "token": token},
                                 content_type="application/json").json()
        self.assertEqual(check["username"], "ana")
        self.assertTrue(check["vault"]["exists"])
        salt = new_salt()
        body = {"uid": uid, "token": token, "auth_key": auth_key("senha-nova-456", salt), "salt": salt, "vault": vault()}
        res = self.client.post("/api/auth/password/reset/", body, content_type="application/json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(browser_login(self.client, "ana", "senha-nova-456").status_code, 200)
        self.assertEqual(browser_login(self.client, "ana", "senha-forte-123").status_code, 400)
        self.assertEqual(self.client.get("/api/auth/me/", HTTP_AUTHORIZATION=f"Token {old_token}").status_code, 401)
        # O link só vale uma vez
        res = self.client.post("/api/auth/password/reset/", body, content_type="application/json")
        self.assertEqual(res.json()["code"], "invalid_link")

    def test_email_follows_the_site_language(self):
        self.client.post("/api/auth/password/forgot/", {"email": "ana@example.com"}, content_type="application/json",
                         HTTP_ACCEPT_LANGUAGE="pt-BR")
        self.assertEqual(mail.outbox[0].subject, "Redefina sua senha do Upkeeper")
        self.assertIn("Olá, ana!", mail.outbox[0].body)

    def test_resend_backend_posts_to_the_api(self):
        from unittest import mock

        from accounts.resend_backend import ResendBackend

        class Res:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        with self.settings(RESEND_API_KEY="re_teste"), mock.patch("urllib.request.urlopen", return_value=Res()) as op:
            msg = mail.EmailMultiAlternatives("Assunto", "texto", "Upkeeper <a@b.c>", ["ana@example.com"])
            msg.attach_alternative("<p>html</p>", "text/html")
            self.assertEqual(ResendBackend().send_messages([msg]), 1)
        req = op.call_args.args[0]
        self.assertEqual(req.full_url, "https://api.resend.com/emails")
        self.assertEqual(req.get_header("Authorization"), "Bearer re_teste")
        import json
        body = json.loads(req.data)
        self.assertEqual((body["to"], body["html"]), (["ana@example.com"], "<p>html</p>"))

    def test_bad_link(self):
        res = self.client.post("/api/auth/password/reset/check/", {"uid": "MQ", "token": "x-y"},
                               content_type="application/json")
        self.assertEqual(res.json()["code"], "invalid_link")

    def test_disabled_without_email_service(self):
        with self.settings(PASSWORD_RESET_ENABLED=False):
            self.assertEqual(self.forgot("ana@example.com").status_code, 503)
            self.assertFalse(self.client.get("/api/auth/oauth/providers/").json()["password_reset"])


class SchemaGuardTests(TestCase):
    """
    Guarda para o futuro: toda coluna de texto nova no banco precisa estar nesta lista, com o
    motivo de poder ficar legível. Dado pessoal do perfil (nome, cidade, aniversário, redes,
    pronomes, bio...) NÃO entra aqui: vai no cofre (PrivateProfile.vault). Veja PRIVACIDADE.md.
    """

    def test_no_new_personal_text_columns(self):
        from django.db import models

        text_types = (models.CharField, models.TextField, models.EmailField, models.JSONField)
        watched = {"auth", "accounts", "pools", "rooms", "decks", "tables", "authtoken", "social"}
        found = {}
        for model in apps.get_models():
            label = model._meta.label
            if model._meta.app_label not in watched:
                continue
            for field in model._meta.concrete_fields:
                if isinstance(field, text_types):
                    found.setdefault(label, set()).add(field.name)
        snapshot = SNAPSHOT
        new = {label: sorted(fields - snapshot.get(label, set())) for label, fields in found.items()}
        new = {k: v for k, v in new.items() if v}
        self.assertFalse(
            new,
            "Colunas de texto novas: %s. Se for dado pessoal do perfil, guarde no cofre (PrivateProfile.vault, "
            "cifrado no navegador). Se outras pessoas precisam ver (ou não é pessoal), adicione em SNAPSHOT "
            "com um comentário explicando. Detalhes em PRIVACIDADE.md." % new,
        )


# Todas as colunas de texto conhecidas hoje, com o motivo de poderem ficar legíveis.
# Coluna nova? Leia o docstring de SchemaGuardTests antes de adicionar aqui.
SNAPSHOT = {
    # email/first_name/last_name existem no modelo do Django, mas ficam sempre vazios (signals.py)
    "auth.User": {"username", "password", "email", "first_name", "last_name"},  # username é público; password é hash
    "auth.Group": {"name"},
    "auth.Permission": {"codename", "name"},
    "authtoken.Token": {"key"},
    "authtoken.TokenProxy": {"key"},
    "accounts.SocialAccount": {"provider", "uid"},  # uid: id numérico no Google/Discord, sem e-mail nem nome
    # HMAC, parâmetros públicos do PBKDF2 e conteúdo cifrado: ilegíveis para o servidor
    "accounts.PrivateProfile": {"email_digest", "kdf_salt", "key_by_secret", "key_by_recovery", "vault"},
    # Apoiador: cor de sleeve e título de Fundador escolhidos em listas fixas, vistos por todos
    "accounts.Supporter": {"sleeve", "title"},
    # Catálogo de cartas e decks oficiais (nada pessoal)
    "decks.Card": {
        "category", "collector_number", "color_identity", "colors", "image_art_crop", "image_back", "image_normal",
        "image_small", "layout", "loyalty", "mana_cost", "name", "oracle_text", "power", "rarity", "set_code",
        "toughness", "type_line",
    },
    "decks.Deck": {"bracket_details", "color_identity", "mtgjson_file", "name", "slug", "source_url"},
    "decks.Edition": {"code", "icon_svg_uri", "name"},
    "decks.OracleTag": {"tag"},
    "decks.TagSync": {"tag"},
    # Sorteios, salas e mesas: o nome de mesa aparece para os outros jogadores
    "decks.Draw": {"code", "filters", "manage_token", "mode"},
    "decks.DrawEntry": {"player_name", "rerolled_from"},
    "rooms.Room": {"code", "draw_seats", "filters", "mode"},
    "rooms.RoomPlayer": {"name", "token"},
    "tables.TableGame": {"code", "data"},
    # Partida restaurada: o código da mesa aberta a partir dela (nada pessoal)
    "tables.GameReplay": {"restored_code"},
    # Decks montados: aparecem para a mesa e no link público do deck
    "pools.UserDeck": {"bracket_details", "color_identity", "decklist_text", "name"},
    # Fichas personalizadas: nome e força/resistência aparecem para a mesa (nada pessoal)
    "pools.CardArt": {"kind", "name", "power", "toughness"},
    # Posts do Upkeeper nas redes: texto público escrito pelo admin; nome de usuário só de quem autorizou
    "social.SocialPost": {
        "error", "external_id", "kind", "lang", "media_type", "media_url", "media_urls", "network", "slides", "status",
        "text",
    },
    # Curadoria: perfis públicos de criadores do nicho (não são contas do site) e os posts públicos deles
    "social.Creator": {"authorization_note", "handle"},
    "social.SourcePost": {"caption", "media_type", "media_url", "note", "permission_message", "shortcode", "status", "url"},
}
