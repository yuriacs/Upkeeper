"""
O que o navegador faz no cadastro e no login, simplificado para os testes. O servidor não
consegue conferir a criptografia (só tamanhos), então aqui basta gerar valores do tamanho certo
e uma auth_key que dependa da senha e do salt. A criptografia de verdade fica em
frontend/src/lib/vault.ts.
"""

import base64
import hashlib
import os


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def new_salt() -> str:
    return b64(os.urandom(16))


def auth_key(password: str, salt: str) -> str:
    return b64(hashlib.sha256(f"{salt}|{password}".encode()).digest())


def vault(data: bytes = b"cifrado") -> dict:
    return {
        "key_by_secret": b64(os.urandom(60)),
        "key_by_recovery": b64(os.urandom(60)),
        "data": b64(os.urandom(28) + data),
    }


def register_body(username: str, email: str, password: str) -> dict:
    salt = new_salt()
    return {"username": username, "email": email, "auth_key": auth_key(password, salt), "salt": salt, "vault": vault()}


def register(client, username: str, email: str, password: str):
    return client.post("/api/auth/register/", register_body(username, email, password), content_type="application/json")


def login(client, login_value: str, password: str, **extra):
    pre = client.post("/api/auth/prelogin/", {"login": login_value}, content_type="application/json", **extra).json()
    if pre["scheme"] == "legacy":
        salt = new_salt()
        body = {"login": login_value, "password": password,
                "upgrade": {"auth_key": auth_key(password, salt), "salt": salt}}
    else:
        body = {"login": login_value, "auth_key": auth_key(password, pre["salt"])}
    return client.post("/api/auth/login/", body, content_type="application/json", **extra)
