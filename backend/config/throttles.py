"""
Limites de requisição para os pontos que custam caro ou podem ser abusados.

Com login, o limite é por usuário; sem login, por IP. As taxas ficam em
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] (configuráveis por variável de ambiente).

Observação: o cache padrão do Django é por processo. Com vários workers do Gunicorn,
cada um conta separado — suficiente para conter abuso; para um limite exato, use Redis.
"""

from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle


def client_ip(request) -> str:
    """
    IP de quem fez o pedido, para os limites sem login. Atrás de proxies (Render), o
    X-Forwarded-For chega como "cliente, proxy1, proxy2": só os TRUSTED_PROXIES últimos valores
    foram escritos por proxies; o que vem antes o próprio navegador pode inventar (e, com o
    uvicorn confiando em todos, o REMOTE_ADDR é o primeiro valor, inventável também).
    Sem TRUSTED_PROXIES configurado, usa o cabeçalho inteiro (comportamento padrão do DRF).
    """
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    parts = [p.strip() for p in xff.split(",") if p.strip()]
    n = settings.TRUSTED_PROXIES
    if parts and n:
        return parts[-min(n, len(parts))]
    if parts:
        return "".join(xff.split())
    return request.META.get("REMOTE_ADDR", "")


class ScopeThrottle(SimpleRateThrottle):
    scope: str = ""
    # Só conta estes métodos (None = todos). Leituras (GET) não gastam o limite de escrita.
    methods: tuple[str, ...] | None = ("POST", "PUT", "PATCH", "DELETE")

    def allow_request(self, request, view):
        if self.methods is not None and request.method not in self.methods:
            return True
        return super().allow_request(request, view)

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            ident = f"user-{request.user.pk}"
        else:
            ident = client_ip(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}


class AuthThrottle(ScopeThrottle):
    scope = "auth"


class DeckImportThrottle(ScopeThrottle):
    scope = "deck_import"
    methods = ("POST", "PUT")  # importar/reimportar uma lista (apagar não conta)


class DeckEstimateThrottle(ScopeThrottle):
    scope = "deck_estimate"  # bracket e nível de poder ao vivo no deckbuilder (consulta o Spellbook)


class RoomCreateThrottle(ScopeThrottle):
    scope = "room_create"


class RoomJoinThrottle(ScopeThrottle):
    scope = "room_join"


class DrawThrottle(ScopeThrottle):
    scope = "draw"


class FriendThrottle(ScopeThrottle):
    scope = "friends"  # pedidos de amizade (procurar nomes de usuário em massa)


class AccountThrottle(ScopeThrottle):
    scope = "account"
    methods = ("DELETE",)  # excluir conta (exportar usa o próprio limite abaixo)


class AvatarThrottle(ScopeThrottle):
    scope = "avatar"
    methods = ("POST",)  # enviar foto (remover não conta)


class ExportThrottle(ScopeThrottle):
    scope = "account"
    methods = None
