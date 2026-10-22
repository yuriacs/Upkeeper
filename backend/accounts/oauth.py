"""
Login com Google e Discord (OAuth 2.0, "authorization code"), sem bibliotecas extras.

Fluxo (o retorno do serviço cai no próprio site, no domínio do frontend):
1. O site pede `POST /api/auth/oauth/<serviço>/start/` e recebe a URL do serviço e um `nonce`,
   que guarda na aba (sessionStorage). O `state` da URL é assinado pelo servidor e leva o nonce.
2. A pessoa autoriza no Google/Discord, que volta para `<FRONTEND_URL>/login/social/<serviço>`
   com `code` e `state`.
3. O site manda `code`, `state` e o `nonce` guardado para `POST .../complete/`. O servidor confere
   a assinatura e o nonce (sem ele, um link montado por outra pessoa não loga ninguém na conta
   dela), troca o code pelo perfil e devolve o token do site.

Contas: a primeira vez cria uma conta nova. O e-mail do serviço só vira impressão digital
(accounts/privacy.py), nunca é gravado legível. Se ele já é de uma conta com senha, não junta sozinho (o site não verifica e-mails: alguém poderia ter criado a conta com o e-mail de
outra pessoa antes); a pessoa entra com a senha e liga o serviço na página da conta.
"""

import json
import re
import secrets
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.db import IntegrityError, transaction

from decks.services.http import USER_AGENT

from .models import PrivateProfile, SocialAccount
from .privacy import email_digest

User = get_user_model()
STATE_SALT = "oauth-state"
STATE_MAX_AGE = 15 * 60

PROVIDERS = {
    "google": {
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "profile": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid email profile",
        "extra": {"prompt": "select_account"},
    },
    "discord": {
        "authorize": "https://discord.com/oauth2/authorize",
        "token": "https://discord.com/api/oauth2/token",
        "profile": "https://discord.com/api/users/@me",
        "scope": "identify email",
        "extra": {},
    },
}


class OAuthError(Exception):
    """Erro com um código que o site mostra traduzido."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def credentials(provider: str) -> tuple[str, str] | None:
    keys = settings.OAUTH_CLIENTS.get(provider) or {}
    if keys.get("id") and keys.get("secret"):
        return keys["id"], keys["secret"]
    return None


def enabled() -> list[str]:
    return [p for p in PROVIDERS if credentials(p)]


def redirect_uri(provider: str) -> str:
    return f"{settings.FRONTEND_URL}/login/social/{provider}"


def start(provider: str, mode: str, user_id: int | None) -> dict:
    """URL de autorização do serviço e o nonce que o site guarda até a volta."""
    creds = credentials(provider)
    if provider not in PROVIDERS or not creds:
        raise OAuthError("not_configured")
    nonce = secrets.token_urlsafe(24)
    state = signing.dumps({"p": provider, "m": mode, "u": user_id, "n": nonce}, salt=STATE_SALT)
    cfg = PROVIDERS[provider]
    params = {
        "client_id": creds[0],
        "redirect_uri": redirect_uri(provider),
        "response_type": "code",
        "scope": cfg["scope"],
        "state": state,
        **cfg["extra"],
    }
    return {"url": f"{cfg['authorize']}?{urllib.parse.urlencode(params)}", "nonce": nonce}


def read_state(provider: str, state: str, nonce: str) -> dict:
    try:
        data = signing.loads(state, salt=STATE_SALT, max_age=STATE_MAX_AGE)
    except signing.BadSignature:  # inclui o vencido
        raise OAuthError("invalid_state")
    if data.get("p") != provider or not isinstance(nonce, str) or not secrets.compare_digest(data["n"], nonce):
        raise OAuthError("invalid_state")
    return data


def _http(url: str, *, form: dict | None = None, token: str | None = None) -> dict:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    body = None
    if form is not None:
        body = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST" if body else "GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read())
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise OAuthError("provider_error")


def fetch_profile(provider: str, code: str) -> dict:
    """Troca o code pelo perfil: {"uid", "email" (só se verificado), "name"}."""
    client_id, secret = credentials(provider) or ("", "")
    cfg = PROVIDERS[provider]
    tokens = _http(
        cfg["token"],
        form={
            "client_id": client_id,
            "client_secret": secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri(provider),
        },
    )
    access = tokens.get("access_token")
    if not access:
        raise OAuthError("provider_error")
    raw = _http(cfg["profile"], token=access)
    if provider == "google":
        uid, email, verified = raw.get("sub"), raw.get("email"), raw.get("email_verified") is True
        name = raw.get("given_name") or raw.get("name") or ""
    else:
        uid, email, verified = raw.get("id"), raw.get("email"), raw.get("verified") is True
        name = raw.get("global_name") or raw.get("username") or ""
    if not uid:
        raise OAuthError("provider_error")
    return {"uid": str(uid), "email": (email or "").lower() if verified else "", "name": name}


def _username_from(name: str, email: str) -> str:
    # Nunca a partir do e-mail: o nome de usuário é público (aparece nas salas e mesas)
    base = name or "jogador"
    base = unicodedata.normalize("NFKD", base).encode("ascii", "ignore").decode()
    base = re.sub(r"[^\w.-]+", "", base.replace(" ", "_"))[:24].strip("._-") or "jogador"
    if len(base) < 3:
        base = f"{base}_mtg"
    candidate, n = base, 1
    while User.objects.filter(username__iexact=candidate).exists():
        n += 1
        candidate = f"{base}{n}" if n < 50 else f"{base}{secrets.randbelow(10**5)}"
    return candidate


@transaction.atomic
def login_user(provider: str, profile: dict):
    """Conta do site para este perfil: a já ligada, ou uma nova. Nunca junta por e-mail sozinho."""
    linked = SocialAccount.objects.select_related("user").filter(provider=provider, uid=profile["uid"]).first()
    if linked:
        if not linked.user.is_active:
            raise OAuthError("inactive")
        return linked.user, False
    email = profile["email"]
    if email and PrivateProfile.objects.filter(email_digest=email_digest(email)).exists():
        raise OAuthError("email_in_use")
    # O sinal (accounts/signals.py) troca o e-mail pela impressão digital antes de gravar
    user = User(username=_username_from(profile["name"], email), email=email)
    user.set_unusable_password()
    try:
        with transaction.atomic():
            user.save()
            SocialAccount.objects.create(user=user, provider=provider, uid=profile["uid"])
    except IntegrityError:  # duas abas ao mesmo tempo: a outra criou primeiro
        raise OAuthError("try_again")
    return user, True


def connect_user(provider: str, profile: dict, user) -> None:
    """Liga o serviço à conta logada (para quem já tem conta com senha)."""
    other = SocialAccount.objects.filter(provider=provider, uid=profile["uid"]).first()
    if other and other.user_id != user.pk:
        raise OAuthError("already_linked")
    if other:
        return
    if SocialAccount.objects.filter(user=user, provider=provider).exists():
        raise OAuthError("provider_taken")
    try:
        SocialAccount.objects.create(user=user, provider=provider, uid=profile["uid"])
    except IntegrityError:
        raise OAuthError("already_linked")
