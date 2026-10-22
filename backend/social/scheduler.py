"""
Horários da curadoria do Instagram: o servidor roda `manage.py social_run` num processo separado
em cada horário de SOCIAL_SLOTS (fuso do site), como as sincronizações (config/syncs.py). Só liga
com SOCIAL_CURATION_ENABLED=true. Horário perdido (servidor reiniciando) fica para o próximo.
"""

import logging
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta

from django.conf import settings
from django.utils import timezone

log = logging.getLogger(__name__)


def next_slot(now: datetime, slots: list[str]) -> datetime:
    """Próximo horário "HH:MM" depois de `now` (com fuso)."""
    times = sorted(datetime.strptime(s.strip(), "%H:%M").time() for s in slots)
    for day in (0, 1):
        for t in times:
            when = datetime.combine(now.date() + timedelta(days=day), t, tzinfo=now.tzinfo)
            if when > now:
                return when
    raise ValueError("SOCIAL_SLOTS vazio")


def _loop():
    cmd = [sys.executable, "-u", str(settings.BASE_DIR / "manage.py"), "social_run"]
    while True:
        now = timezone.localtime()
        time.sleep(max((next_slot(now, settings.SOCIAL_SLOTS) - now).total_seconds(), 1))
        try:
            subprocess.run(cmd, cwd=settings.BASE_DIR, check=False, timeout=30 * 60)
        except (OSError, subprocess.TimeoutExpired) as exc:
            log.warning("social_run não rodou: %s", exc)


def start_social_schedule():
    if settings.SOCIAL_CURATION_ENABLED and not settings.TESTING:
        threading.Thread(target=_loop, name="social-run", daemon=True).start()
