"""
Sincronizações com serviços externos (`manage.py run_syncs`) fora do build do deploy.

O servidor, depois de subir, espera um pouco e roda o comando num processo separado (a memória
dele volta quando termina e um erro lá não derruba o site), se a última rodada registrada no banco
tiver mais de 24 horas; depois repete a cada 24 horas, para quem fica dias sem deploy. Liga
sozinho em produção (DEBUG=False); SYNCS_ENABLED=false desliga.
"""

import logging
import shutil
import subprocess
import sys
import threading
import time

from django.conf import settings

log = logging.getLogger(__name__)


# Rodada que não registrou a hora no banco (caiu no meio): tenta de novo depois disso
RETRY = 3600


def seconds_until_due() -> float:
    """
    Quanto falta para a próxima rodada, contando da última registrada no banco: a instância grátis
    hiberna e sobe de novo várias vezes por dia, e cada subida rodava tudo (Scryfall e banco) outra vez.
    """
    from django.db import connection
    from django.utils import timezone

    from decks.management.commands.run_syncs import RUN_RULE
    from decks.models import TagSync

    try:
        last = TagSync.objects.filter(tag=RUN_RULE).values_list("synced_at", flat=True).first()
    except Exception as exc:  # noqa: BLE001 — banco fora do ar: roda como antes
        log.warning("run_syncs: hora da última rodada não lida: %s", exc)
        return 0
    finally:
        if not connection.in_atomic_block:  # (nos testes, tudo roda numa transação)
            connection.close()  # esta thread dorme horas: não segura conexão com o banco
    if last is None:
        return 0
    return settings.SYNCS_INTERVAL - (timezone.now() - last).total_seconds()


def _loop():
    time.sleep(settings.SYNCS_DELAY)
    cmd = [sys.executable, "-u", str(settings.BASE_DIR / "manage.py"), "run_syncs"]
    if shutil.which("nice"):
        cmd = ["nice", "-n", "10", *cmd]  # a mesa e a API têm prioridade
    while True:
        wait = seconds_until_due()
        if wait <= 0:
            try:
                subprocess.run(cmd, cwd=settings.BASE_DIR, check=False)
            except OSError as exc:
                log.warning("run_syncs não rodou: %s", exc)
            wait = max(seconds_until_due(), RETRY)
        time.sleep(wait)


def start_background_syncs():
    if settings.SYNCS_ENABLED:
        threading.Thread(target=_loop, name="run-syncs", daemon=True).start()
