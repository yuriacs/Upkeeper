"""
Painel do admin (só contas com is_staff): mesas abertas agora e partidas encerradas.

- Mesas abertas: todas (inclusive só amigos e treino), com quem está sentado, o deck e a vida.
  O admin assiste a qualquer uma (tables/consumers.py) e pode encerrar a partida com um vencedor
  (conta como uma partida confirmada pelos jogadores) ou fechar a mesa sem vencedor.
- Partidas encerradas: as das mesas (ranking das mesas) e as dos sorteios com vencedor marcado.
  O admin troca o vencedor ou anula o resultado; o ranking é refeito na hora.

As mesas vivem na memória do processo, no loop de eventos do uvicorn; as views rodam em threads
(a2wsgi). Por isso as ações numa mesa vão para o loop (run_on_loop), onde mexer nela é seguro.
"""

import asyncio
import time

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from decks.models import Draw
from decks.services import stats

from . import state, store
from .models import TableResult

User = get_user_model()

# Loop de eventos do uvicorn (onde ficam as mesas): guardado pela primeira requisição (config/asgi.py)
LOOP: asyncio.AbstractEventLoop | None = None


def remember_loop() -> None:
    global LOOP
    if LOOP is None:
        LOOP = asyncio.get_running_loop()


def run_on_loop(coro, timeout: float = 60):
    """Roda a corrotina no loop das mesas e espera o resultado (sem loop guardado: testes)."""
    loop = LOOP
    if loop is not None and loop.is_running():
        return asyncio.run_coroutine_threadsafe(coro, loop).result(timeout)
    return asyncio.run(coro)


def _admin_name(user) -> str:
    return f"Admin ({user.username})"


# ---- mesas abertas ------------------------------------------------------------------------------


def _live_row(table: state.Table, in_memory: bool) -> dict:
    d = table.data
    seats = sorted(d["seats"].values(), key=lambda s: s["seat"])
    tour = d.get("tournament")
    return {
        "code": table.code,
        "title": d.get("title") or "",
        "players": [
            {
                "id": s["user_id"],
                "name": s["name"],
                "seat": s["seat"],
                "deck": (s.get("deck") or {}).get("name"),
                "life": s.get("life"),
                "online": table.online_count(s["user_id"]) > 0,
            }
            for s in seats
        ],
        "max_seats": table.max_seats,
        "spectators": len(table.spectators),
        "turn": d["turn"]["number"],
        "started": table.started,
        "finished": d.get("result") is not None,
        "changed_at": d.get("changed_at"),
        "idle_left": table.idle_left(),
        "practice": table.practice,
        "friends_only": bool(d.get("friends_only")),
        "allow_watch": d.get("allow_watch", True) is not False,
        "tournament": tour["kind"] if tour else None,
        "from_draw": bool(d.get("dealt")),
        "in_memory": in_memory,
        "end_request": table.end_request_view() if in_memory else None,
    }


@api_view(["GET"])
@permission_classes([IsAdminUser])
def live_tables(request):
    """Todas as mesas abertas: as da memória (estado mais novo) e as salvas que não estão nela."""
    found: dict[str, dict] = {}
    for code, table in list(state.TABLES.items()):
        if not table.expired() and not table.data.get("closed"):
            found[code] = _live_row(table, True)
    for data in store.recent_rows(limit=200, skip=list(state.TABLES)):
        if data["code"] not in found and data["code"] not in state.TABLES:
            found[data["code"]] = _live_row(state.Table(data), False)
    tables = sorted(
        found.values(),
        key=lambda t: (-sum(p["online"] for p in t["players"]), -(t["changed_at"] or 0)),
    )
    return Response({"tables": tables, "idle_close": state.IDLE_CLOSE, "now": time.time()})


async def _end_table(code: str, action: str, winner: int | None, admin: str) -> dict:
    """No loop das mesas: encerra a partida (com ou sem vencedor) ou só fecha a mesa."""
    from . import closer

    table = state.TABLES.get(code)
    if table is None:
        # Salva no banco (servidor reiniciou e ninguém voltou ainda): volta para a memória
        data = await store.load_table(code)
        if data is None:
            return {"error": "not_found", "status": 404}
        table = state.TABLES.setdefault(code, state.Table(data))
    if table.expired():
        return {"error": "not_found", "status": 404}
    if table.finishing:
        return {"error": "finishing", "status": 409}
    if action == "close" or table.practice or not table.data["seats"]:
        await closer.close_table(code, "closed", admin)
        return {"closed": True}
    if winner is not None:
        if table.seat_of(winner) is None:
            return {"error": "bad_winner", "status": 400}
        tour = table.data.get("tournament")
        if tour and tour["kind"] == "league":
            # Liga precisa da ordem de chegada de todos: o resultado é lançado na página do torneio
            return {"error": "league_table", "status": 400}
    table.data["end_request"] = None
    table.data["close_request"] = None
    name = await closer.finish_game(code, table, None, winner, admin=admin)
    await closer.close_table(code, "finished", name or None)
    return {"closed": True, "winner": name or None}


@api_view(["POST"])
@permission_classes([IsAdminUser])
def end_table(request, code):
    """
    POST {"action": "finish", "winner": <id da conta> | null} encerra a partida (com vencedor ela
    conta no ranking, como se os jogadores tivessem confirmado) e fecha a mesa;
    POST {"action": "close"} só fecha a mesa (dá para restaurar a partida pelo Histórico).
    """
    code = str(code).upper()
    if not state.valid_code(code):
        return Response({"detail": "not_found"}, status=404)
    action = request.data.get("action")
    if action not in ("finish", "close"):
        return Response({"detail": "bad_action"}, status=400)
    winner = request.data.get("winner")
    if winner is not None and (not isinstance(winner, int) or isinstance(winner, bool)):
        return Response({"detail": "bad_winner"}, status=400)
    out = run_on_loop(_end_table(code, action, winner, _admin_name(request.user)))
    if "error" in out:
        return Response({"detail": out["error"]}, status=out["status"])
    return Response(out)


# ---- partidas encerradas ------------------------------------------------------------------------


class GamesPagination(PageNumberPagination):
    page_size = 30


def _deck_name(entry) -> str | None:
    if entry.deck_id:
        return entry.deck.name
    if entry.user_deck_id:
        return entry.user_deck.name
    return None


def _table_game(game: TableResult) -> dict:
    entries = sorted(game.entries.all(), key=lambda e: e.pk)
    return {
        "source": "tables",
        "id": game.pk,
        "code": None,
        "finished_at": game.finished_at,
        "turns": game.turns,
        "players": [
            {
                "entry": e.pk,
                "name": e.player.username if e.player_id else None,
                "deck": _deck_name(e),
                "won": e.won,
            }
            for e in entries
        ],
    }


def _draw_game(draw: Draw) -> dict:
    entries = sorted(draw.entries.all(), key=lambda e: e.position)
    return {
        "source": "draws",
        "id": draw.pk,
        "code": draw.code,
        "finished_at": draw.result_at or draw.created_at,
        "turns": None,
        "players": [
            {
                "entry": e.position,
                "name": e.player.username if e.player_id else e.player_name,
                "deck": _deck_name(e),
                "won": e.position == draw.winner_position,
            }
            for e in entries
        ],
    }


@api_view(["GET"])
@permission_classes([IsAdminUser])
def finished_games(request):
    """
    Partidas encerradas, as mais novas primeiro. ?source=tables (mesas, padrão) ou draws (sorteios
    com vencedor); ?search=<nome> filtra pelas que a conta jogou.
    """
    source = request.query_params.get("source", "tables")
    search = request.query_params.get("search", "").strip()
    if source == "draws":
        qs = Draw.objects.filter(winner_position__isnull=False)
        if search:
            qs = qs.filter(
                Q(entries__player__username__icontains=search) | Q(entries__player_name__icontains=search)
            ).distinct()
        qs = qs.order_by("-result_at", "-pk").prefetch_related("entries__player", "entries__deck", "entries__user_deck")
        build = _draw_game
    else:
        qs = TableResult.objects.all()
        if search:
            qs = qs.filter(entries__player__username__icontains=search).distinct()
        qs = qs.order_by("-finished_at", "-pk").prefetch_related(
            "entries__player", "entries__deck", "entries__user_deck"
        )
        build = _table_game
    paginator = GamesPagination()
    page = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response([build(g) for g in page])


@api_view(["POST", "DELETE"])
@permission_classes([IsAdminUser])
def edit_game(request, source, pk):
    """
    POST {"winner": <entry>} troca o vencedor (tables: id do jogador da partida; draws: posição).
    DELETE anula: a partida da mesa sai do ranking; no sorteio, o vencedor é desmarcado.
    """
    if source == "tables":
        game = TableResult.objects.filter(pk=pk).first()
        if game is None:
            return Response({"detail": "not_found"}, status=404)
        before = stats.refs_of("tables", [game.pk])
        if request.method == "DELETE":
            game.delete()
            stats.touch("tables", before)
            return Response(status=204)
        winner = request.data.get("winner")
        if not isinstance(winner, int) or isinstance(winner, bool) or not game.entries.filter(pk=winner).exists():
            return Response({"detail": "bad_winner"}, status=400)
        with transaction.atomic():
            game.entries.update(won=False)
            game.entries.filter(pk=winner).update(won=True)
        stats.touch("tables", before)
        game = TableResult.objects.prefetch_related("entries__player", "entries__deck", "entries__user_deck").get(pk=pk)
        return Response(_table_game(game))
    if source == "draws":
        draw = Draw.objects.filter(pk=pk).first()
        if draw is None:
            return Response({"detail": "not_found"}, status=404)
        if request.method == "DELETE":
            draw.winner_position, draw.result_at = None, None
        else:
            winner = request.data.get("winner")
            if not isinstance(winner, int) or isinstance(winner, bool) or not draw.entries.filter(position=winner).exists():
                return Response({"detail": "bad_winner"}, status=400)
            draw.winner_position = winner
            draw.result_at = draw.result_at or timezone.now()
        draw.save(update_fields=["winner_position", "result_at"])
        stats.touch("draws", stats.refs_of("draws", [draw.pk]))
        if request.method == "DELETE":
            return Response(status=204)
        draw = Draw.objects.prefetch_related("entries__player", "entries__deck", "entries__user_deck").get(pk=pk)
        return Response(_draw_game(draw))
    return Response({"detail": "not_found"}, status=404)
