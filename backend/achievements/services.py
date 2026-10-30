"""
Gravar progresso e conquistas. Tudo em lotes (uma consulta para ler, uma para criar e uma para
atualizar): o fim de uma partida mexe em várias conquistas de até 4 contas, e o banco (Neon) leva
dezenas de ms por consulta.
"""

from datetime import datetime

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from .catalog import (
    COMEBACK_LIFE,
    GOALS,
    MARATHON_SECONDS,
    MAX_PODS,
    MAX_WATCH_SESSION,
    PLAYGROUP_SIZE,
    SPEEDRUN_TURNS,
)
from .models import UserAchievement


class Batch:
    """Conquistas de algumas contas, lidas de uma vez, alteradas na memória e gravadas no save()."""

    def __init__(self, user_ids, keys):
        self.user_ids = set(user_ids)
        self.rows = {
            (r.user_id, r.key): r
            for r in UserAchievement.objects.select_for_update().filter(user_id__in=self.user_ids, key__in=list(keys))
        }
        self.new: set[tuple[int, str]] = set()
        self.dirty: set[tuple[int, str]] = set()
        self.unlocked: list[tuple[int, str]] = []

    def row(self, uid: int, key: str) -> UserAchievement:
        row = self.rows.get((uid, key))
        if row is None:
            row = self.rows[(uid, key)] = UserAchievement(user_id=uid, key=key, progress=0, data={})
            self.new.add((uid, key))
        return row

    def earned(self, uid: int, key: str) -> bool:
        row = self.rows.get((uid, key))
        return bool(row and row.earned_at)

    def set(self, uid: int, key: str, value: int) -> None:
        """Progresso passa a ser `value` (no máximo a meta); chegou na meta: ganha."""
        if uid not in self.user_ids or self.earned(uid, key):
            return
        row = self.row(uid, key)
        goal = GOALS[key]
        row.progress = max(row.progress, min(goal, value))
        if row.progress >= goal:
            row.earned_at = timezone.now()
            row.data = {}
            self.unlocked.append((uid, key))
        self.dirty.add((uid, key))

    def add(self, uid: int, key: str, amount: int) -> None:
        if amount > 0 and not self.earned(uid, key):
            self.set(uid, key, self.row(uid, key).progress + amount)

    def unlock(self, uid: int, key: str) -> None:
        self.set(uid, key, GOALS[key])

    def save(self) -> list[tuple[int, str]]:
        """Grava e devolve as conquistas ganhas agora: [(user_id, chave)]."""
        created = [self.rows[k] for k in self.new if k in self.dirty]
        changed = [self.rows[k] for k in self.dirty if k not in self.new]
        if created:
            UserAchievement.objects.bulk_create(created, ignore_conflicts=True)
        if changed:
            UserAchievement.objects.bulk_update(changed, ["progress", "data", "earned_at"])
        for uid in {uid for uid, _ in self.unlocked}:
            cache.delete(f"profile:{uid}")  # o perfil público mostra as conquistas
        return self.unlocked


def _existing(user_ids) -> set[int]:
    """Contas que ainda existem (a mesa guarda o id; a conta pode ter sido excluída)."""
    ids = {u for u in user_ids if isinstance(u, int) and not isinstance(u, bool)}
    return set(get_user_model().objects.filter(pk__in=ids, is_active=True).values_list("pk", flat=True))


def earned_keys(user_id: int) -> set[str]:
    return set(UserAchievement.objects.filter(user_id=user_id, earned_at__isnull=False).values_list("key", flat=True))


def unlock_many(pairs) -> list[tuple[int, str]]:
    """Ganha as conquistas [(user_id, chave)]; devolve só as que a conta ainda não tinha."""
    pairs = [(uid, key) for uid, key in pairs if key in GOALS]
    if not pairs:
        return []
    users = _existing(uid for uid, _ in pairs)
    with transaction.atomic():
        batch = Batch(users, {key for _, key in pairs})
        for uid, key in pairs:
            batch.unlock(uid, key)
        return batch.save()


def unlock(user_id: int, key: str) -> bool:
    return bool(unlock_many([(user_id, key)]))


def add_progress(user_id: int, key: str, amount: int = 1) -> bool:
    """Soma no progresso. True se a conquista foi ganha agora."""
    if not _existing([user_id]):
        return False
    with transaction.atomic():
        batch = Batch([user_id], [key])
        batch.add(user_id, key, amount)
        return bool(batch.save())


def add_watch_time(user_id: int, seconds: float) -> bool:
    """Tempo assistindo uma mesa (Voyeur). True se a conquista foi ganha agora."""
    seconds = int(min(MAX_WATCH_SESSION, max(0, seconds)))
    return add_progress(user_id, "voyeur", seconds) if seconds else False


def _deck_info(decks: dict[int, dict]) -> dict[int, tuple[str, int | None]]:
    """Identidade de cor e dono (None em precon) do deck de cada jogador: {user_id: (cores, dono)}."""
    from decks.models import Deck
    from pools.models import UserDeck

    slugs = {d["ref"] for d in decks.values() if d.get("kind") == "precon"}
    ids = {int(d["ref"]) for d in decks.values() if d.get("kind") == "user" and str(d.get("ref")).isdigit()}
    precons = dict(Deck.objects.filter(slug__in=slugs).values_list("slug", "color_identity"))
    own = {pk: (ci, owner) for pk, ci, owner in UserDeck.objects.filter(pk__in=ids).values_list("pk", "color_identity", "owner_id")}
    found = {}
    for uid, d in decks.items():
        if d.get("kind") == "precon" and d["ref"] in precons:
            found[uid] = (precons[d["ref"]] or "", None)
        elif d.get("kind") == "user" and str(d.get("ref")).isdigit() and int(d["ref"]) in own:
            found[uid] = own[int(d["ref"])]
    return found


GAME_KEYS = (
    "open_table", "playgroup", "marathon", "upkeeper", "mulligan_survivor", "speedrun", "comeback_kid",
    "color_pie", "wubrg", "not_my_deck", "stolen_thunder",
)  # fmt: skip


def record_game(summary: dict | None) -> list[tuple[int, str]]:
    """
    Fim de uma partida (tables/state.py, Table.game_summary): conquistas de quem jogou e do
    vencedor. Devolve as ganhas agora: [(user_id, chave)].

    summary = {"players": [user_id, ...], "seconds": duração, "winner": user_id | None,
               "seats": {user_id: {"deck": {"kind", "ref"}, "mulligan", "low", "turns", "upkeeps"}}}
    """
    if not summary:
        return []
    players = [uid for uid in summary.get("players") or () if isinstance(uid, int)]
    users = _existing(players)
    if len(players) < 2 or not users:
        return []
    seats = {int(k): v for k, v in (summary.get("seats") or {}).items()}
    winner = summary.get("winner")
    with transaction.atomic():
        batch = Batch(users, GAME_KEYS)
        for uid in users:
            others = [p for p in players if p != uid]
            seat = seats.get(uid) or {}
            # Open Table: pessoas diferentes com quem já jogou
            if not batch.earned(uid, "open_table"):
                row = batch.row(uid, "open_table")
                met = set(row.data.get("met") or ()) | set(others)
                row.data = {"met": sorted(met)}
                batch.set(uid, "open_table", len(met))
            # Playgroup: partidas de 4 com as mesmas 3 pessoas
            if len(players) == PLAYGROUP_SIZE and not batch.earned(uid, "playgroup"):
                row = batch.row(uid, "playgroup")
                pods = dict(row.data.get("pods") or {})
                pod = "-".join(str(p) for p in sorted(others))
                pods[pod] = pods.get(pod, 0) + 1
                if len(pods) > MAX_PODS:
                    pods = dict(sorted(pods.items(), key=lambda kv: -kv[1])[:MAX_PODS])
                row.data = {"pods": pods}
                batch.set(uid, "playgroup", max(pods.values()))
            if (summary.get("seconds") or 0) >= MARATHON_SECONDS:
                batch.unlock(uid, "marathon")
            batch.add(uid, "upkeeper", int(seat.get("upkeeps") or 0))
        if winner in users and winner in seats:
            seat = seats[winner]
            if seat.get("mulligan"):
                batch.unlock(winner, "mulligan_survivor")
            if 1 <= (seat.get("turns") or 0) <= SPEEDRUN_TURNS:
                batch.unlock(winner, "speedrun")
            if seat.get("low") is not None and seat["low"] <= COMEBACK_LIFE:
                batch.unlock(winner, "comeback_kid")
            decks = _deck_info({uid: s["deck"] for uid, s in seats.items() if isinstance(s.get("deck"), dict)})
            if winner in decks:
                colors, owner = decks[winner]
                if len(colors) == 1 and not batch.earned(winner, "color_pie"):
                    row = batch.row(winner, "color_pie")
                    won = set(row.data.get("colors") or ()) | {colors}
                    row.data = {"colors": sorted(won)}
                    batch.set(winner, "color_pie", len(won))
                if len(colors) == 5:
                    batch.unlock(winner, "wubrg")
                if owner is not None and owner != winner:
                    batch.unlock(winner, "not_my_deck")
                    if owner in players:
                        batch.unlock(winner, "stolen_thunder")
        return batch.save()


def unseen(user_id: int, limit: int = 5) -> list[dict]:
    """Conquistas ganhas que o site ainda não avisou (as mais antigas primeiro)."""
    rows = UserAchievement.objects.filter(user_id=user_id, earned_at__isnull=False, seen=False).order_by("earned_at")
    return [{"key": r.key, "earned_at": r.earned_at.isoformat()} for r in rows[:limit]]


def mark_seen(user_id: int, keys) -> None:
    keys = [k for k in keys if isinstance(k, str)][:50] if isinstance(keys, list) else []
    if keys:
        UserAchievement.objects.filter(user_id=user_id, key__in=keys, seen=False).update(seen=True)


def progress_for(user_id: int) -> dict[str, tuple[int, datetime | None]]:
    """{chave: (progresso, quando foi ganha ou None)} das conquistas guardadas da conta (perfil público)."""
    return {
        key: (progress, earned)
        for key, progress, earned in UserAchievement.objects.filter(user_id=user_id).values_list("key", "progress", "earned_at")
    }
