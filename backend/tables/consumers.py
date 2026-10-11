"""
WebSocket da mesa virtual. Protocolo (JSON):

cliente → servidor
  {"type": "auth", "token": "<token da conta>"}   primeira mensagem, obrigatória
  {"type": "life", "delta": -1}                    muda a própria vida
servidor → cliente
  {"type": "state", "code", "max_seats", "players": [...], "you": <id>}
  {"type": "error", "code": "..."}

O token vai numa mensagem, e não na URL, para não aparecer nos logs de acesso.
Códigos de fechamento: 4401 sem login válido, 4403 mesa cheia, 4404 código inválido.
"""

import asyncio

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from rest_framework.authtoken.models import Token

from . import state

AUTH_TIMEOUT = 10  # segundos para mandar o token depois de conectar
MAX_DELTA = 100


@database_sync_to_async
def user_for_token(key: str):
    try:
        token = Token.objects.select_related("user").get(key=key)
    except Token.DoesNotExist:
        return None
    return token.user if token.user.is_active else None


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
            state.leave(self.code, self.user.id)
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
        if kind == "life":
            delta = content.get("delta")
            if isinstance(delta, int) and not isinstance(delta, bool) and 0 < abs(delta) <= MAX_DELTA:
                state.change_life(self.code, self.user.id, delta)
                await self.broadcast()
            else:
                await self.send_json({"type": "error", "code": "bad_delta"})

    async def authenticate(self, key: str):
        user = await user_for_token(key)
        if user is None:
            await self.close(code=4401)
            return
        try:
            state.join(self.code, user.id, user.username)
        except state.TableFull:
            await self.close(code=4403)
            return
        self.user, self.joined = user, True
        self.auth_timer.cancel()
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.broadcast()

    async def broadcast(self):
        table = state.TABLES.get(self.code)
        if table:
            await self.channel_layer.group_send(self.group, {"type": "table.state", "state": table.snapshot()})

    async def table_state(self, event):
        await self.send_json({"type": "state", **event["state"], "you": self.user.id})
