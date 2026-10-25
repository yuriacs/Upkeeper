from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from accounts.friends import friend_ids

from . import services
from .models import Entry, Match, Tournament


def _error(code: str, http=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": code, "code": code}, status=http)


def _uid(request) -> int | None:
    return request.user.id if request.user.is_authenticated else None


def _summary(t: Tournament, uid: int | None, joined: set[int]) -> dict:
    return {
        "id": t.pk,
        "name": t.name,
        "kind": t.kind,
        "team_size": t.team_size,
        "rounds": t.rounds,
        "round": t.round,
        "status": t.status,
        "friends_only": t.friends_only,
        "organizer": t.organizer.username if t.organizer else None,
        "entries": t.n_entries,
        "joined": t.pk in joined,
        "created_at": t.created_at.isoformat(),
    }


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def tournaments(request):
    """
    GET: torneios com inscrição aberta e em andamento, e os últimos encerrados. Os "só amigos"
    aparecem só para os amigos de quem organiza (e para quem está nele). POST: cria um torneio.
    """
    uid = _uid(request)
    if request.method == "POST":
        if uid is None:
            return _error("login", status.HTTP_401_UNAUTHORIZED)
        try:
            t = services.create(request.user, request.data)
        except services.TournamentError as err:
            return _error(err.code)
        return Response({"id": t.pk}, status=status.HTTP_201_CREATED)
    joined = set()
    if uid:
        joined = set(
            Entry.objects.filter(Q(user_id=uid) | Q(partner_id=uid)).values_list("tournament_id", flat=True)
        )
    friends = friend_ids(uid) if uid else set()
    visible = Q(friends_only=False) | Q(organizer_id__in=friends | ({uid} if uid else set())) | Q(pk__in=joined)
    base = Tournament.objects.filter(visible).select_related("organizer").annotate(n_entries=Count("entries"))
    live = list(base.exclude(status=Tournament.FINISHED).order_by("status", "-created_at")[:50])
    done = list(base.filter(status=Tournament.FINISHED).order_by("-finished_at")[:20])
    return Response({"tournaments": [_summary(t, uid, joined) for t in live + done]})


def _detail(t: Tournament, request) -> dict:
    uid = _uid(request)
    entries = list(t.entries.select_related("user", "partner"))
    matches = list(t.matches.prefetch_related("seats"))

    def name(e: Entry) -> str:
        return " & ".join(u.username for u in (e.user, e.partner) if u) or "—"  # conta excluída

    mine = next((e for e in entries if uid is not None and uid in e.user_ids()), None)
    out_matches = []
    your_match = None
    for m in matches:
        seats = [{"entry": s.entry_id, "side": s.side, "place": s.place} for s in m.seats.all()]
        you = mine is not None and any(s["entry"] == mine.pk for s in seats)
        full = len(seats) >= (2 if t.kind == Tournament.BRACKET else 3)
        if you and full and not m.done and t.status == Tournament.RUNNING:
            your_match = m.code
        out_matches.append({
            "id": m.pk,
            "round": m.round,
            "slot": m.slot,
            "code": m.code if full else None,
            "done": m.done,
            "winner": m.winner_id,
            "bye": m.done and len(seats) == 1,
            "seats": seats,
        })
    # Liga: quem folgou em cada rodada (inscritos ativos sem lugar em nenhuma partida dela)
    rests = {}
    if t.kind == Tournament.LEAGUE:
        active = [e.pk for e in entries if not e.dropped]
        for r in range(1, t.round + 1):
            seated = {s["entry"] for m in out_matches if m["round"] == r for s in m["seats"]}
            rests[r] = [e for e in active if e not in seated]
    league_open = t.kind == Tournament.LEAGUE and t.status == Tournament.OPEN
    can_join = False
    if uid is not None and t.status == Tournament.OPEN and mine is None:
        can_join = not t.friends_only or uid == t.organizer_id or t.organizer_id in friend_ids(uid)
    return {
        "id": t.pk,
        "name": t.name,
        "kind": t.kind,
        "team_size": t.team_size,
        "rounds": t.rounds,
        "round": t.round,
        "status": t.status,
        "friends_only": t.friends_only,
        "rules": t.rules,
        "organizer": t.organizer.username if t.organizer else None,
        "created_at": t.created_at.isoformat(),
        "champion": t.champion_id,
        "entries": [
            {
                "id": e.pk,
                "name": name(e),
                "players": [u.username for u in (e.user, e.partner) if u],
                "dropped": e.dropped,
                "you": e is mine,
            }
            for e in entries
        ],
        "matches": out_matches,
        "standings": services.standings(t) if t.kind == Tournament.LEAGUE else None,
        "points": list(services.POINTS),
        "rests": rests,
        # Liga com inscrições abertas: as rodadas possíveis com quem está inscrito agora
        "round_options": services.round_options(len(entries)) if league_open else [],
        "you": mine.pk if mine else None,
        "your_match": your_match,
        "can_join": can_join,
        "can_manage": uid is not None and (uid == t.organizer_id or request.user.is_staff),
    }


@api_view(["GET", "DELETE"])
@permission_classes([AllowAny])
def tournament_detail(request, pk: int):
    """A página do torneio: inscritos, partidas (chave ou rodadas) e, na liga, a classificação."""
    t = get_object_or_404(Tournament.objects.select_related("organizer"), pk=pk)
    if request.method == "DELETE":
        if not _manages(request, t):
            return _error("not_organizer", status.HTTP_403_FORBIDDEN)
        t.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    return Response(_detail(t, request))


def _manages(request, t: Tournament) -> bool:
    return request.user.is_authenticated and (request.user.id == t.organizer_id or request.user.is_staff)


def _act(request, t: Tournament, action) -> Response:
    try:
        action()
    except services.TournamentError as err:
        return _error(err.code)
    t.refresh_from_db()
    return Response(_detail(t, request))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def join(request, pk: int):
    t = get_object_or_404(Tournament, pk=pk)
    return _act(request, t, lambda: services.join(t, request.user, friend_ids(request.user.id)))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def leave(request, pk: int):
    t = get_object_or_404(Tournament, pk=pk)
    entry = services.entry_of(t, request.user.id)
    if entry is None:
        return _error("not_in")
    return _act(request, t, lambda: services.leave(t, entry))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def start(request, pk: int):
    t = get_object_or_404(Tournament, pk=pk)
    if not _manages(request, t):
        return _error("not_organizer", status.HTTP_403_FORBIDDEN)
    rounds = request.data.get("rounds") if isinstance(request.data, dict) else None
    if rounds is not None and (not isinstance(rounds, int) or isinstance(rounds, bool)):
        return _error("bad_rounds")
    return _act(request, t, lambda: services.start(t, rounds=rounds))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def drop(request, pk: int, entry_id: int):
    """O organizador tira um inscrito (antes de começar, a inscrição some; depois, W.O. na chave)."""
    t = get_object_or_404(Tournament, pk=pk)
    if not _manages(request, t):
        return _error("not_organizer", status.HTTP_403_FORBIDDEN)
    entry = get_object_or_404(Entry, pk=entry_id, tournament=t)
    return _act(request, t, lambda: services.drop(t, entry))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def result(request, pk: int, match_id: int):
    """O organizador marca (ou corrige) o resultado: {"order": [ids dos inscritos, do 1º em diante]}."""
    t = get_object_or_404(Tournament, pk=pk)
    if not _manages(request, t):
        return _error("not_organizer", status.HTTP_403_FORBIDDEN)
    match = get_object_or_404(Match, pk=match_id, tournament=t)
    ids = request.data.get("order") if isinstance(request.data, dict) else None
    if not isinstance(ids, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids):
        return _error("bad_result")
    found = Entry.objects.in_bulk(ids)
    if len(found) != len(ids):
        return _error("bad_result")
    return _act(request, t, lambda: services.set_result(t, match, [found[i] for i in ids]))
