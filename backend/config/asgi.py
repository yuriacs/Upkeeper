"""
Ponto de entrada ASGI (uvicorn, no Render e em desenvolvimento).

- HTTP: o Django de sempre (WSGI), rodando num pool de threads pelo a2wsgi. Assim as views
  síncronas continuam atendendo várias requisições ao mesmo tempo, como no gunicorn com threads.
- WebSocket: Django Channels, para a mesa virtual.

Roda um processo só: as mesas ficam na memória dele (tables/state.py).
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django_wsgi = get_wsgi_application()  # configura o Django antes dos imports abaixo

from a2wsgi import WSGIMiddleware  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import OriginValidator  # noqa: E402
from django.conf import settings  # noqa: E402

from tables.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": WSGIMiddleware(django_wsgi, workers=settings.HTTP_THREADS),
        # Só o frontend (as mesmas origens liberadas no CORS) abre a mesa
        "websocket": OriginValidator(URLRouter(websocket_urlpatterns), settings.WEBSOCKET_ALLOWED_ORIGINS),
    }
)
