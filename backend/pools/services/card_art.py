"""
Artes personalizadas das cartas: tratamento do arquivo enviado e o endereço público de cada arte.

O arquivo nunca é guardado como veio: o Pillow abre, confere que é imagem de verdade, descarta
metadados (EXIF pode ter a localização de quem tirou a foto), recorta no centro na proporção da
carta (488 × 680, a mesma das imagens do Scryfall) e salva em WebP.
"""

import io
import re

from django.conf import settings

WIDTH, HEIGHT = 488, 680
MAX_UPLOAD = 6 * 1024 * 1024  # bytes do arquivo enviado
MAX_PIXELS = 40_000_000  # imagem gigante (bomba de descompressão) é recusada
MAX_PER_USER = 60  # de cada tipo: artes e fichas personalizadas
QUALITY = 82


class BadImage(ValueError):
    pass


def process(data: bytes) -> tuple[bytes, int, int]:
    """Arquivo enviado → (WebP tratado, largura, altura). Levanta BadImage se não servir."""
    from PIL import Image, ImageOps, UnidentifiedImageError

    if not data or len(data) > MAX_UPLOAD:
        raise BadImage("too_big")
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()  # arquivo corrompido ou que não é imagem
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError) as exc:
        raise BadImage("not_image") from exc
    if img.format not in ("JPEG", "PNG", "WEBP", "GIF"):
        raise BadImage("not_image")
    img = ImageOps.exif_transpose(img)  # foto de celular "deitada" fica de pé antes de perder o EXIF
    img = img.convert("RGB")
    img = ImageOps.fit(img, (WIDTH, HEIGHT), method=Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, "WEBP", quality=QUALITY, method=4)  # sem exif/icc: só os pixels
    return out.getvalue(), img.width, img.height


def art_url(key) -> str:
    """Endereço público da arte. Em produção, absoluto (o site fica em outro domínio que a API)."""
    return f"{settings.PUBLIC_API_BASE}/api/card-art/{key}/"


def is_art_url(url) -> bool:
    """O endereço é o de uma arte (ou ficha personalizada) deste site."""
    return isinstance(url, str) and bool(_ART_URL.fullmatch(url))


_ART_URL = re.compile(re.escape(settings.PUBLIC_API_BASE) + r"/api/card-art/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/")


def deck_arts(deck) -> dict[str, str]:
    """{oracle_id: url da arte} das cartas de um deck montado."""
    rows = deck.card_arts.select_related("art").only("oracle_id", "art__key")
    return {str(r.oracle_id): art_url(r.art.key) for r in rows}
