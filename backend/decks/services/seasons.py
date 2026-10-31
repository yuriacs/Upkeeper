"""
Temporadas mensais: o ranking de jogadores de cada mês, somando sorteios (pela hora em que o
resultado foi marcado) e mesas (pela hora em que a partida terminou), em todos os tamanhos de
partida. Quem mais ganhou no mês é o campeão (com pelo menos MIN_WINS vitórias); no empate, quem
precisou de menos partidas e depois o nome. O campeão de um mês que acabou fica gravado
(decks.SeasonChampion) e aparece no perfil. Meses pelo horário de Brasília (TIME_ZONE).
"""

from datetime import date, datetime, time

from django.core.cache import cache
from django.db.models import Count, Min, Q
from django.utils import timezone

from ..models import SeasonChampion
from .stats import WON, _rate, finished_entries

MIN_WINS = 3
TOP = 10
CHAMPIONS = 12  # campeões anteriores mostrados no ranking
CACHE_SECONDS = 120


def month_of(day: date) -> date:
    return day.replace(day=1)


def next_month(month: date) -> date:
    return date(month.year + (month.month == 12), month.month % 12 + 1, 1)


def previous_month(month: date) -> date:
    return date(month.year - (month.month == 1), (month.month - 2) % 12 + 1, 1)


def _start(month: date) -> datetime:
    return timezone.make_aware(datetime.combine(month, time.min))


def parse_month(value) -> date | None:
    """?month=AAAA-MM; inválido ou fora do que já passou: None (o mês atual)."""
    try:
        year, month = (int(x) for x in str(value).split("-"))
        found = date(year, month, 1)
    except (TypeError, ValueError):
        return None
    return found if date(2020, 1, 1) <= found <= month_of(timezone.localdate()) else None


def _rows(month: date) -> list[dict]:
    """Vitórias e partidas de cada conta no mês, em ordem (sem nome)."""
    from tables.models import TableResultEntry

    start, end = _start(month), _start(next_month(month))
    totals: dict[int, list[int]] = {}
    draws = (finished_entries().filter(player__isnull=False, draw__result_at__gte=start, draw__result_at__lt=end)
             .values("player_id").annotate(games=Count("id"), wins=Count("id", filter=WON)).order_by())
    tables = (TableResultEntry.objects.filter(player__isnull=False, result__finished_at__gte=start,
                                              result__finished_at__lt=end)
              .values("player_id").annotate(games=Count("id"), wins=Count("id", filter=Q(won=True))).order_by())
    for r in [*draws, *tables]:
        t = totals.setdefault(r["player_id"], [0, 0])
        t[0], t[1] = t[0] + r["games"], t[1] + r["wins"]
    return [{"id": uid, "games": g, "wins": w} for uid, (g, w) in totals.items() if w]


def _ordered(rows: list[dict]) -> list[dict]:
    from django.contrib.auth import get_user_model

    users = get_user_model().objects.in_bulk([r["id"] for r in rows])
    named = [{**r, "username": users[r["id"]].username} for r in rows if r["id"] in users]
    return sorted(named, key=lambda r: (-r["wins"], r["games"], r["username"].casefold()))


def close_past() -> None:
    """Grava o campeão de cada mês que já acabou e ainda não tem (do primeiro com partida até o anterior)."""
    from tables.models import TableResult

    last = previous_month(month_of(timezone.localdate()))
    if SeasonChampion.objects.filter(month=last).exists():
        return
    known = set(SeasonChampion.objects.values_list("month", flat=True))
    firsts = [
        finished_entries().aggregate(at=Min("draw__result_at"))["at"],
        TableResult.objects.aggregate(at=Min("finished_at"))["at"],
    ]
    firsts = [timezone.localtime(at).date() for at in firsts if at]
    if not firsts:
        return
    month = month_of(min(firsts))
    while month <= last:
        if month not in known:
            rows = _ordered(_rows(month))
            best = rows[0] if rows and rows[0]["wins"] >= MIN_WINS else None
            SeasonChampion.objects.get_or_create(month=month, defaults={
                "user_id": best["id"] if best else None, "wins": best["wins"] if best else 0,
                "games": best["games"] if best else 0,
            })
        month = next_month(month)


def _key(month: date) -> str:
    return f"stats:season:{month.isoformat()}"


def season(month: date | None = None) -> dict:
    """O ranking do mês (o atual sem `month`) e os últimos campeões."""
    from accounts.supporter import active_ids

    month = month or month_of(timezone.localdate())
    cached = cache.get(_key(month))
    if cached is not None:
        return cached
    close_past()
    players = _ordered(_rows(month))[:TOP]
    champions = list(SeasonChampion.objects.filter(user__isnull=False).select_related("user")[:CHAMPIONS])
    backers = active_ids([r["id"] for r in players] + [c.user_id for c in champions])
    data = {
        "month": month.isoformat(),
        "current": month == month_of(timezone.localdate()),
        "min_wins": MIN_WINS,
        "players": [
            {"username": r["username"], "games": r["games"], "wins": r["wins"], "win_rate": _rate(r["wins"], r["games"]),
             "supporter": r["id"] in backers}
            for r in players
        ],
        "champions": [
            {"month": c.month.isoformat(), "username": c.user.username, "wins": c.wins, "games": c.games,
             "supporter": c.user_id in backers}
            for c in champions
        ],
    }
    cache.set(_key(month), data, CACHE_SECONDS)
    return data


def invalidate() -> None:
    month = month_of(timezone.localdate())
    cache.delete_many([_key(month), _key(previous_month(month))])


def titles(user) -> list[str]:
    """Meses (AAAA-MM-01) em que a conta foi campeã, do mais novo ao mais antigo (perfil)."""
    close_past()
    return [m.isoformat() for m in SeasonChampion.objects.filter(user=user).values_list("month", flat=True)]
