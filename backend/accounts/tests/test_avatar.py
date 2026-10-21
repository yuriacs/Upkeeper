import io

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image
from rest_framework.authtoken.models import Token

from accounts.models import Avatar
from tables import state

User = get_user_model()


def photo():
    img = Image.new("RGB", (1200, 800), (30, 120, 200))
    exif = Image.Exif()
    exif[0x8825] = {2: (23, 33, 1)}  # GPS: a localização de quem tirou a foto
    out = io.BytesIO()
    img.save(out, "JPEG", exif=exif)
    return SimpleUploadedFile("eu.jpg", out.getvalue(), content_type="image/jpeg")


class AvatarTests(TestCase):
    def setUp(self):
        self.ana = User.objects.create_user("ana", "", "x")
        self.auth = {"HTTP_AUTHORIZATION": f"Token {Token.objects.create(user=self.ana).key}"}

    def test_upload_show_and_remove(self):
        res = self.client.post("/api/auth/me/avatar/", {"file": photo()}, **self.auth)
        self.assertEqual(res.status_code, 201)
        url = res.json()["avatar"]
        row = Avatar.objects.get(user=self.ana)
        with Image.open(io.BytesIO(bytes(row.image))) as img:
            self.assertEqual((img.format, img.size), ("WEBP", (256, 256)))  # quadrada e pequena
            self.assertFalse(img.getexif())  # sem a localização
        self.assertEqual(self.client.get("/api/auth/me/", **self.auth).json()["avatar"], url)
        self.assertEqual(self.client.get("/api/users/ana/").json()["avatar"], url)
        image = self.client.get(url)
        self.assertEqual((image.status_code, image["Content-Type"]), (200, "image/webp"))

        # Trocar a foto muda o endereço (o antigo some)
        new = self.client.post("/api/auth/me/avatar/", {"file": photo()}, **self.auth).json()["avatar"]
        self.assertNotEqual(new, url)
        self.assertEqual(self.client.get(url).status_code, 404)

        res = self.client.delete("/api/auth/me/avatar/", **self.auth)
        self.assertEqual(res.json()["avatar"], None)
        self.assertFalse(Avatar.objects.exists())
        self.assertIsNone(self.client.get("/api/users/ana/").json()["avatar"])

    def test_not_an_image(self):
        fake = SimpleUploadedFile("x.jpg", b"nada", content_type="image/jpeg")
        res = self.client.post("/api/auth/me/avatar/", {"file": fake}, **self.auth)
        self.assertEqual(res.json()["code"], "not_image")

    def test_table_shows_the_photo(self):
        t = state.Table(state.new_table("FOTO1"))
        t.join(self.ana.id, "ana", "/api/avatar/x/")
        player = next(p for p in t.view(self.ana.id)["players"] if p["id"] == self.ana.id)
        self.assertEqual(player["avatar"], "/api/avatar/x/")
        t.join(self.ana.id, "ana", None)  # tirou a foto: some ao voltar
        player = next(p for p in t.view(self.ana.id)["players"] if p["id"] == self.ana.id)
        self.assertIsNone(player["avatar"])
