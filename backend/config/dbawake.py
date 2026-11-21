"""
Quanto do compute do Neon o mês já gastou, estimado aqui mesmo: no plano grátis a API do Neon não
informa as CU-horas (o endpoint de consumo é só dos planos pagos e os números do projeto não servem
para cobrança). O Neon fica acordado enquanto chegam consultas e dorme SUSPEND segundos depois da
última; então cada consulta deste processo abre ou estica um "período acordado". CU-horas = horas
acordado × tamanho do compute (NEON_CU).

Os segundos ficam na memória e vão para o banco (accounts.DbAwakeDay, por dia UTC) a cada FLUSH_EVERY
segundos, só logo depois de uma consulta (o banco já está acordado; gravar não o acorda), e ao sair.
Um reinício sem aviso perde no máximo esses minutos. O processo das sincronizações (run_syncs) também
conta; se rodar junto com o site, o mesmo período conta duas vezes (a estimativa erra para mais).
"""

import atexit
import threading
import time
from datetime import UTC, date, datetime, timedelta

from django.conf import settings
from django.db.backends.signals import connection_created

FLUSH_EVERY = 600

_lock = threading.Lock()
_local = threading.local()  # gravando: as consultas da própria gravação não contam
_start: float | None = None  # começo do período acordado aberto
_last: float | None = None  # última consulta
_pending: dict[date, float] = {}  # segundos acordado ainda não gravados, por dia UTC
_installed = False


def _midnight(day: date) -> float:
    return datetime.combine(day, datetime.min.time(), UTC).timestamp()


def _split(a: float, b: float, into: dict[date, float]) -> None:
    """Soma o intervalo [a, b] (segundos epoch) nos dias UTC em que ele cai."""
    while b > a:
        day = datetime.fromtimestamp(a, UTC).date()
        end = min(b, _midnight(day + timedelta(days=1)))
        into[day] = into.get(day, 0.0) + (end - a)
        a = end


def note(now: float | None = None) -> None:
    """Uma consulta agora: estica o período acordado ou fecha o anterior e abre outro."""
    global _start, _last
    now = time.time() if now is None else now
    suspend = settings.NEON_SUSPEND_SECONDS
    with _lock:
        if _last is not None and now - _last <= suspend:
            _last = max(_last, now)
            return
        if _start is not None and _last is not None:
            _split(_start, _last + suspend, _pending)
        _start = _last = now


def _wrapper(execute, sql, params, many, context):
    if not getattr(_local, "flushing", False):
        note()
    return execute(sql, params, many, context)


def _on_connection(sender, connection, **kwargs):
    if _wrapper not in connection.execute_wrappers:
        connection.execute_wrappers.append(_wrapper)


def flush(final: bool = False) -> None:
    """Grava os segundos pendentes (no fim do processo, também o período aberto, até a hora de dormir)."""
    global _start, _last
    from django.db import connection
    from django.db.models import F

    from accounts.models import DbAwakeDay

    with _lock:
        todo = dict(_pending)
        _pending.clear()
        if final and _start is not None and _last is not None:
            _split(_start, _last + settings.NEON_SUSPEND_SECONDS, todo)
            _start = _last = None
    if not todo:
        return
    _local.flushing = True
    try:
        for day, seconds in todo.items():
            if not DbAwakeDay.objects.filter(day=day).update(seconds=F("seconds") + seconds):
                DbAwakeDay.objects.create(day=day, seconds=seconds)
    except Exception:  # noqa: BLE001 — banco fora do ar: fica para a próxima vez
        with _lock:
            for day, seconds in todo.items():
                _pending[day] = _pending.get(day, 0.0) + seconds
    finally:
        _local.flushing = False
        if not final:
            connection.close()  # esta thread dorme: não segura conexão com o banco


def _loop():
    while True:
        time.sleep(FLUSH_EVERY)
        if _pending and _last is not None and time.time() - _last < 60:
            flush()


def install() -> None:
    """Liga a contagem (AccountsConfig.ready); nos testes, não."""
    global _installed
    if _installed or settings.TESTING:
        return
    _installed = True
    connection_created.connect(_on_connection, weak=False)
    threading.Thread(target=_loop, name="db-awake", daemon=True).start()
    atexit.register(lambda: flush(final=True))


def month_usage(now: float | None = None) -> dict:
    """Uso do mês (UTC) para o painel do admin: horas acordado, CU-horas, limite e projeção."""
    from accounts.models import DbAwakeDay

    now = time.time() if now is None else now
    today = datetime.fromtimestamp(now, UTC).date()
    first = today.replace(day=1)
    days = {d.day: d.seconds for d in DbAwakeDay.objects.filter(day__gte=first)}
    extra: dict[date, float] = {}
    with _lock:
        for day, seconds in _pending.items():
            extra[day] = extra.get(day, 0.0) + seconds
        if _start is not None and _last is not None:
            _split(_start, min(now, _last + settings.NEON_SUSPEND_SECONDS), extra)
    for day, seconds in extra.items():
        if day >= first:
            days[day] = days.get(day, 0.0) + seconds
    seconds = sum(days.values())
    cu_hours = seconds / 3600 * settings.NEON_CU
    month_end = _midnight((first + timedelta(days=32)).replace(day=1))
    since = min(days) if days else None
    projected = None
    if since is not None:
        # Ritmo desde o primeiro dia medido (a contagem pode ter começado no meio do mês); o que foi
        # gasto antes dela entra por NEON_CU_HOURS_BEFORE
        start = _midnight(since)
        rate = cu_hours / max(now - start, 3600)
        before = settings.NEON_CU_HOURS_BEFORE if since > first else 0
        projected = before + rate * (month_end - start)
    return {
        "tracking": _installed,
        "month": first.isoformat(),
        "since": since.isoformat() if since else None,
        "hours_awake": round(seconds / 3600, 2),
        "cu": settings.NEON_CU,
        "cu_hours": round(cu_hours, 2),
        "before": settings.NEON_CU_HOURS_BEFORE if since and since > first else 0,
        "limit": settings.NEON_CU_HOURS_LIMIT,
        "projected": round(projected, 1) if projected is not None else None,
        "by_day": [{"date": d.isoformat(), "hours": round(s / 3600, 2)} for d, s in sorted(days.items())],
    }
