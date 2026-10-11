"""
WebSocket da mesa virtual. Protocolo (JSON):

cliente → servidor
  {"type": "auth", "token": "<token da conta>"}           primeira mensagem, obrigatória
  {"type": "load_deck", "kind": "precon"|"user", "ref": "<slug ou id>"}
  {"type": "draw", "n": 1}
  {"type": "move", "card": "c12", "to": "battlefield", "x": 0.4, "y": 0.6, "position": "top"|"bottom"}
  {"type": "tap", "card": "c12"}       {"type": "untap_all"}     {"type": "shuffle"}
  {"type": "mulligan"}                  {"type": "restart"}       {"type": "life", "delta": -1}
servidor → cliente
  {"type": "state", "code", "max_seats", "players": [...], "log": [...], "you": <id>}
  {"type": "error", "code": "..."}

Cada jogador recebe a própria visão: a mão, o grimório e a pilha virada dos outros chegam só
como quantidade. O token vai numa mensagem, e não na URL, para não aparecer nos logs de acesso.
Códigos de fechamento: 4401 sem login válido, 4403 mesa cheia, 4404 código inválido.
"""

import asyncio

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from rest_framework.authtoken.models import Token

from . import state, store

AUTH_TIMEOUT = 10  # segundos para mandar o token depois de conectar
MAX_DELTA = 100
_loading: dict[str, asyncio.Lock] = {}


@database_sync_to_async
def user_for_token(key: str):
    try:
        token = Token.objects.select_related("user").get(key=key)
    except Token.DoesNotExist:
        return None
    return token.user if token.user.is_active else None


async def get_table(code: str) -> state.Table:
    """Mesa da memória; se não estiver (servidor reiniciou), recupera do banco ou cria."""
    if code in state.TABLES:
        return state.TABLES[code]
    lock = _loading.setdefault(code, asyncio.Lock())
    async with lock:
        if code not in state.TABLES:
            state.prune()
            data = await store.load_table(code)
            state.TABLES[code] = state.Table(data or state.new_table(code))
    return state.TABLES[code]


def _int(value, default=None):
    return value if isinstance(value, int) and not isinstance(value, bool) else default


class TableConsumer(AsyncJsonWebsocketConsumer):
    user = None
    joined = False

    async def connect(self):
        self.code = self.scope["url_route"]["kwargs"]["code"].upper()
        self.group = f"table-{self.code}"
        await self.accept()
        if not state.valid_code(self.code):
            await self.close(code=4404)
            return
        self.auth_timer = asyncio.get_running_loop().call_later(AUTH_TIMEOUT, self._auth_expired)

    def _auth_expired(self):
        if self.user is None:
            asyncio.ensure_future(self.close(code=4401))

    async def disconnect(self, code):
        if timer := getattr(self, "auth_timer", None):
            timer.cancel()
        if self.joined:
            self.table.leave(self.user.id)
            await self.channel_layer.group_discard(self.group, self.channel_name)
            await self.broadcast()

    async def receive_json(self, content, **kwargs):
        kind = content.get("type") if isinstance(content, dict) else None
        if self.user is None:
            if kind == "auth" and isinstance(content.get("token"), str):
                await self.authenticate(content["token"])
            else:
                await self.close(code=4401)
            return
        try:
            await self.handle(kind, content)
        except state.ActionError as err:
            await self.send_json({"type": "error", "code": err.code})
            return
        await store.save_table(self.code, self.table.data)
        await self.broadcast()

    async def handle(self, kind: str, msg: dict) -> None:
        t, uid = self.table, self.user.id
        if kind == "load_deck":
            found = await store.deck_cards(msg.get("kind"), str(msg.get("ref", "")))
            if found is None:
                raise state.ActionError("deck_not_found")
            t.load_deck(uid, *found)
        elif kind == "draw":
            t.draw(uid, _int(msg.get("n"), 1))
        elif kind == "move":
            to = msg.get("to")
            position = "bottom" if msg.get("position") == "bottom" else "top"
            t.move(uid, str(msg.get("card")), to, msg.get("x"), msg.get("y"), position)
        elif kind == "tap":
            t.tap(uid, str(msg.get("card")))
        elif kind == "untap_all":
            t.untap_all(uid)
        elif kind == "shuffle":
            t.shuffle(uid)
        elif kind == "mulligan":
            t.mulligan(uid)
        elif kind == "restart":
            t.restart(uid)
        elif kind == "life":
            delta = _int(msg.get("delta"), 0)
            if not 0 < abs(delta) <= MAX_DELTA:
                raise state.ActionError("bad_delta")
            t.change_life(uid, delta)
        else:
            raise state.ActionError("unknown_action")

    async def authenticate(self, key: str):
        user = await user_for_token(key)
        if user is None:
            await self.close(code=4401)
            return
        table = await get_table(self.code)
        try:
            table.join(user.id, user.username)
        except state.TableFull:
            await self.close(code=4403)
            return
        self.user, self.table, self.joined = user, table, True
        self.auth_timer.cancel()
        await store.save_table(self.code, table.data)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.broadcast()

    async def broadcast(self):
        await self.channel_layer.group_send(self.group, {"type": "table.state"})

    async def table_state(self, event):
        # Cada conexão monta a visão do seu jogador (mão dos outros escondida)
        await self.send_json({"type": "state", **self.table.view(self.user.id), "you": self.user.id})
