from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

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
    cheias, dá para assistir. Mesas sem ninguém sentado não aparecem. As com gente conectada vêm
    primeiro.
    """
    uid = request.user.id if request.user.is_authenticated else None
    found: dict[str, dict] = {}
    for code, table in list(state.TABLES.items()):
        if table.data["seats"] and not table.expired() and not table.data.get("closed"):
            found[code] = table.summary(uid)
    for data in store.recent_rows():
        if data["code"] not in found and data["code"] not in state.TABLES and data.get("seats"):
            found[data["code"]] = state.Table(data).summary(uid)
    tables = sorted(
        found.values(),
        key=lambda t: (-sum(p["online"] for p in t["players"]), -t["idle_left"]),
    )
    return Response({"tables": tables[:30], "idle_close": state.IDLE_CLOSE})
