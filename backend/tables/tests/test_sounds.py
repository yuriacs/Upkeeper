from unittest import mock

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from tables import sounds, state
from tables.models import SoundClip

User = get_user_model()
MP3 = b"ID3" + b"\x00" * 200
WAV = b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 100


class SoundboardApiTests(TestCase):
    def setUp(self):
        sounds.forget()
        self.admin = User.objects.create_user("admin", password="x", is_staff=True)
        self.user = User.objects.create_user("ana", password="x")
        self.api = APIClient()

    def tearDown(self):
        sounds.forget()

    def upload(self, data=MP3, name="Croko", emoji="🐊", user=None):
        self.api.force_authenticate(user or self.admin)
        return self.api.post(
            "/api/admin/sounds/",
            {"file": SimpleUploadedFile("s.mp3", data, content_type="audio/mpeg"), "name": name, "emoji": emoji},
            format="multipart",
        )

    def test_only_admin_uploads(self):
        self.assertEqual(self.upload(user=self.user).status_code, 403)
        self.api.force_authenticate(None)
        self.assertIn(self.api.get("/api/admin/sounds/").status_code, (401, 403))

    def test_upload_list_and_serve(self):
        res = self.upload()
        self.assertEqual(res.status_code, 201)
        key = res.json()["id"]
        self.upload(WAV, name="Risada", emoji="")
        self.api.force_authenticate(None)
        listed = self.api.get("/api/sounds/").json()["sounds"]
        self.assertEqual([(s["name"], s["emoji"]) for s in listed], [("Croko", "🐊"), ("Risada", "")])
        file = self.api.get(f"/api/sounds/{key}/")
        self.assertEqual(file.status_code, 200)
        self.assertEqual(file["Content-Type"], "audio/mpeg")
        self.assertIn("immutable", file["Cache-Control"])
        self.assertEqual(b"".join(file), MP3)

    def test_rejects_non_audio_big_files_and_empty_name(self):
        self.assertEqual(self.upload(b"<html>nope</html>").json()["code"], "not_audio")
        self.assertEqual(self.upload(b"ID3" + b"\x00" * sounds.MAX_BYTES).json()["code"], "too_big")
        self.assertEqual(self.upload(name="   ").json()["code"], "no_name")
        self.assertFalse(SoundClip.objects.exists())

    def test_edit_and_delete_refresh_the_list(self):
        key = self.upload().json()["id"]
        self.assertEqual(len(sounds.catalog()), 1)  # em cache
        res = self.api.patch(f"/api/admin/sounds/{key}/", {"name": "Croko 2", "emoji": "🔥"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(sounds.entry(key)["name"], "Croko 2")
        self.assertEqual(self.api.delete(f"/api/admin/sounds/{key}/").status_code, 204)
        self.assertEqual(sounds.catalog(), [])
        self.assertEqual(self.api.get(f"/api/sounds/{key}/").status_code, 404)

    def test_playing_does_not_touch_the_database_once_cached(self):
        key = self.upload().json()["id"]
        sounds.catalog()
        with self.assertNumQueries(0):
            self.assertIsNotNone(sounds.entry(key))


class PlaySoundTests(TestCase):
    def test_play_logs_for_everyone_with_cooldown(self):
        t = state.Table(state.new_table("ROOM1"))
        t.join(1, "a")
        sound = {"id": "abc", "name": "Croko", "emoji": "🐊"}
        with mock.patch.object(state.time, "monotonic", return_value=100.0):
            t.play_sound(1, sound)
            with self.assertRaises(state.ActionError):
                t.play_sound(1, sound)  # rápido demais
        entry = t.data["log"][-1]
        self.assertEqual((entry["kind"], entry["sound"], entry["card"], entry["what"]), ("sound", "abc", "Croko", "🐊"))
        with mock.patch.object(state.time, "monotonic", return_value=103.0):
            t.play_sound(1, sound)
        with self.assertRaises(state.ActionError):
            t.play_sound(2, sound)  # sem lugar na mesa
