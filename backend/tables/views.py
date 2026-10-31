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
    for data in store.active_rows_for(uid, skip=list(state.TABLES)):
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
        if table.practice:
            return table.seat_of(uid) is not None if uid else False  # treino: só para quem treina
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
    for data in store.recent_rows(skip=list(state.TABLES)):
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
    from .models import GameReplay, replay_summary

    rows = (GameReplay.objects.filter(players__user=request.user).defer("data", "resume")
            .order_by("-finished_at")[:30])
    out = []
    for row in rows:
        summary = row.summary
        if summary is None:  # gravada antes do resumo existir
            summary = replay_summary(_replay_data(row))
            GameReplay.objects.filter(pk=row.pk).update(summary=summary)
        out.append({
            "id": row.pk,
            "finished_at": row.finished_at.isoformat(),
            "turns": row.turns,
            **summary,
            "table": _restored_table(row),
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
    data.pop("code", None)
    return Response({
        "id": row.pk, "finished_at": row.finished_at.isoformat(), "you": you, **data,
        "restorable": data.get("winner") is None and bool(data["turns"]),
        "table": _restored_table(row),
    })


# ---- restaurar a partida (mesa fechada sem vencedor, por tempo ou por um jogador) -------------

_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _restored_table(row) -> str | None:
    """Mesa restaurada desta partida, se continua aberta (os outros jogadores voltam por ela)."""
    from .models import TableGame

    code = row.restored_code
    if not code:
        return None
    table = state.TABLES.get(code)
    if table is not None:
        return code if not table.expired() and table.data.get("restored_from") == row.pk else None
    saved = TableGame.objects.filter(code=code).first()
    data = store._alive(saved) if saved is not None else None
    return code if data and data.get("restored_from") == row.pk else None


def _code_free(code) -> bool:
    """Ninguém usa o código: nem mesa na memória (mesmo vencida, que a varredura ainda vai fechar) nem salva aberta."""
    from .models import TableGame

    if not isinstance(code, str) or not state.valid_code(code) or code in state.TABLES:
        return False
    saved = TableGame.objects.filter(code=code).first()
    if saved is not None and store._alive(saved) is not None:
        return False
    TableGame.objects.filter(code=code).delete()  # mesa vencida que ficou no banco
    return True


def _new_code() -> str:
    import secrets

    while True:
        code = "".join(secrets.choice(_CODE_CHARS) for _ in range(6))
        if _code_free(code):
            return code


def _rebuild(code: str, data: dict, replay_id: int, host_id: int) -> dict:
    """Partida salva sem a cópia da mesa: remonta pela última foto e pelas listas dos decks."""
    decks, known = {}, set()
    for p in data["players"]:
        found = store.deck_cards_sync(p["deck"].get("kind"), p["deck"].get("ref"))
        decks[p["user"]] = found[1] if found else []
        known.update(r["name"] for r in decks[p["user"]])
    extra = store.card_rows({c.get("name") for c in (data.get("cards") or {}).values()} - known)
    setup = state.table_setup({"players": 2 if len(data["players"]) == 2 else 4}, host_id)
    return state.rebuild_from_replay(code, data, replay_id, host_id, decks, extra, setup, [])


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def restore_replay(request, pk: int):
    """
    Abre de novo a mesa de uma partida que fechou sem vencedor (por inatividade ou por um jogador):
    cada um volta ao próprio lugar, com a mão, o grimório, o cemitério e o campo como estavam. Só
    quem jogou restaura; os outros recebem convite e veem a mesa em "Suas mesas". Restaurada e ainda
    aberta: devolve a mesma mesa. Usa o código antigo quando está livre (sorteio e torneio de origem
    continuam valendo). Resposta: {"code"}.
    """
    import json
    import zlib

    from django.db import transaction

    from accounts import presence

    from .models import GameReplay, TableGame, TableSeat

    uid = request.user.id
    with transaction.atomic():
        row = GameReplay.objects.select_for_update().filter(pk=pk, players__user=request.user).first()
        if row is None:
            return Response({"detail": "not_found", "code": "not_found"}, status=404)
        if live := _restored_table(row):
            return Response({"code": live})
        data = _replay_data(row)
        if data.get("winner") is not None or not data.get("turns"):
            return Response({"detail": "has_winner", "code": "has_winner"}, status=400)
        try:
            state.check_new_table(uid)
        except state.ServerFull:
            return Response({"detail": "server_full", "code": "server_full"}, status=503)
        except state.TooManyTables:
            return Response({"detail": "too_many_tables", "code": "too_many_tables"}, status=429)
        code = data.get("code") if _code_free(data.get("code")) else _new_code()
        if row.resume:
            snap = json.loads(zlib.decompress(bytes(row.resume)))
            table = state.restore_snapshot(code, snap, data, row.pk, uid)
        else:
            try:
                table = _rebuild(code, data, row.pk, uid)
            except state.ActionError as err:
                return Response({"detail": err.code, "code": err.code}, status=400)
        # Mesa vencida com o mesmo código: sai com os turnos e lugares dela
        TableGame.objects.filter(code=code).delete()
        TableGame.objects.create(code=code, data=table)
        # Os lugares já valem: os convidados veem a mesa em "Suas mesas" antes de alguém entrar
        TableSeat.objects.bulk_create(TableSeat(table_id=code, user_id=int(uid)) for uid in table["seats"] if int(uid) > 0)
        row.restored_code = code
        row.save(update_fields=["restored_code"])
    for p in data["players"]:
        if p["user"] != uid:
            presence.invite(request.user, p["user"], code)
    return Response({"code": code})
