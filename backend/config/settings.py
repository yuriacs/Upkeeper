"""
Configurações do Django para o Upkeeper.

Tudo que muda entre ambientes vem de variáveis de ambiente (arquivo .env em dev).
Veja .env.example.
"""

import re
import sys
import warnings
from pathlib import Path

import environ
from corsheaders.defaults import default_headers
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:5173"]),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")
TESTING = "test" in sys.argv

# No Render, o domínio do serviço vem pronto nesta variável: não precisa repetir em ALLOWED_HOSTS
RENDER_EXTERNAL_HOSTNAME = env("RENDER_EXTERNAL_HOSTNAME", default="")
if RENDER_EXTERNAL_HOSTNAME:
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Terceiros
    "rest_framework",
    "corsheaders",
    "django_filters",
    "rest_framework.authtoken",
    # Nossos apps
    "decks",
    "accounts",
    "pools",
    "rooms",
    "tables",
    "channels",
]

MIDDLEWARE = [
    # Compacta as respostas JSON (a lista de cartas de um deck cai de ~55 KB para ~8 KB)
    "django.middleware.gzip.GZipMiddleware",
    "corsheaders.middleware.CorsMiddleware",  # precisa vir antes do CommonMiddleware
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # serve os arquivos estáticos (admin) em produção
    "django.contrib.sessions.middleware.SessionMiddleware",
    # Idioma das mensagens pelo cabeçalho Accept-Language que o site manda (inglês ou português)
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# Banco: DATABASE_URL no formato mysql://usuario:senha@host:3306/banco
DATABASES = {"default": env.db("DATABASE_URL")}
_db = DATABASES["default"]
if _db["ENGINE"] == "django.db.backends.mysql":
    _db.setdefault("OPTIONS", {})["charset"] = "utf8mb4"
# Reaproveita conexões entre requisições e testa antes de usar (bancos como o Neon
# "dormem" e derrubam conexões ociosas)
# Abrir conexão nova com o Neon (TCP + TLS + login) custa centenas de ms por requisição,
# então ela é mantida aberta por até 10 minutos.
_db["CONN_MAX_AGE"] = env.int("CONN_MAX_AGE", default=600)
_db["CONN_HEALTH_CHECKS"] = True
# Conexão pelo pooler do Neon (host com "-pooler", PgBouncer em modo transação): manter a
# conexão com o pooler é seguro; só os cursores do lado do servidor não funcionam.
if "-pooler" in (_db.get("HOST") or ""):
    _db["DISABLE_SERVER_SIDE_CURSORS"] = True
# Postgres (Neon): nunca esperar para sempre por uma conexão que caiu sem avisar (o Neon dorme e
# derruba conexões ociosas). Sem isso, uma consulta pendurada trava a fila de banco da mesa
# virtual e todas as mesas ficam em "Conectando…".
if "postgresql" in _db["ENGINE"]:
    _db.setdefault("OPTIONS", {}).update(
        connect_timeout=10,  # abrir a conexão: no máximo 10 s
        keepalives=1,  # TCP keepalive: descobre conexão morta em ~1 min
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=3,
        tcp_user_timeout=30000,  # dado enviado sem resposta por 30 s: a conexão é dada como morta
    )

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Inglês por padrão; português quando o site pede (Accept-Language: pt-BR)
LANGUAGE_CODE = "en"
LANGUAGES = [("en", "English"), ("pt-br", "Português")]
LOCALE_PATHS = [BASE_DIR / "locale"]
TIME_ZONE = "America/Sao_Paulo"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        # Em produção: arquivos com hash no nome + gzip/brotli (rode collectstatic no build)
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
        if DEBUG or TESTING
        else "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# API pública e somente leitura por padrão
REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    # Login por token (header "Authorization: Token <chave>"), guardado pelo frontend.
    # Sem autenticação por sessão: o frontend fica em outro domínio e não precisa de cookies/CSRF.
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.TokenAuthentication"],
    # Limites por usuário logado (ou por IP, sem login). Ver config/throttles.py
    "DEFAULT_THROTTLE_RATES": {
        "auth": env("THROTTLE_AUTH", default="20/min"),
        "deck_import": env("THROTTLE_DECK_IMPORT", default="30/hour"),  # cada importação consulta o Scryfall
        "room_create": env("THROTTLE_ROOM_CREATE", default="30/hour"),
        "room_join": env("THROTTLE_ROOM_JOIN", default="60/hour"),
        "draw": env("THROTTLE_DRAW", default="120/hour"),
        "account": env("THROTTLE_ACCOUNT", default="10/hour"),
        "friends": env("THROTTLE_FRIENDS", default="60/hour"),
    },
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"]
    + (["rest_framework.renderers.BrowsableAPIRenderer"] if DEBUG else []),
}

# Estimativa de bracket pelo Commander Spellbook (desligada nos testes, que não acessam a rede)
BRACKETS_ENABLED = env.bool("BRACKETS_ENABLED", default=not TESTING)
COMMANDER_SPELLBOOK_URL = env("COMMANDER_SPELLBOOK_URL", default="https://backend.commanderspellbook.com")

if TESTING:
    # Nos testes, os limites não podem interferir (os de limite têm teste próprio)
    REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {k: "10000/min" for k in REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]}

# Senhas erradas seguidas na mesma conta (venham de qualquer IP) antes de bloquear o login dela
# por LOGIN_LOCK_MINUTES: contra quem tenta adivinhar a senha de alguém (accounts/views.py)
LOGIN_MAX_FAILURES = env.int("LOGIN_MAX_FAILURES", default=10)
LOGIN_LOCK_MINUTES = env.int("LOGIN_LOCK_MINUTES", default=15)

# Login com Google e Discord (accounts/oauth.py): sem as chaves, o botão do serviço não aparece.
# O retorno do serviço volta para FRONTEND_URL/entrar/social/<serviço> (cadastre esse endereço lá).
OAUTH_CLIENTS = {
    "google": {"id": env("GOOGLE_CLIENT_ID", default=""), "secret": env("GOOGLE_CLIENT_SECRET", default="")},
    "discord": {"id": env("DISCORD_CLIENT_ID", default=""), "secret": env("DISCORD_CLIENT_SECRET", default="")},
}
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:5173").rstrip("/")

# --- Dados pessoais (accounts/privacy.py e PRIVACIDADE.md) ---------------------------------
# Chave da impressão digital dos e-mails. Separada da SECRET_KEY: trocar a SECRET_KEY não pode
# impedir ninguém de entrar com o e-mail. NUNCA troque depois de ter contas (os e-mails gravados
# deixam de bater) e não guarde em lugar nenhum além do painel do host.
EMAIL_PEPPER = env("EMAIL_PEPPER", default="")
if not EMAIL_PEPPER:
    if DEBUG or TESTING:
        import hashlib as _hashlib

        EMAIL_PEPPER = _hashlib.sha256(b"email-pepper:" + SECRET_KEY.encode()).hexdigest()
    else:
        raise ImproperlyConfigured(
            "Falta a variável EMAIL_PEPPER. Gere com: "
            'python -c "import secrets; print(secrets.token_urlsafe(48))" e coloque no painel do host.'
        )

# E-mail de "esqueci a senha" pela API HTTPS do Resend (accounts/resend_backend.py). Não é SMTP
# porque o plano gratuito do Render bloqueia as portas de e-mail. O endereço de quem pediu só
# existe na memória durante o envio; não é gravado.
RESEND_API_KEY = env("RESEND_API_KEY", default="")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="Upkeeper <nao-responda@upkeeper.online>")
if RESEND_API_KEY:
    EMAIL_BACKEND = "accounts.resend_backend.ResendBackend"
elif DEBUG and not TESTING:
    # Em dev, sem a chave, o e-mail aparece no terminal do backend
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
# Sem a chave, em produção o link "Esqueceu a senha?" some do site
PASSWORD_RESET_ENABLED = bool(RESEND_API_KEY) or DEBUG or TESTING
# Link de redefinir senha vale 1 hora (e só uma vez: muda junto com a senha)
PASSWORD_RESET_TIMEOUT = 60 * 60

# Quantos proxies escrevem no X-Forwarded-For na frente do servidor (Render): o IP do cliente é o
# valor nessa posição, contando do fim (config/throttles.py). Veja /api/admin/request-info/.
_proxies = env("TRUSTED_PROXIES", default="0").strip()
if not _proxies.isdigit():
    # Valor errado no painel (ex.: uma URL) não derruba o site: avisa e segue sem confiar no cabeçalho
    warnings.warn(f"TRUSTED_PROXIES deve ser um número (0, 1, 2...); recebido {_proxies[:40]!r}. Usando 0.")
    _proxies = "0"
TRUSTED_PROXIES = int(_proxies)

# Caminho do admin do Django: em produção, use um que ninguém adivinhe (ex.: "gestao-8f3k2/")
ADMIN_PATH = env("ADMIN_PATH", default="admin/").strip().strip("/") + "/"
if not re.fullmatch(r"[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*/", ADMIN_PATH):
    raise ImproperlyConfigured(
        "ADMIN_PATH deve ter só letras sem acento, números, hífen ou _ (ex.: painel-x7k2q/), sem https:// nem domínio."
    )

CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")

# Mesa virtual (WebSocket): mesmo processo, então a camada de canais fica na memória
ASGI_APPLICATION = "config.asgi.application"
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
WEBSOCKET_ALLOWED_ORIGINS = list(CORS_ALLOWED_ORIGINS)
# Threads que atendem o HTTP (views do Django) dentro do processo do uvicorn
HTTP_THREADS = env.int("HTTP_THREADS", default=8)
# Header com o token do jogador na sala (/api/rooms/...)
# Header com o token de quem criou o sorteio sem conta (marcar vencedor)
CORS_ALLOW_HEADERS = (*default_headers, "x-room-token", "x-draw-token")

CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])
if RENDER_EXTERNAL_HOSTNAME:
    CSRF_TRUSTED_ORIGINS.append(f"https://{RENDER_EXTERNAL_HOSTNAME}")  # login do admin

# --- Segurança em produção (DEBUG=False) ---------------------------------------------------
# Atrás do proxy HTTPS do Render/Railway/Fly
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
if not DEBUG:
    SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=not TESTING)
    # O health check do host costuma chegar por HTTP interno: não redireciona
    SECURE_REDIRECT_EXEMPT = [r"^api/health/$"]
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # Comece com 1 dia; depois que tudo estiver estável, suba para 1 ano (31536000)
    SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=86400)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", default=False)
    SECURE_HSTS_PRELOAD = False
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"

# Avisos conscientes do check --deploy: subdomínios e preload do HSTS dependem do seu domínio
SILENCED_SYSTEM_CHECKS = ["security.W005", "security.W021"]

# Logs no console (o host de deploy guarda a saída)
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
    "loggers": {"django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False}},
}
