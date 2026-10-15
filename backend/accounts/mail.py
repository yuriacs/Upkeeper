"""
E-mail de "esqueci a senha". O endereço vem do formulário, é usado no envio e descartado: o
servidor não grava e-mails (accounts/privacy.py). Nada aqui pode ir para log.
"""

import logging
import threading

from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import EmailMultiAlternatives
from django.utils import translation
from django.utils.encoding import force_bytes
from django.utils.html import escape
from django.utils.http import urlsafe_base64_encode
from django.utils.translation import gettext as _

log = logging.getLogger(__name__)


def reset_link(user) -> str:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    # Depois do "#": o navegador não manda essa parte para servidor nenhum (nem para os logs da Vercel)
    return f"{settings.FRONTEND_URL}/redefinir-senha#u={uid}&t={token}"


def _message(user, link: str, to: str) -> EmailMultiAlternatives:
    minutes = settings.PASSWORD_RESET_TIMEOUT // 60
    subject = _("Reset your Upkeeper password")
    text = _(
        "Hi, {username}!\n\n"
        "Someone (hopefully you) asked to reset the password of your Upkeeper account. "
        "To choose a new password, open this link within {minutes} minutes:\n\n{link}\n\n"
        "If it wasn't you, just ignore this email: your password stays the same.\n\n"
        "Your private profile is encrypted with your password. With your recovery code you keep it; "
        "without it, it starts empty again (your decks and history are not affected)."
    ).format(username=user.username, minutes=minutes, link=link)
    html = "".join(f"<p>{escape(p).replace(chr(10), '<br>')}</p>" for p in text.split("\n\n"))
    html = html.replace(escape(link), f'<a href="{escape(link)}">{escape(link)}</a>')
    msg = EmailMultiAlternatives(subject, text, settings.DEFAULT_FROM_EMAIL, [to])
    msg.attach_alternative(html, "text/html")
    return msg


def send_reset(user, to: str, *, background: bool = True) -> None:
    """
    Manda o link em outra thread: a resposta da API leva o mesmo tempo com ou sem conta, então o
    tempo de resposta não revela se o e-mail está cadastrado.
    """
    lang = translation.get_language()

    def run():
        with translation.override(lang):
            try:
                _message(user, reset_link(user), to).send()
            except Exception:  # noqa: BLE001 — falha de envio não derruba nada; o log não leva o endereço
                log.warning("password reset email failed for user %s", user.pk)

    if background and not settings.TESTING:
        threading.Thread(target=run, daemon=True).start()
    else:
        run()
