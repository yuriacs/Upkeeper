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
