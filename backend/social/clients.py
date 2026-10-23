"""
Serviços externos da curadoria (social/curation.py), só com a biblioteca padrão:

- Apify: coleta os perfis na nuvem dele (a conta do Upkeeper nunca entra no Instagram para isso).
- Gemini (Google): editor-chefe (aprova ou recusa o post e escreve a legenda).
- Cloudinary: hospeda a mídia num endereço público (ele mesmo baixa o arquivo original).
- Instagram Graph API (oficial da Meta): container em /media e publicação em /media_publish.
"""

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request

import time

from django.conf import settings

from decks.services.http import USER_AGENT


class ServiceError(Exception):
    """Um serviço externo recusou ou falhou (mensagem curta, sem chaves)."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status  # código HTTP, quando o serviço respondeu


def _call(url: str, *, method="GET", body: dict | None = None, form: dict | None = None,
          headers: dict | None = None, timeout=60):
    data, extra = None, {}
    if body is not None:
        data, extra = json.dumps(body).encode(), {"Content-Type": "application/json"}
    elif form is not None:
        data, extra = urllib.parse.urlencode(form).encode(), {"Content-Type": "application/x-www-form-urlencoded"}
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json", **extra, **(headers or {})},
    )  # fmt: skip
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read() or b"null")
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:500].decode(errors="replace")
        raise ServiceError(f"{urllib.parse.urlsplit(url).netloc} {exc.code}: {detail}", exc.code) from None
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ServiceError(f"{urllib.parse.urlsplit(url).netloc}: {exc}") from None


def _need(*names):
    missing = [n for n in names if not getattr(settings, n)]
    if missing:
        raise ServiceError(f"faltam as variáveis {', '.join(missing)}")


# --- Apify -------------------------------------------------------------------------------------


def scrape_profiles(handles: list[str]) -> list[dict]:
    """Perfis com seguidores e os posts recentes (latestPosts), pelo ator do APIFY_ACTOR."""
    _need("APIFY_TOKEN")
    url = f"https://api.apify.com/v2/acts/{settings.APIFY_ACTOR}/run-sync-get-dataset-items"
    return _call(url, method="POST", body={"usernames": handles},
                 headers={"Authorization": f"Bearer {settings.APIFY_TOKEN}"}, timeout=300) or []


# --- Editor (Gemini) ---------------------------------------------------------------------------

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
EDITOR_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "approved": {"type": "BOOLEAN"},
        "reason": {"type": "STRING"},
        "caption": {"type": "STRING"},
    },
    "required": ["approved", "reason", "caption"],
}
# Limite de uso (429) ou instabilidade do Google (5xx): tenta de novo, esperando um pouco mais a cada vez
RETRY_STATUS = {429, 500, 502, 503, 504}
RETRY_WAIT = (2, 5, 12)


def editor_json(system: str, prompt: str, schema: dict) -> dict:
    """Resposta do editor (Gemini) no formato do `schema`."""
    _need("GEMINI_API_KEY")
    request = dict(
        url=GEMINI_URL.format(model=settings.GEMINI_MODEL), method="POST",
        headers={"x-goog-api-key": settings.GEMINI_API_KEY},
        body={
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseSchema": schema, "temperature": 0.8},
        },
        timeout=120,
    )  # fmt: skip
    for wait in (*RETRY_WAIT, None):
        try:
            res = _call(**request)
            break
        except ServiceError as exc:
            if wait is None or exc.status not in RETRY_STATUS:
                raise
            time.sleep(wait)
    candidate = (res or {}).get("candidates", [{}])[0] if (res or {}).get("candidates") else {}
    if candidate.get("finishReason") in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST"):
        raise ServiceError("Gemini recusou analisar esse post")
    try:
        return json.loads(candidate["content"]["parts"][0]["text"])
    except (KeyError, IndexError, TypeError, ValueError):
        raise ServiceError(f"Gemini sem resposta válida: {str(res)[:300]}") from None


# --- Cloudinary --------------------------------------------------------------------------------


def _cloudinary():
    """(nuvem, chave, segredo) do CLOUDINARY_URL (cloudinary://chave:segredo@nuvem)."""
    _need("CLOUDINARY_URL")
    # Aceita a linha copiada inteira do painel do Cloudinary ("CLOUDINARY_URL=cloudinary://...")
    value = settings.CLOUDINARY_URL.strip().strip("\"'")
    value = value.removeprefix("CLOUDINARY_URL=").strip("\"'")
    parts = urllib.parse.urlsplit(value)
    if "<" in value or ">" in value:
        raise ServiceError("CLOUDINARY_URL ainda tem <your_api_key>/<your_api_secret>: troque pela chave e o segredo reais")
    if parts.scheme != "cloudinary" or not (parts.hostname and parts.username and parts.password):
        raise ServiceError("CLOUDINARY_URL inválido: o valor deve ser cloudinary://chave:segredo@nuvem")
    return parts.hostname, urllib.parse.unquote(parts.username), urllib.parse.unquote(parts.password)


def hosted_prefix() -> str:
    """Início dos endereços das mídias no Cloudinary do Upkeeper (para só publicar o que é nosso)."""
    return f"https://res.cloudinary.com/{_cloudinary()[0]}/"


def host_media(source_url: str, media_type: str, public_id: str) -> str:
    """Sobe a mídia (endereço que o Cloudinary baixa, ou imagem em data URI) e devolve o endereço público."""
    cloud, key, secret = _cloudinary()
    params = {"folder": "upkeeper-curadoria", "overwrite": "true", "public_id": public_id, "timestamp": str(int(time.time()))}
    to_sign = "&".join(f"{k}={v}" for k, v in sorted(params.items())) + secret
    resource = "video" if media_type == "video" else "image"
    res = _call(
        f"https://api.cloudinary.com/v1_1/{cloud}/{resource}/upload", method="POST", timeout=180,
        form={**params, "file": source_url, "api_key": key, "signature": hashlib.sha1(to_sign.encode()).hexdigest()},
    )  # fmt: skip
    url = res.get("secure_url", "")
    if not url:
        raise ServiceError(f"Cloudinary sem endereço: {str(res)[:300]}")
    # O Instagram só aceita JPEG em post de imagem: o Cloudinary converte pela extensão
    return url.rsplit(".", 1)[0] + ".jpg" if resource == "image" else url


# --- Instagram Graph API -----------------------------------------------------------------------


def _graph(path: str, **kw):
    return _call(f"{settings.INSTAGRAM_GRAPH_URL}/{path}", **kw)


def publish_instagram(media: str | list[str], media_type: str, caption: str, *, wait=10, attempts=30) -> str:
    """Cria o container (vários, no carrossel), espera ficarem prontos e publica. Devolve o id do post."""
    _need("INSTAGRAM_USER_ID", "INSTAGRAM_ACCESS_TOKEN")
    token = settings.INSTAGRAM_ACCESS_TOKEN
    urls = [media] if isinstance(media, str) else list(media)

    def container(form: dict) -> str:
        cid = _graph(f"{settings.INSTAGRAM_USER_ID}/media", method="POST", form={**form, "access_token": token})["id"]
        _wait_container(cid, token, wait, attempts)
        return cid

    if len(urls) > 1:
        # Carrossel (2 a 10 imagens): um container por imagem e o do post, que leva a legenda
        children = [container({"image_url": u, "is_carousel_item": "true"}) for u in urls[:10]]
        post = container({"media_type": "CAROUSEL", "children": ",".join(children), "caption": caption})
    elif media_type == "video":
        post = container({"media_type": "REELS", "video_url": urls[0], "share_to_feed": "true", "caption": caption})
    else:
        post = container({"image_url": urls[0], "caption": caption})
    res = _graph(f"{settings.INSTAGRAM_USER_ID}/media_publish", method="POST",
                 form={"creation_id": post, "access_token": token})
    return res["id"]


def _wait_container(container: str, token: str, wait: int, attempts: int):
    """Espera o Instagram processar a mídia do container (vídeo leva minutos; imagem, segundos)."""
    for _ in range(attempts):
        state = _graph(f"{container}?fields=status_code&access_token={urllib.parse.quote(token)}").get("status_code")
        if state == "FINISHED":
            break
        if state in ("ERROR", "EXPIRED"):
            raise ServiceError(f"Instagram recusou a mídia (container {container}: {state})")
        time.sleep(wait)
    else:
        raise ServiceError(f"Instagram não terminou de processar a mídia (container {container})")
