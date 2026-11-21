from datetime import UTC, date, datetime
from unittest import mock

from django.test import TestCase, override_settings

from accounts.models import DbAwakeDay
from config import dbawake


def ts(day: int, hour: float) -> float:
    return datetime(2026, 11, day, tzinfo=UTC).timestamp() + hour * 3600


@override_settings(NEON_CU=0.25, NEON_SUSPEND_SECONDS=300, NEON_CU_HOURS_LIMIT=100, NEON_CU_HOURS_BEFORE=0)
class DbAwakeTests(TestCase):
    def setUp(self):
        dbawake._start = dbawake._last = None
        dbawake._pending.clear()

    def test_queries_close_together_are_one_awake_period(self):
        dbawake.note(ts(10, 1))
        dbawake.note(ts(10, 1) + 200)  # menos de 5 min: estica
        dbawake.note(ts(10, 3))  # mais de 5 min depois: fecha o anterior (200 s + 300 s acordado)
        self.assertAlmostEqual(dbawake._pending[date(2026, 11, 10)], 500)

    def test_period_across_midnight_is_split_by_day(self):
        dbawake.note(ts(10, 23.95))  # 23:57
        dbawake.note(ts(11, 5))
        self.assertAlmostEqual(dbawake._pending[date(2026, 11, 10)], 180)
        self.assertAlmostEqual(dbawake._pending[date(2026, 11, 11)], 120)

    def test_flush_adds_to_the_day_and_month_usage_counts_everything(self):
        DbAwakeDay.objects.create(day=date(2026, 11, 1), seconds=4 * 3600)
        DbAwakeDay.objects.create(day=date(2026, 10, 31), seconds=99 * 3600)  # outro mês: fora
        dbawake._pending[date(2026, 11, 1)] = 3600
        dbawake.flush()
        self.assertAlmostEqual(DbAwakeDay.objects.get(day=date(2026, 11, 1)).seconds, 5 * 3600)
        dbawake.note(ts(2, 0))  # período aberto: uma consulta só deixa o banco acordado 5 min
        usage = dbawake.month_usage(now=ts(2, 1))
        self.assertEqual(usage["hours_awake"], 5.08)
        self.assertEqual(usage["cu_hours"], 1.27)
        self.assertEqual(usage["since"], "2026-11-01")
        # ~1,27 CU-h em 25 h de mês: no ritmo, 1,27 / 25 × 720 h de novembro
        self.assertEqual(usage["projected"], 36.6)

    def test_flush_failure_keeps_the_seconds(self):
        dbawake._pending[date(2026, 11, 1)] = 60
        with mock.patch.object(DbAwakeDay.objects, "filter", side_effect=RuntimeError):
            dbawake.flush()
        self.assertEqual(dbawake._pending[date(2026, 11, 1)], 60)
