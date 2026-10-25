"""
Regras dos torneios: inscrição, montar a chave ou os pods da liga, registrar resultados e avançar.

Chave (eliminatória): ao começar, os inscritos são sorteados (no 2x2, as duplas também) numa chave
do tamanho da potência de 2 seguinte; quem sobra sem adversário na 1ª rodada passa direto (bye).
Todas as partidas são criadas de uma vez; o vencedor de (rodada r, posição p) vai para
(r + 1, p // 2). Quem saiu do torneio perde a partida seguinte por W.O.

Liga: toda partida é de 4. Quem sobra (o resto da divisão por 4) folga na rodada, em rodízio:
folga quem folgou menos até ali. O número de rodadas é escolhido ao começar, entre os que dão o
mesmo número de partidas a todos (round_options: 5 jogadores, 5 ou 10 rodadas). Os pods de cada
rodada são sorteados evitando repetir quem já jogou junto. O resultado é a ordem de chegada e vale
POINTS por colocação (folga: 0). Quando todas as partidas da rodada terminam, a próxima é sorteada
entre quem continua; depois da última, o primeiro da classificação é o campeão.
"""

import random
import secrets
from itertools import combinations
from math import gcd

from django.db import transaction
from django.utils import timezone

from .models import Entry, Match, MatchSeat, Tournament

POINTS = (3, 2, 1)  # 1º, 2º e 3º lugar; 4º (e quem não apareceu) não pontua
MAX_ENTRIES = 64
MAX_ROUNDS = 10
ACTIVE_PER_USER = 3  # torneios não encerrados que uma conta pode organizar ao mesmo tempo
NAME_MAX = 60
# Sem letras e números que se confundem; 8 caracteres começando com T (os sorteios têm 6): não colide
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class TournamentError(Exception):
    """Ação inválida: a API devolve o código e nada muda."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def new_code() -> str:
    while True:
        code = "T" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(7))
        if not Match.objects.filter(code=code).exists():
            return code


POD = 4  # jogadores por partida da liga
CYCLE_MAX = 20  # rodízio mais longo que isso: as rodadas ficam livres (não dá para igualar as partidas)
POD_TRIES = 200  # sorteios tentados por rodada para achar os pods com menos reencontros


def pods_for(n: int) -> int:
    """Partidas por rodada (0: menos de 4 jogadores, a liga não começa)."""
    return n // POD


def round_cycle(n: int) -> int:
    """Menor número de rodadas em que todos folgam (e jogam) o mesmo tanto: 5 → 5, 6 → 3, 7 → 7, 8 → 1."""
    rest = n % POD
    return n // gcd(n, rest) if rest else 1


def round_options(n: int) -> list[int]:
    """Números de rodadas que dão o mesmo número de partidas a todos (até MAX_ROUNDS, ou um rodízio)."""
    if pods_for(n) == 0:
        return []
    cycle = round_cycle(n)
    if cycle > CYCLE_MAX:
        return list(range(1, MAX_ROUNDS + 1))
    return list(range(cycle, max(MAX_ROUNDS, cycle) + 1, cycle))


def points_for(place: int | None) -> int:
    return POINTS[place - 1] if place is not None and 1 <= place <= len(POINTS) else 0


# ---- criar e inscrever ---------------------------------------------------------------------


def create(user, data: dict) -> Tournament:
    from tables.state import deck_rules

    data = data if isinstance(data, dict) else {}
    name = data.get("name")
    name = " ".join(name.split())[:NAME_MAX] if isinstance(name, str) else ""
    if not name:
        raise TournamentError("name_required")
    kind = data.get("kind")
    if kind not in (Tournament.BRACKET, Tournament.LEAGUE):
        raise TournamentError("bad_kind")
    # Liga: as rodadas são escolhidas ao começar, quando já se sabe quantos jogadores há
    rounds = 0
    team_size = 1
    if kind == Tournament.BRACKET and data.get("team_size") == 2:
        team_size = 2
    active = Tournament.objects.filter(organizer=user).exclude(status=Tournament.FINISHED).count()
    if active >= ACTIVE_PER_USER:
        raise TournamentError("too_many")
    return Tournament.objects.create(
        name=name,
        kind=kind,
        team_size=team_size,
        rounds=rounds,
        organizer=user,
        friends_only=data.get("friends_only") is True,
        rules=deck_rules(data),
    )


def entry_of(t: Tournament, user_id: int) -> Entry | None:
    return next((e for e in t.entries.all() if user_id in e.user_ids()), None)


def join(t: Tournament, user, friends: set[int]) -> Entry:
    if t.status != Tournament.OPEN:
        raise TournamentError("not_open")
    if t.friends_only and user.id != t.organizer_id and t.organizer_id not in friends:
        raise TournamentError("friends_only")
    with transaction.atomic():
        Tournament.objects.select_for_update().filter(pk=t.pk).first()
        if entry_of(t, user.id):
            raise TournamentError("already_in")
        if t.entries.count() >= MAX_ENTRIES:
            raise TournamentError("full")
        return Entry.objects.create(tournament=t, user=user)


def leave(t: Tournament, entry: Entry) -> None:
    """Inscrições abertas: a inscrição some. Torneio em andamento: o inscrito sai (drop)."""
    if t.status == Tournament.OPEN:
        entry.delete()
    elif t.status == Tournament.RUNNING:
        drop(t, entry)
    else:
        raise TournamentError("finished")


# ---- começar -------------------------------------------------------------------------------


@transaction.atomic
def start(t: Tournament, rng: random.Random | None = None, rounds=None) -> None:
    """`rounds`: na liga, o número de rodadas (um de round_options)."""
    rng = rng or random.Random()
    if t.status != Tournament.OPEN:
        raise TournamentError("not_open")
    entries = list(t.entries.filter(dropped=False))
    if t.kind == Tournament.LEAGUE:
        if pods_for(len(entries)) == 0:
            raise TournamentError("league_players")
        if rounds is not None:
            t.rounds = rounds
        if t.rounds not in round_options(len(entries)):
            raise TournamentError("bad_rounds")
        _start(t)
        _league_round(t, rng)
        return
    if t.team_size == 2:
        if len(entries) < 4 or len(entries) % 2:
            raise TournamentError("pairs_players")
        rng.shuffle(entries)
        teams = []
        for a, b in zip(entries[::2], entries[1::2]):
            a.partner_id = b.user_id
            a.save(update_fields=["partner"])
            b.delete()
            teams.append(a)
        entries = teams
    elif len(entries) < 2:
        raise TournamentError("bracket_players")
    rng.shuffle(entries)
    n, size = len(entries), 2
    while size < n:
        size *= 2
    t.rounds = size.bit_length() - 1
    _start(t)
    half = size // 2
    for r in range(1, t.rounds + 1):
        Match.objects.bulk_create(
            Match(tournament=t, round=r, slot=s, code=new_code()) for s in range(size >> r)
        )
    first = {m.slot: m for m in t.matches.filter(round=1)}
    seats = []
    for i in range(half):
        seats.append(MatchSeat(match=first[i], entry=entries[i], side=0))
        if i + half < n:
            seats.append(MatchSeat(match=first[i], entry=entries[i + half], side=1))
    MatchSeat.objects.bulk_create(seats)
    # Sem adversário na 1ª rodada: passa direto (bye)
    for i in range(n - half, half):
        _bracket_win(t, first[i], entries[i])


def _start(t: Tournament) -> None:
    t.status = Tournament.RUNNING
    t.started_at = timezone.now()
    t.round = 1 if t.kind == Tournament.BRACKET else 0
    t.save()


# ---- chave ---------------------------------------------------------------------------------


def _bracket_win(t: Tournament, match: Match, entry: Entry) -> None:
    match.winner = entry
    match.done = True
    match.finished_at = timezone.now()
    match.save(update_fields=["winner", "done", "finished_at"])
    if match.round >= t.rounds:
        _finish(t, entry)
        return
    nxt = t.matches.get(round=match.round + 1, slot=match.slot // 2)
    MatchSeat.objects.update_or_create(match=nxt, side=match.slot % 2, defaults={"entry": entry})
    _bracket_round(t)
    _walkover(t, nxt)


def _walkover(t: Tournament, match: Match) -> None:
    """Partida com os dois lados definidos e um deles fora do torneio: o outro passa (W.O.)."""
    if match.done:
        return
    seats = list(match.seats.select_related("entry"))
    if len(seats) < 2:
        return
    present = [s.entry for s in seats if not s.entry.dropped]
    if len(present) < 2:
        _bracket_win(t, match, present[0] if present else seats[0].entry)


def _bracket_round(t: Tournament) -> None:
    """Rodada atual da chave: a primeira que ainda tem partida em aberto."""
    pending = t.matches.filter(done=False).order_by("round").first()
    if pending and pending.round != t.round:
        t.round = pending.round
        t.save(update_fields=["round"])


# ---- liga ----------------------------------------------------------------------------------


def _league_round(t: Tournament, rng: random.Random | None = None) -> None:
    """Sorteia os pods da próxima rodada entre quem continua; sem gente para um pod, a liga acaba."""
    rng = rng or random.Random()
    entries = list(t.entries.filter(dropped=False))
    pods = pods_for(len(entries))
    if t.round >= t.rounds or pods == 0:
        _finish(t, None)
        return
    # Partidas já jogadas por cada um e quem já sentou junto (pares de inscritos)
    games: dict[int, int] = {}
    met: dict[tuple[int, int], int] = {}
    for match in t.matches.prefetch_related("seats"):
        ids = sorted(s.entry_id for s in match.seats.all())
        for e in ids:
            games[e] = games.get(e, 0) + 1
        for pair in combinations(ids, 2):
            met[pair] = met.get(pair, 0) + 1
    # Folga quem jogou mais (folgou menos); empate, sorteio
    rng.shuffle(entries)
    entries.sort(key=lambda e: -games.get(e.pk, 0))
    resting = len(entries) - pods * POD
    playing = entries[resting:]

    def repeats(order: list[Entry]) -> int:
        total = 0
        for k in range(pods):
            ids = sorted(e.pk for e in order[k * POD : (k + 1) * POD])
            total += sum(met.get(pair, 0) for pair in combinations(ids, 2))
        return total

    best, best_score = None, None
    for _ in range(POD_TRIES if pods > 1 else 1):
        rng.shuffle(playing)
        score = repeats(playing)
        if best_score is None or score < best_score:
            best, best_score = list(playing), score
        if score == 0:
            break
    t.round += 1
    t.save(update_fields=["round"])
    seats = []
    for slot in range(pods):
        match = Match.objects.create(tournament=t, round=t.round, slot=slot, code=new_code())
        seats += [MatchSeat(match=match, entry=e, side=k) for k, e in enumerate(best[slot * POD : (slot + 1) * POD])]
    MatchSeat.objects.bulk_create(seats)


def _league_places(t: Tournament, match: Match, order: list[Entry]) -> None:
    """Grava a ordem de chegada (quem do pod não está na lista: não apareceu, 0 ponto)."""
    place = {e.pk: i + 1 for i, e in enumerate(order)}
    for seat in match.seats.all():
        seat.place = place.get(seat.entry_id)
        seat.save(update_fields=["place"])
    match.winner = order[0]
    match.done = True
    match.finished_at = timezone.now()
    match.save(update_fields=["winner", "done", "finished_at"])
    if t.status == Tournament.FINISHED:
        _finish(t, None)  # resultado corrigido depois do fim: o campeão pode mudar
    elif not t.matches.filter(round=t.round, done=False).exists():
        _league_round(t)


def standings(t: Tournament) -> list[dict]:
    """Classificação da liga: pontos, depois vitórias, depois menos partidas jogadas."""
    rows = {e.pk: {"entry": e.pk, "points": 0, "wins": 0, "games": 0, "places": []} for e in t.entries.all()}
    for seat in MatchSeat.objects.filter(match__tournament=t, match__done=True):
        row = rows.get(seat.entry_id)
        if row is None:
            continue
        row["games"] += 1
        row["points"] += points_for(seat.place)
        row["wins"] += seat.place == 1
        row["places"].append(seat.place)
    return sorted(rows.values(), key=lambda r: (-r["points"], -r["wins"], r["games"], r["entry"]))


def _finish(t: Tournament, champion: Entry | None) -> None:
    if t.kind == Tournament.LEAGUE:
        table = standings(t)
        champion = Entry.objects.filter(pk=table[0]["entry"]).first() if table and table[0]["games"] else None
    t.champion = champion
    t.status = Tournament.FINISHED
    t.finished_at = t.finished_at or timezone.now()
    t.save(update_fields=["champion", "status", "finished_at"])


# ---- resultados ------------------------------------------------------------------------------


def _match_entries(match: Match) -> list[Entry]:
    return [s.entry for s in match.seats.select_related("entry")]


@transaction.atomic
def set_result(t: Tournament, match: Match, order: list[Entry]) -> None:
    """
    Resultado de uma partida: na chave, order[0] é o vencedor; na liga, a ordem de chegada (pode
    faltar quem não apareceu). O organizador pode corrigir uma partida encerrada: na chave, só
    enquanto a partida seguinte não terminou.
    """
    entries = _match_entries(match)
    ids = {e.pk for e in entries}
    if not order or len({e.pk for e in order}) != len(order) or any(e.pk not in ids for e in order):
        raise TournamentError("bad_result")
    if t.kind == Tournament.LEAGUE:
        if t.status == Tournament.OPEN:
            raise TournamentError("not_started")
        _league_places(t, match, order)
        return
    if len(entries) < 2:
        raise TournamentError("not_ready")
    winner = order[0]
    if match.done:
        if match.winner_id == winner.pk:
            return
        if match.round < t.rounds:
            nxt = t.matches.get(round=match.round + 1, slot=match.slot // 2)
            if nxt.done:
                raise TournamentError("locked")
            nxt.seats.filter(side=match.slot % 2).delete()
        if t.status == Tournament.FINISHED:
            t.status = Tournament.RUNNING
            t.finished_at = None
    _bracket_win(t, match, winner)


def report_from_table(match_id: int, winner_uid: int | None, placings: list[int] | None) -> bool:
    """
    Fim de partida confirmado na mesa do torneio (tables/consumers.py). Vale só para partida ainda
    em aberto: depois disso, só o organizador muda o resultado (pela página do torneio).
    """
    match = Match.objects.select_related("tournament").filter(pk=match_id).first()
    if match is None or match.done or match.tournament.status != Tournament.RUNNING:
        return False
    by_user = {uid: e for e in _match_entries(match) for uid in e.user_ids()}
    order = []
    for uid in placings or [winner_uid]:
        entry = by_user.get(uid)
        if entry is None:
            return False
        if entry not in order:
            order.append(entry)
    try:
        set_result(match.tournament, match, order)
    except TournamentError:
        return False
    return True


@transaction.atomic
def drop(t: Tournament, entry: Entry) -> None:
    """
    Tira o inscrito do torneio. Chave: a partida dele que está em aberto vai para o adversário
    (W.O.). Liga: fica fora dos próximos pods; a partida em aberto o organizador resolve.
    """
    if t.status == Tournament.OPEN:
        entry.delete()
        return
    if t.status != Tournament.RUNNING or entry.dropped:
        return
    entry.dropped = True
    entry.save(update_fields=["dropped"])
    if t.kind == Tournament.BRACKET:
        match = t.matches.filter(done=False, seats__entry=entry).first()
        if match:
            _walkover(t, match)
    elif not t.entries.filter(dropped=False).exists():
        _finish(t, None)
