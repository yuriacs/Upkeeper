"""
Sincronizações com serviços externos (`manage.py run_syncs`) fora do build do deploy.

O servidor, depois de subir, espera um pouco e roda o comando num processo separado (a memória
dele volta quando termina e um erro lá não derruba o site); depois repete a cada 24 horas,
para quem fica dias sem deploy. Liga sozinho em produção (DEBUG=False); SYNCS_ENABLED=false
desliga.
"""

import logging
import shutil
import subprocess
import sys
import threading
import time

from django.conf import settings

log = logging.getLogger(__name__)


def _loop():
    time.sleep(settings.SYNCS_DELAY)
    cmd = [sys.executable, "-u", str(settings.BASE_DIR / "manage.py"), "run_syncs"]
    if shutil.which("nice"):
        cmd = ["nice", "-n", "10", *cmd]  # a mesa e a API têm prioridade
    while True:
        try:
            subprocess.run(cmd, cwd=settings.BASE_DIR, check=False)
        except OSError as exc:
            log.warning("run_syncs não rodou: %s", exc)
        time.sleep(settings.SYNCS_INTERVAL)


def start_background_syncs():
    if settings.SYNCS_ENABLED:
        threading.Thread(target=_loop, name="run-syncs", daemon=True).start()
