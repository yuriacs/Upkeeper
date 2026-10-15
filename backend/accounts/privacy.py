"""
Dados pessoais que ninguém do site consegue ler, nem o dono do servidor.

Como funciona (detalhes em PRIVACIDADE.md, na raiz do projeto):

- E-mail: o banco guarda só a "impressão digital" dele (HMAC-SHA256 com a chave EMAIL_PEPPER).
  Serve para entrar com o e-mail, barrar e-mail repetido e mandar o link de "esqueci a senha"
  para o endereço que a pessoa acabou de digitar. Não dá para listar nem ler os e-mails; quem
  tiver a EMAIL_PEPPER consegue no máximo testar um palpite.
- Senha: nunca chega ao servidor. O navegador tira dela duas chaves (PBKDF2 + HKDF): uma prova
  quem é a pessoa (`auth_key`, que o servidor guarda com hash como se fosse a senha) e a outra
  abre o cofre e nunca sai do navegador.
- Cofre: dados do perfil cifrados no navegador (AES-256-GCM) com uma chave aleatória da conta.
  O servidor guarda essa chave trancada duas vezes (pela senha e pelo código de recuperação) e
  o conteúdo cifrado. Todo dado de perfil novo vai para o cofre.
"""

import base64
import hashlib
import hmac
import unicodedata

from django.conf import settings

# Tamanhos dos valores que o navegador manda (em bytes, depois de decodificar o base64)
AUTH_KEY_BYTES = 32
SALT_BYTES = 16
# Chave do cofre trancada: 12 (IV) + 32 (chave) + 16 (tag do GCM)
WRAPPED_KEY_BYTES = 60
VAULT_MAX_BYTES = 64 * 1024
# PBKDF2-SHA256 no navegador (recomendação da OWASP para 2023+). Fica gravado por conta, então dá
# para subir no futuro sem quebrar contas antigas.
KDF_ITERATIONS = 600_000


def normalize_email(email: str) -> str:
    return unicodedata.normalize("NFKC", (email or "").strip()).lower()


def _pepper() -> bytes:
    return settings.EMAIL_PEPPER.encode()


def email_digest(email: str) -> str | None:
    """Impressão digital do e-mail (64 caracteres hex) ou None se vazio."""
    value = normalize_email(email)
    if not value:
        return None
    return hmac.new(_pepper(), b"email:" + value.encode(), hashlib.sha256).hexdigest()


def fake_salt(login: str) -> str:
    """
    Salt de mentira, sempre o mesmo para o mesmo login, para quem não tem conta: assim a etapa
    antes do login não revela se um usuário ou e-mail existe.
    """
    raw = hmac.new(_pepper(), b"fake-salt:" + normalize_email(login).encode(), hashlib.sha256).digest()
    return base64.b64encode(raw[:SALT_BYTES]).decode()


def b64_bytes(value, *, size: int | None = None, max_size: int | None = None) -> bytes | None:
    """Decodifica base64 padrão e confere o tamanho. None se inválido."""
    if not isinstance(value, str) or not value or len(value) > 200_000:
        return None
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError):
        return None
    if size is not None and len(raw) != size:
        return None
    if max_size is not None and len(raw) > max_size:
        return None
    return raw
