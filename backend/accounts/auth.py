"""
Login por token com cache curto na memória.

O TokenAuthentication do DRF busca o token (e a conta) no banco a cada requisição. O site pergunta
coisas a cada poucos segundos (fila, amigos, mesas abertas) e várias dessas respostas vêm só da
memória; ainda assim cada uma acordava o Neon e esperava uma ida ao banco só para saber quem era.
Aqui o par token → conta fica guardado por TTL segundos. Logout, troca de senha, conta suspensa ou
apagada e qualquer gravação da conta limpam o cache na hora (sinais em accounts/apps.py), então o
atraso só existe para mudanças feitas direto no banco, e no máximo por TTL.

Cada requisição recebe uma cópia da conta: uma view que altere request.user não mexe na guardada.
O servidor roda um processo só (ver Procfile); com mais de um, cada um teria o próprio cache.
"""

import copy
import threading
import time

from rest_framework.authentication import TokenAuthentication

TTL = 300.0
MAX_ENTRIES = 5000

_lock = threading.Lock()
_cache: dict[str, tuple[float, object, object]] = {}  # chave do token → (vale até, conta, token)


class CachedTokenAuthentication(TokenAuthentication):
    def authenticate_credentials(self, key):
        now = time.monotonic()
        with _lock:
            hit = _cache.get(key)
        if hit and hit[0] > now:
            return copy.copy(hit[1]), hit[2]
        user, token = super().authenticate_credentials(key)
        with _lock:
            if len(_cache) >= MAX_ENTRIES:
                _cache.clear()
            _cache[key] = (now + TTL, user, token)
        return copy.copy(user), token


def forget_user(user_id) -> None:
    """A conta mudou (senha, suspensão, nome, apagada): os tokens dela voltam a ser lidos do banco."""
    with _lock:
        for key in [k for k, (_, user, _t) in _cache.items() if user.pk == user_id]:
            del _cache[key]


def forget_token(key) -> None:
    with _lock:
        _cache.pop(key, None)


def clear() -> None:
    with _lock:
        _cache.clear()
