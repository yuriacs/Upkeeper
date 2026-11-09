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
MAX_PER_USER = settings.CARD_ART_MAX_PER_USER  # artes de carta enviadas por conta
MAX_TOKENS_PER_USER = 60  # fichas personalizadas por conta
MAX_PER_CARD = 120  # artes de uma carta mostradas na escolha (as mais usadas)
MAX_VARIANTS = 60  # artes diferentes da mesma carta num deck (uma por cópia: Shadowborn Apostle...)
MAX_COPIES = 99  # cópias pedidas para uma arte (o deck tem no máximo 100 cartas)
QUALITY = 82


class BadImage(ValueError):
    pass


def process(data: bytes, size: tuple[int, int] = (WIDTH, HEIGHT)) -> tuple[bytes, int, int]:
    """
    Arquivo enviado → (WebP tratado, largura, altura), recortado no centro em `size` (padrão: a
    carta; a foto de perfil usa um quadrado). Levanta BadImage se não servir.
    """
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
    img = ImageOps.fit(img, size, method=Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, "WEBP", quality=QUALITY, method=4)  # sem exif/icc: só os pixels
    return out.getvalue(), img.width, img.height


def art_url(key) -> str:
    """Endereço público da arte. Em produção, absoluto (o site fica em outro domínio que a API)."""
    return f"{settings.PUBLIC_API_BASE}/api/card-art/{key}/"


def is_art_url(url) -> bool:
    """O endereço é o de uma arte personalizada deste site."""
    return isinstance(url, str) and bool(_ART_URL.fullmatch(url))


_ART_URL = re.compile(re.escape(settings.PUBLIC_API_BASE) + r"/api/card-art/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/")


def _deck_rows(deck, face: int = 0):
    return (
        deck.card_arts.filter(art__hidden_at__isnull=True, face=face)
        .select_related("art")
        .only("oracle_id", "face", "position", "copies", "art__key")
        .order_by("oracle_id", "position", "pk")
    )


def deck_arts(deck, face: int = 0) -> dict[str, str]:
    """
    {oracle_id: url da arte} das cartas de um deck montado (com várias artes, a primeira).
    face=1: as artes do verso das cartas de duas faces.
    """
    arts = {}
    for r in _deck_rows(deck, face):
        arts.setdefault(str(r.oracle_id), art_url(r.art.key))
    return arts


def deck_back_arts(deck) -> dict[str, str]:
    """{oracle_id: url da arte do verso} das cartas de duas faces do deck."""
    return deck_arts(deck, face=1)


def deck_art_sets(deck) -> dict[str, list[dict]]:
    """
    {oracle_id: [{"id", "url", "copies"}]}: todas as artes de cada carta do deck, na ordem. Uma
    carta com várias cópias pode ter uma arte para cada (copies: quantas cópias usam aquela arte).
    """
    sets: dict[str, list[dict]] = {}
    for r in _deck_rows(deck):
        sets.setdefault(str(r.oracle_id), []).append(
            {"id": str(r.art.key), "url": art_url(r.art.key), "copies": r.copies}
        )
    return sets


def split_copies(variants: list[tuple[str, int]], quantity: int) -> list[tuple[str, int]]:
    """
    Reparte as `quantity` cópias de uma carta entre as artes dela ([(url, cópias pedidas)]), na
    ordem. Se a soma pedida bate com o deck, fica como pedido; se não (o deck mudou depois), cada
    arte aparece ao menos uma vez (enquanto houver cópias) e o resto segue a proporção pedida.
    Devolve [(url, cópias)] somando `quantity`, sem as artes que ficaram sem cópia.
    """
    variants = [(url, max(1, int(n))) for url, n in variants]
    if not variants or quantity <= 0:
        return []
    if sum(n for _, n in variants) == quantity:
        return variants
    if quantity <= len(variants):
        return [(url, 1) for url, _ in variants[:quantity]]
    left, total = quantity - len(variants), sum(n for _, n in variants)
    shares = [left * n / total for _, n in variants]
    extra = [int(s) for s in shares]
    by_rest = sorted(range(len(variants)), key=lambda i: (extra[i] - shares[i], i))
    for i in by_rest[: left - sum(extra)]:
        extra[i] += 1
    return [(url, 1 + e) for (url, _), e in zip(variants, extra)]


def token_arts(user) -> dict[str, str]:
    """{oracle_id da ficha: url da arte} que o usuário escolheu para as fichas do Scryfall."""
    rows = user.token_arts.filter(art__hidden_at__isnull=True).select_related("art").only("oracle_id", "art__key")
    return {str(r.oracle_id): art_url(r.art.key) for r in rows}
