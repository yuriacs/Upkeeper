from datetime import datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfo

from django.test import TestCase, override_settings
from django.utils import timezone

from social import clients, curation
from social.models import Creator, SocialPost, SourcePost
from social.scheduler import next_slot


def profile(handle, followers, posts):
    return {"username": handle, "followersCount": followers, "latestPosts": posts}


def item(code, likes, comments=0, hours=5, kind="Image"):
    when = (timezone.now() - timedelta(hours=hours)).isoformat().replace("+00:00", "Z")
    return {"shortCode": code, "type": kind, "likesCount": likes, "commentsCount": comments, "timestamp": when,
            "caption": f"legenda {code}", "displayUrl": f"https://cdn.example/{code}.jpg",
            "videoUrl": f"https://cdn.example/{code}.mp4"}  # fmt: skip


APPROVED = {"approved": True, "reason": "jogada boa", "caption": "Que jogada!\nOlha isso.\n\nCréditos: @alguem\nComenta aí!"}


@override_settings(SOCIAL_MIN_OUTLIER=1.5, SOCIAL_WINDOW_HOURS=48, SOCIAL_AUTO_APPROVE=False, SOCIAL_LANG="pt")
class CurationTests(TestCase):
    def setUp(self):
        self.ok = Creator.objects.create(handle="combo_br", authorized=True)
        self.other = Creator.objects.create(handle="mesa_edh")
        scrape = [
            # combo_br: um post muito acima dos outros (furou a bolha)
            profile("combo_br", 1000, [item("A1", 500, 20), item("A2", 50), item("A3", 40), item("A4", 60),
                                       item("OLD", 900, hours=100)]),
            profile("mesa_edh", 1000, [item("B1", 400, 10, kind="Video"), item("B2", 30), item("B3", 35)]),
        ]  # fmt: skip
        patches = [
            mock.patch.object(clients, "scrape_profiles", return_value=scrape),
            mock.patch.object(clients, "gemini_json", return_value=APPROVED),
            mock.patch.object(clients, "host_media", side_effect=lambda url, kind, pid: f"https://res.example/{pid}"),
        ]
        self.mocks = [p.start() for p in patches]
        for p in patches:
            self.addCleanup(p.stop)

    def test_collect_ranks_and_dedupes(self):
        self.assertEqual(curation.collect(), 8)
        self.assertEqual(curation.collect(), 8)  # de novo: atualiza, não duplica
        self.assertEqual(SourcePost.objects.count(), 8)
        a1 = SourcePost.objects.get(shortcode="A1")
        self.assertAlmostEqual(a1.engagement, 0.52)
        self.assertGreater(a1.outlier, 5)
        self.assertEqual(self.ok.posts.get(shortcode="OLD").posted_at < timezone.now() - timedelta(hours=48), True)
        # Fora da janela e abaixo da mediana ficam de fora; B1 é 11,7x a mediana do perfil, A1 8,7x
        self.assertEqual([p.shortcode for p in curation.candidates()], ["B1", "A1"])

    def test_curate_queues_authorized_with_credit(self):
        curation.collect()
        post = curation.curate(log_line=lambda _: None)
        self.assertEqual(post.source.shortcode, "A1")
        self.assertEqual(post.status, SocialPost.Status.DRAFT)  # espera o painel
        self.assertEqual(post.media_url, "https://res.example/A1")
        self.assertIn("Créditos/Via: @combo_br", post.text)
        self.assertNotIn("@alguem", post.text)  # a linha de créditos do editor sai
        self.assertEqual(SourcePost.objects.get(shortcode="A1").status, SourcePost.Status.QUEUED)
        # Já na fila: a próxima rodada não pega o mesmo post
        self.assertNotIn("A1", [p.shortcode for p in curation.candidates()])

    def test_unauthorized_becomes_permission_request(self):
        self.ok.authorized = False
        self.ok.save()
        curation.collect()
        self.assertIsNone(curation.curate(log_line=lambda _: None))
        asks = SourcePost.objects.filter(status=SourcePost.Status.ASK)
        self.assertEqual(sorted(p.shortcode for p in asks), ["A1", "B1"])
        self.assertIn("@mesa_edh", asks.get(shortcode="B1").permission_message)
        self.mocks[2].assert_not_called()  # nada sobe sem autorização
        post = curation.grant(asks.get(shortcode="B1"))
        self.assertEqual((post.media_type, post.source.status), ("video", SourcePost.Status.QUEUED))

    def test_editor_rejection(self):
        self.mocks[1].return_value = {"approved": False, "reason": "publi", "caption": ""}
        curation.collect()
        self.assertIsNone(curation.curate(log_line=lambda _: None))
        self.assertEqual(SourcePost.objects.get(shortcode="A1").status, SourcePost.Status.REJECTED)
        self.assertFalse(SocialPost.objects.exists())

    @override_settings(SOCIAL_AUTO_APPROVE=True)
    def test_publish_next(self):
        curation.collect()
        post = curation.curate(log_line=lambda _: None)
        self.assertEqual(post.status, SocialPost.Status.APPROVED)
        with mock.patch.object(clients, "publish_instagram", return_value="1789") as pub:
            done = curation.publish_next()
        pub.assert_called_once_with("https://res.example/A1", "image", post.text)
        self.assertEqual((done.status, done.external_id), (SocialPost.Status.PUBLISHED, "1789"))
        self.assertIsNone(curation.publish_next())
        # Falha da API: o post fica com erro, para ver no painel
        other = SocialPost.objects.create(network="instagram", kind="repost", status="approved",
                                          media_url="https://res.example/x", media_type="image", text="t")
        with mock.patch.object(clients, "publish_instagram", side_effect=clients.ServiceError("token expirado")):
            curation.publish_next()
        other.refresh_from_db()
        self.assertEqual((other.status, other.error), ("error", "token expirado"))

    def test_caption_limit(self):
        text = curation.caption_for("x" * 5000, "autor")
        self.assertLessEqual(len(text), curation.CAPTION_LIMIT)
        self.assertIn("Créditos/Via: @autor", text)


class PanelTests(TestCase):
    """Perfis e pedidos de autorização pelo /painel/social (sem precisar do admin do Django)."""

    def setUp(self):
        from django.contrib.auth import get_user_model
        from rest_framework.authtoken.models import Token

        admin = get_user_model().objects.create_user("admin", "", "x", is_staff=True)
        self.auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=admin).key}"}

    def call(self, method, path, data=None):
        return getattr(self.client, method)(f"/api/admin/social/{path}", data, content_type="application/json", **self.auth)

    def test_add_and_authorize_creators(self):
        res = self.call("post", "creators/", {"handles": "@MTGmemes, https://www.instagram.com/cardgamegirl/ mtgmemes  !!"})
        self.assertEqual(sorted(c["handle"] for c in res.json()), ["cardgamegirl", "mtgmemes"])
        self.assertEqual(self.call("post", "creators/", {"handles": "!!"}).status_code, 400)
        cid = Creator.objects.get(handle="mtgmemes").pk
        res = self.call("patch", f"creators/{cid}/", {"authorized": True, "handle": "outro"})
        self.assertTrue(res.json()["authorized"])
        self.assertIsNotNone(res.json()["authorized_at"])
        self.assertEqual(res.json()["handle"], "mtgmemes")
        self.assertIsNone(self.call("patch", f"creators/{cid}/", {"authorized": False}).json()["authorized_at"])
        self.assertEqual(self.call("delete", f"creators/{cid}/").status_code, 204)

    def test_requests_grant_and_skip(self):
        creator = Creator.objects.create(handle="mesa_edh")
        mk = lambda code: SourcePost.objects.create(  # noqa: E731
            creator=creator, shortcode=code, url=f"https://www.instagram.com/p/{code}/", media_type="image",
            media_url="https://cdn/x.jpg", posted_at=timezone.now(), status=SourcePost.Status.ASK, permission_message="Oi",
        )  # fmt: skip
        a, b = mk("A"), mk("B")
        self.assertEqual(len(self.call("get", "requests/").json()), 2)
        self.assertEqual(self.call("post", f"requests/{b.pk}/skip/").status_code, 204)
        with mock.patch.object(clients, "gemini_json", return_value=APPROVED), \
                mock.patch.object(clients, "host_media", return_value="https://res/a.jpg"):
            res = self.call("post", f"requests/{a.pk}/grant/")
        self.assertEqual(res.status_code, 201)
        self.assertIn("Créditos/Via: @mesa_edh", res.json()["text"])
        self.assertEqual(self.call("get", "requests/").json(), [])
        a.refresh_from_db()
        self.assertIsNotNone(a.permission_granted_at)


    def test_repost_link_and_publish_now(self):
        friend = Creator.objects.create(handle="cardgamegirl", authorized=True)
        Creator.objects.create(handle="outro")
        scrape = [profile("cardgamegirl", 2000, [item("ABC-1", 10, kind="Video")])]
        with mock.patch.object(clients, "scrape_profiles", return_value=scrape) as scraper, \
                mock.patch.object(clients, "gemini_json", return_value=APPROVED), \
                mock.patch.object(clients, "host_media", return_value="https://res/v.mp4"):
            self.assertEqual(self.call("post", "repost/", {"url": "https://x.com/p/1"}).status_code, 400)
            res = self.call("post", "repost/", {"url": "https://www.instagram.com/reel/ABC-1/?igsh=xyz"})
            # Só os perfis autorizados são coletados para achar o post
            scraper.assert_called_once_with(["cardgamegirl"])
            self.assertEqual(res.status_code, 201, res.json())
            self.assertEqual(self.call("post", "repost/", {"url": "https://www.instagram.com/p/ABC-1/"}).json()["detail"],
                             "esse post já foi para a fila")
        post = SocialPost.objects.get(pk=res.json()["id"])
        self.assertEqual((post.status, post.media_type, post.source.creator), ("draft", "video", friend))
        self.assertEqual(self.call("post", f"posts/{post.pk}/publish/").status_code, 409)  # falta aprovar
        self.call("patch", f"posts/{post.pk}/", {"status": "approved"})
        with mock.patch.object(clients, "publish_instagram", return_value="999") as pub, \
                mock.patch("social.views.threading.Thread") as thread:
            self.assertEqual(self.call("post", f"posts/{post.pk}/publish/").status_code, 202)
            thread.call_args.kwargs["target"](*thread.call_args.kwargs["args"])  # roda a thread aqui mesmo
            curation.publish(SocialPost.objects.get(pk=post.pk))  # segunda vez: já publicado, não sobe de novo
        pub.assert_called_once()
        post.refresh_from_db()
        self.assertEqual((post.status, post.external_id, post.error), ("published", "999", ""))

    def test_publish_claim_blocks_double_publish(self):
        post = SocialPost.objects.create(network="instagram", kind="repost", status="approved", text="t",
                                         media_url="https://res/x.jpg", media_type="image", error=curation.PUBLISHING)
        with mock.patch.object(clients, "publish_instagram") as pub:
            self.assertIsNone(curation.publish_next())
            curation.publish(post)
        pub.assert_not_called()
        # Aprovar de novo limpa a marca (se a publicação anterior morreu no meio)
        self.call("patch", f"posts/{post.pk}/", {"status": "approved"})
        post.refresh_from_db()
        self.assertEqual(post.error, "")


class ClientTests(TestCase):
    def test_graph_publish_flow(self):
        calls = []

        def fake(path, **kw):
            calls.append(path.split("?")[0])
            if path.endswith("/media"):
                assert kw["form"]["media_type"] == "REELS"
                return {"id": "C1"}
            if path.startswith("C1"):
                return {"status_code": "FINISHED" if len(calls) > 2 else "IN_PROGRESS"}
            return {"id": "P1"}

        with override_settings(INSTAGRAM_USER_ID="42", INSTAGRAM_ACCESS_TOKEN="tok"), \
                mock.patch.object(clients, "_graph", side_effect=fake), mock.patch.object(clients.time, "sleep"):
            self.assertEqual(clients.publish_instagram("https://v.mp4", "video", "oi"), "P1")
        self.assertEqual(calls, ["42/media", "C1", "C1", "42/media_publish"])

    def test_missing_keys(self):
        with override_settings(APIFY_TOKEN=""), self.assertRaises(clients.ServiceError):
            clients.scrape_profiles(["x"])

    def test_cloudinary_signature(self):
        with override_settings(CLOUDINARY_URL="cloudinary://key:secret@nuvem"), \
                mock.patch.object(clients, "_call", return_value={"secure_url": "https://res/a.webp"}) as call:
            self.assertEqual(clients.host_media("https://cdn/a", "image", "A1"), "https://res/a.jpg")
        url, kw = call.call_args.args[0], call.call_args.kwargs
        self.assertEqual(url, "https://api.cloudinary.com/v1_1/nuvem/image/upload")
        self.assertEqual(len(kw["form"]["signature"]), 40)
        self.assertNotIn("secret", str(kw["form"]))

    def test_next_slot(self):
        tz = ZoneInfo("America/Sao_Paulo")
        now = datetime(2026, 10, 21, 13, 0, tzinfo=tz)
        self.assertEqual(next_slot(now, ["12:00", "19:00"]).hour, 19)
        self.assertEqual(next_slot(now.replace(hour=20), ["12:00", "19:00"]), datetime(2026, 10, 22, 12, 0, tzinfo=tz))
