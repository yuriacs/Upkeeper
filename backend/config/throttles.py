"""
Limites de requisição para os pontos que custam caro ou podem ser abusados.

Com login, o limite é por usuário; sem login, por IP. As taxas ficam em
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] (configuráveis por variável de ambiente).

Observação: o cache padrão do Django é por processo. Com vários workers do Gunicorn,
cada um conta separado — suficiente para conter abuso; para um limite exato, use Redis.
"""

from rest_framework.throttling import SimpleRateThrottle


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
            ident = self.get_ident(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}


class AuthThrottle(ScopeThrottle):
    scope = "auth"


class DeckImportThrottle(ScopeThrottle):
    scope = "deck_import"
    methods = ("POST", "PUT")  # importar/reimportar uma lista (apagar não conta)


class RoomCreateThrottle(ScopeThrottle):
    scope = "room_create"


class RoomJoinThrottle(ScopeThrottle):
    scope = "room_join"


class DrawThrottle(ScopeThrottle):
    scope = "draw"


class AccountThrottle(ScopeThrottle):
    scope = "account"
    methods = ("DELETE",)  # excluir conta (exportar usa o próprio limite abaixo)


class ExportThrottle(ScopeThrottle):
    scope = "account"
    methods = None
