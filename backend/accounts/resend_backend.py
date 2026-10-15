"""
Envio de e-mail pela API HTTPS do Resend (https://resend.com/docs/api-reference/emails/send-email).

Não usa SMTP porque o plano gratuito do Render bloqueia as portas de e-mail (25, 465 e 587).
Sem bibliotecas extras: um POST com urllib. Nada aqui vai para log com o endereço.
"""

import json
import logging
import urllib.error
import urllib.request

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

from decks.services.http import USER_AGENT

log = logging.getLogger(__name__)
API_URL = "https://api.resend.com/emails"


class ResendBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        sent = 0
        for msg in email_messages:
            body = {"from": msg.from_email, "to": list(msg.to), "subject": msg.subject, "text": msg.body}
            for content, mimetype in getattr(msg, "alternatives", []) or []:
                if mimetype == "text/html":
                    body["html"] = content
            req = urllib.request.Request(
                API_URL,
                data=json.dumps(body).encode(),
                method="POST",
                headers={
                    "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                    "Content-Type": "application/json",
                    "User-Agent": USER_AGENT,
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=15) as res:
                    if 200 <= res.status < 300:
                        sent += 1
            except (urllib.error.URLError, TimeoutError) as err:
                status = getattr(err, "code", None)
                log.warning("Resend recusou o envio (status %s)", status)
                if not self.fail_silently:
                    raise
        return sent
