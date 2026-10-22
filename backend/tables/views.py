from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from accounts.friends import friend_ids

from . import state, store


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_tables(request):
    """Mesas ainda abertas (alteradas nos últimos 10 minutos) em que a conta tem lugar."""
    uid = request.user.id
    found: dict[str, dict] = {}
    # A memória tem o estado mais novo e quem está conectado; o banco cobre as mesas fora dela
    for code, table in list(state.TABLES.items()):
        if table.seat_of(uid) and not table.expired():
            found[code] = table.summary(uid)
    for data in store.active_rows_for(uid):
        if data["code"] not in found and data["code"] not in state.TABLES:
            found[data["code"]] = state.Table(data).summary(uid)
    tables = sorted(found.values(), key=lambda t: -t["idle_left"])
    return Response({"tables": tables, "idle_close": state.IDLE_CLOSE})


@api_view(["GET"])
@permission_classes([AllowAny])
def open_tables(request):
    """
    Todas as mesas abertas, para qualquer um ver na página da mesa: com lugar, dá para entrar;
    cheias, dá para assistir. Mesas sem ninguém sentado não aparecem; mesas "só amigos" aparecem
    só para os amigos de quem abriu (e para quem já está nela). As com gente conectada vêm primeiro.
    """
    uid = request.user.id if request.user.is_authenticated else None
    friends = friend_ids(uid) if uid else set()

    def visible(table: state.Table) -> bool:
        """Mesa "só amigos": aparece para quem pode sentar ou assistir (amigo de alguém sentado)."""
        if not table.options()["friends_only"] or table.data.get("host") is None:
            return True
        if uid is None:
            return False
        play, follow = table.access(uid, friends)
        return play or (follow and table.options()["allow_watch"])

    def summary(table: state.Table) -> dict:
        out = table.summary(uid)
        out["can_join"] = uid is None or table.access(uid, friends)[0]  # sem login: entrar leva ao login
        return out

    found: dict[str, dict] = {}
    for code, table in list(state.TABLES.items()):
        if table.data["seats"] and not table.expired() and not table.data.get("closed") and visible(table):
            found[code] = summary(table)
    for data in store.recent_rows():
        if data["code"] not in found and data["code"] not in state.TABLES and data.get("seats"):
            table = state.Table(data)
            if visible(table):
                found[data["code"]] = summary(table)
    tables = sorted(
        found.values(),
        key=lambda t: (-sum(p["online"] for p in t["players"]), -t["idle_left"]),
    )
    return Response({"tables": tables[:30], "idle_close": state.IDLE_CLOSE})


# ---- rever uma partida (tables/models.py: GameReplay) ---------------------------------------


def _replay_data(row) -> dict:
    import json
    import zlib

    return json.loads(zlib.decompress(bytes(row.data)))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_replays(request):
    """As últimas partidas da conta que dá para rever (resumo: quem jogou, resultado, turnos)."""
    from .models import GameReplay

    rows = GameReplay.objects.filter(players__user=request.user).order_by("-finished_at")[:30]
    out = []
    for row in rows:
        data = _replay_data(row)
        out.append({
            "id": row.pk,
            "finished_at": row.finished_at.isoformat(),
            "turns": row.turns,
            "minutes": round((data["ended"] - data["started"]) / 60),
            "winner": data.get("winner"),
            "players": [{"name": p["name"], "deck": p["deck"].get("name")} for p in data["players"]],
        })
    return Response({"replays": out})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def replay_detail(request, pk: int):
    """A partida inteira, turno a turno. Só para quem jogou (e para o admin)."""
    from django.shortcuts import get_object_or_404

    from .models import GameReplay

    row = get_object_or_404(GameReplay, pk=pk)
    if not request.user.is_staff and not row.players.filter(user=request.user).exists():
        return Response({"detail": "not_found"}, status=404)
    data = _replay_data(row)
    # O lugar de quem está vendo: o campo dele fica embaixo, como na mesa
    you = next((p["seat"] for p in data["players"] if p.get("user") == request.user.pk), None)
    for p in data["players"]:
        p.pop("user", None)
    for turn in data["turns"]:
        for board in turn["boards"]:
            board.pop("user", None)
    return Response({"id": row.pk, "finished_at": row.finished_at.isoformat(), "you": you, **data})
