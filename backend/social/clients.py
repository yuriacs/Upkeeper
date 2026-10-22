"""
Serviços externos da curadoria (social/curation.py), só com a biblioteca padrão:

- Apify: coleta os perfis na nuvem dele (a conta do Upkeeper nunca entra no Instagram para isso).
- Claude (Anthropic): editor-chefe (aprova ou recusa o post e escreve a legenda).
- Cloudinary: hospeda a mídia num endereço público (ele mesmo baixa o arquivo original).
- Instagram Graph API (oficial da Meta): container em /media e publicação em /media_publish.
"""

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request

import anthropic
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


# --- Editor (Claude) ---------------------------------------------------------------------------

EDITOR_SCHEMA = {
    "type": "object",
    "properties": {
        "approved": {"type": "boolean"},
        "reason": {"type": "string"},
        "caption": {"type": "string"},
    },
    "required": ["approved", "reason", "caption"],
    "additionalProperties": False,
}


def editor_json(system: str, prompt: str, schema: dict) -> dict:
    """Resposta do editor (Claude) no formato do `schema`. O SDK já tenta de novo em 429 e 5xx."""
    _need("ANTHROPIC_API_KEY")
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, max_retries=4, timeout=120)
    try:
        res = client.messages.create(
            model=settings.EDITOR_MODEL, max_tokens=4000, system=system,
            messages=[{"role": "user", "content": prompt}],
            # Tarefa simples: pouco raciocínio basta (e custa menos)
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        )  # fmt: skip
    except anthropic.APIStatusError as exc:
        raise ServiceError(f"Claude {exc.status_code}: {exc.message}"[:500], exc.status_code) from None
    except anthropic.APIConnectionError as exc:
        raise ServiceError(f"Claude: {exc}") from None
    if res.stop_reason == "refusal":
        raise ServiceError("Claude recusou analisar esse post")
    try:
        return json.loads(next(b.text for b in res.content if b.type == "text"))
    except (StopIteration, ValueError):
        raise ServiceError(f"Claude sem resposta válida (stop_reason={res.stop_reason})") from None


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


def host_media(source_url: str, media_type: str, public_id: str) -> str:
    """Sobe a mídia pelo endereço original (o Cloudinary baixa) e devolve o endereço público."""
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


def publish_instagram(media_url: str, media_type: str, caption: str, *, wait=10, attempts=30) -> str:
    """Cria o container, espera o vídeo ficar pronto e publica. Devolve o id do post no Instagram."""
    _need("INSTAGRAM_USER_ID", "INSTAGRAM_ACCESS_TOKEN")
    token = settings.INSTAGRAM_ACCESS_TOKEN
    form = {"caption": caption, "access_token": token}
    if media_type == "video":
        form |= {"media_type": "REELS", "video_url": media_url, "share_to_feed": "true"}
    else:
        form |= {"image_url": media_url}
    container = _graph(f"{settings.INSTAGRAM_USER_ID}/media", method="POST", form=form)["id"]
    for _ in range(attempts):
        state = _graph(f"{container}?fields=status_code&access_token={urllib.parse.quote(token)}").get("status_code")
        if state == "FINISHED":
            break
        if state in ("ERROR", "EXPIRED"):
            raise ServiceError(f"Instagram recusou a mídia (container {container}: {state})")
        time.sleep(wait)
    else:
        raise ServiceError(f"Instagram não terminou de processar a mídia (container {container})")
    res = _graph(f"{settings.INSTAGRAM_USER_ID}/media_publish", method="POST",
                 form={"creation_id": container, "access_token": token})
    return res["id"]
