"""
WebSocket da mesa virtual. Protocolo (JSON):

cliente → servidor
  {"type": "auth", "token": "<token da conta>", "delta": true}   primeira mensagem, obrigatória
      (com "delta", depois da primeira mesa inteira chegam só as mudanças: tables/delta.py)
      "setup": {"title", "style", "players": 2|4, "friends_only", "allow_watch", "max_bracket": 2|3|4,
      "max_tutors": 0|1|3, "max_price": 150|300} (sem a chave = livre) só vale para quem
      abre a mesa (ela ainda não existe); depois as opções não mudam
  {"type": "resync"}   pede a mesa inteira de novo
  {"type": "load_deck", "kind": "precon"|"user", "ref": "<slug ou id>"}
  {"type": "draw", "n": 1}
  {"type": "move", "card": "c12", "to": "battlefield", "x": 0.4, "y": 0.6, "position": "top"|"bottom"}
  {"type": "tap", "card": "c12"}       {"type": "untap_all"}     {"type": "shuffle"}
  {"type": "arrange"}  (organiza o seu campo em fileiras)
  {"type": "mulligan"}                  {"type": "restart"}       {"type": "life", "delta": -1}
  {"type": "stat", "card", "which": "p"|"t", "delta": 1}   {"type": "toggle_stats", "card"}
  {"type": "counter", "card", "kind": "+1/+1", "delta": 1}   {"type": "tax", "card", "delta": 1}
  {"type": "cmd_damage", "from": <user_id>, "delta": 1}      {"type": "poison", "delta": 1}
  {"type": "mana", "color": "W"|"U"|"B"|"R"|"G"|"C"|"A", "delta": -1}   {"type": "mana", "clear": true}
      mana em aberto, por cor (sobe e desce sozinha ao virar/desvirar fontes de mana; "A" = qualquer cor)
  {"type": "peek", "n": 3 | null}  (null = buscar no grimório; resposta só para quem pediu)
  {"type": "reveal", "card"}   {"type": "token", "name", "image", "x", "y"}   {"type": "clone", "card"}
  {"type": "roll", "sides": 2|4|6|8|10|12|20}   {"type": "chat", "text"}   {"type": "pass_turn"}
  {"type": "signal", "what": "alert"|"ok"}
  Quem está assistindo só manda {"type": "chat", "text"} (vai para o log como "spectator_chat")  (aviso rápido: "tenho uma resposta" ou "sem resposta")
  {"type": "end_game", "winner": <user_id> | null}  (pede o fim; outro jogador confirma)
  {"type": "end_vote", "approve": true|false}  (confirmar/recusar; quem pediu, com false, desiste)
  {"type": "new_game"}
  {"type": "shake", "card"}  (qualquer carta do campo, sua ou de outro jogador: treme para todos)
  Várias cartas: {"type": "tap_many", "cards": [...], "tapped": true}   {"type": "move_many", "cards", "to", "position"}
  {"type": "place_many", "places": [{"card", "x", "y"}, ...]}
  Grimório: {"type": "draw_to", "n", "to": "graveyard"|"exile"|"facedown"|"hand"|"battlefield"|"battlefield_down",
  "from": "top"|"bottom"}   {"type": "reveal_top", "n"}   {"type": "top_revealed"}   {"type": "reveal_last_draw"}
  {"type": "scoop"}   {"type": "reorder_top", "order": ["<carta>", ...]}  (nova ordem do topo, vidência)
  Cartas do campo (de qualquer jogador): {"type": "invert"|"highlight"|"lock"|"face_down"|"flip", "card"}
  {"type": "note", "card", "text"}   {"type": "symbol", "card", "symbol": "attack"|...|null}
  {"type": "control", "card", "to": <user_id>}   {"type": "attach", "card", "to": "<carta>"|null}
  {"type": "target", "card", "to_card": "<carta>"} ou {"type": "target", "card", "to_player": <user_id>}
  {"type": "undo"}  (desfaz a sua última ação; com outros conectados, abre um pedido que todos aprovam)
  {"type": "rewind", "to": <id do registro no log>}  (volta a mesa para aquele momento; todos aprovam)
  {"type": "undo_vote", "approve": true|false}  (quem pediu, com false, cancela o pedido)
  {"type": "keep_alive"}  (conta como alteração: adia o fechamento por inatividade)
  {"type": "request_control", "card"}   {"type": "answer_control", "card", "accept": true}
  {"type": "show_hand", "to": 7 | null | "spectators", "show": true}
      (mostra a mão a um jogador, a todos os jogadores ou a quem está assistindo)
  {"type": "set_afk", "player": 7, "afk": true}  (ausente: o turno pula; volta ao fazer qualquer coisa)
  {"type": "close_table"} (pede para fechar a mesa: outro jogador confirma; sozinho, fecha na hora)
  {"type": "close_vote", "approve": true|false}  (quem pediu, com false, desiste)
  {"type": "card_action", "card", "index": 0, "pick": [...], "n": 3, "image": "<url>"}
      (atalho da carta, tables/card_actions.py; busca sem "pick" responde {"type": "action_pick", ...})
  {"type": "abandon"} (sai de vez: o lugar fica livre; a resposta é {"type": "abandoned"} e a conexão fecha)
  Qualquer ação pode levar "cid" (número crescente do cliente); o estado volta com "ack".
servidor → cliente
  {"type": "state", "code", "max_seats", "players": [...], "log": [...], "you": <id>}
  {"type": "peek", "mode": "top"|"search", "cards": [...]}
  {"type": "action_pick", "card", "index", "cards": [...]}  (cartas do grimório que servem para a busca)
  {"type": "error", "code": "..."}
  {"type": "closed", "reason": "idle"|"closed"|"finished", "by": "<nome>"|null}   e em seguida fecha com 4410
      ("finished": partida confirmada; "by" = vencedor, null sem vencedor)
  {"type": "abandoned"}   você saiu da mesa de vez; em seguida fecha com 4000

Cada jogador recebe a própria visão: a mão, o grimório e a pilha virada dos outros chegam só
como quantidade. O token vai numa mensagem, e não na URL, para não aparecer nos logs de acesso.
Códigos de fechamento: 4401 sem login válido, 4403 mesa cheia, 4404 código inválido,
4407 a mesa não aceita espectadores, 4408 mesa só para amigos de quem abriu, 4409 a partida já
começou (passou o primeiro turno: só dá para assistir),
4410 mesa encerrada (10 minutos sem alteração ou fechada por um jogador; ver tables/closer.py),
4413 mensagem grande demais, 4429 ações demais / abas demais na mesma mesa / espectadores demais,
4430 a conta já tem o máximo de mesas abertas, 4503 servidor cheio (mesas demais abertas).
"""

import asyncio
import json
import logging

from channels.consumer import get_handler_name
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from rest_framework.authtoken.models import Token

from accounts.friends import friend_ids

from . import closer, delta, state, store, watchdog

log = logging.getLogger(__name__)

AUTH_TIMEOUT = 10  # segundos para mandar o token depois de conectar
# Contra abuso: tamanho máximo de uma mensagem e ritmo de ações por conexão (balde de fichas:
# RATE por segundo, acumulando até BURST). Gente jogando faz poucas por segundo; arrastar um grupo
# de cartas manda uma só (place_many). Quem passa muito do limite é desconectado.
MAX_MESSAGE = 64 * 1024
RATE, BURST = 15.0, 45.0
# Ação em várias cartas de uma vez ("each"): as que valem para cada carta e o máximo de cartas
EACH_KINDS = {
    "counter", "stat", "toggle_stats", "clone", "shake", "invert", "highlight", "lock", "face_down", "flip", "note", "symbol",
    "control",
}  # fmt: skip
EACH_MAX = 60
KICK_AFTER = 150  # ações recusadas por excesso em 10 s numa conexão: desconecta
MAX_DELTA = 100
_loading: dict[str, asyncio.Lock] = {}


@database_sync_to_async
def user_for_token(key: str):
    try:
        token = Token.objects.select_related("user").get(key=key)
    except Token.DoesNotExist:
        return None
    return token.user if token.user.is_active else None


async def get_table(code: str, user_id: int | None = None, setup=None) -> state.Table:
    """
    Mesa da memória; se não estiver (servidor reiniciou), recupera do banco ou cria. Mesa nova
    respeita os limites (state.check_new_table): levanta ServerFull / TooManyTables.
    """
    if code in state.TABLES:
        if not state.TABLES[code].expired():
            return state.TABLES[code]
        await closer.close_table(code, "idle")  # expirou e a varredura ainda não passou
    lock = _loading.setdefault(code, asyncio.Lock())
    try:
        async with lock:
            if code not in state.TABLES:
                data = await store.load_table(code)
                if data is None:
                    if user_id is not None:
                        state.check_new_table(user_id)
                    # Mesa nova com o código de um sorteio: os decks sorteados ficam à espera dos jogadores
                    data = state.new_table(code, await store.dealt_for_code(code), state.table_setup(setup, user_id))
                    data["created_by"] = user_id
                state.TABLES[code] = state.Table(data)
    finally:
        if not lock.locked():
            _loading.pop(code, None)
    return state.TABLES[code]


def _int(value, default=None):
    return value if isinstance(value, int) and not isinstance(value, bool) else default


class TableConsumer(AsyncJsonWebsocketConsumer):
    user = None
    joined = False
    # Assistindo (mesa cheia): vê a mesa, sem mãos, e não manda ações
    spectator = False
    # Última ação do cliente já aplicada ("cid"): o cliente desfaz a previsão local das que voltarem
    last_cid = 0
    # Fim de partida confirmado nesta ação: nome do vencedor ("" sem vencedor); a mesa fecha depois de avisar
    finished: str | None = None
    # Fechamento confirmado (ou sem ninguém para confirmar): quem pediu, para o aviso de "mesa fechada"
    closing: str | None = None
    # Atualizações menores: a última visão enviada (para mandar só o que mudou) e o número da mensagem
    wants_delta = False
    sent: dict | None = None
    rev = 0
    # Ritmo de ações (balde de fichas) e quantas foram recusadas por excesso
    tokens = BURST
    refilled = 0.0
    throttled = 0
    throttle_since = 0.0
    warned = 0.0

    async def dispatch(self, message):
        """
        Igual ao do Channels, sem o `aclose_old_connections()` antes de cada mensagem. Ele passa pela
        thread única do banco, e com o Neon longe cada ação e cada atualização da mesa esperavam na
        fila atrás das gravações (teste de carga: p95 de ~700 ms com 10 mesas, CPU quase parada).
        A mesa não usa o banco nessas mensagens; as consultas vão por `database_sync_to_async`, que
        já cuida da conexão.
        """
        handler = getattr(self, get_handler_name(message), None)
        if handler is None:
            raise ValueError(f"No handler for message type {message['type']}")
        await handler(message)

    @classmethod
    async def encode_json(cls, content):
        return json.dumps(content, separators=(",", ":"))

    async def connect(self):
        self.code = self.scope["url_route"]["kwargs"]["code"].upper()
        self.group = f"table-{self.code}"
        await self.accept()
        if not state.valid_code(self.code):
            await self.bye(4404)
            return
        self.auth_timer = asyncio.get_running_loop().call_later(AUTH_TIMEOUT, self._auth_expired)
        watchdog.ensure_watchdog()

    def _auth_expired(self):
        if self.user is None:
            asyncio.ensure_future(self.bye(4401))

    async def disconnect(self, code):
        if timer := getattr(self, "auth_timer", None):
            timer.cancel()
        if self.spectator:
            self.table.unwatch(self.user.id)
            await self.channel_layer.group_discard(self.group, self.channel_name)
            await self.broadcast()
            return
        if self.joined:
            self.table.leave(self.user.id)
            await self.channel_layer.group_discard(self.group, self.channel_name)
            await self.broadcast()
            if not self.table.is_online() and not self.table.data.get("closed"):
                await store.flush(self.code, self.table)

    async def receive(self, text_data=None, bytes_data=None, **kwargs):
        # Mensagem grande demais (nenhuma ação legítima passa de poucos KB): desconecta
        if bytes_data is not None or text_data is None or len(text_data) > MAX_MESSAGE:
            await self.bye(4413)
            return
        await super().receive(text_data=text_data, **kwargs)

    def _allow(self) -> bool:
        """Balde de fichas: True se a ação cabe no ritmo permitido."""
        now = asyncio.get_running_loop().time()
        self.tokens = min(BURST, self.tokens + (now - self.refilled) * RATE)
        self.refilled = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False

    async def receive_json(self, content, **kwargs):
        kind = content.get("type") if isinstance(content, dict) else None
        if self.user is None:
            if kind == "auth" and isinstance(content.get("token"), str):
                self.wants_delta = content.get("delta") is True
                await self.authenticate(
                    content["token"], spectate=content.get("spectate") is True, setup=content.get("setup")
                )
            else:
                await self.bye(4401)
            return
        if self.table.data.get("closed"):
            return  # a mesa acabou de fechar; a conexão está saindo
        if not self._allow():
            now = asyncio.get_running_loop().time()
            if now - self.throttle_since > 10:
                self.throttle_since, self.throttled = now, 0
            self.throttled += 1
            if self.throttled >= KICK_AFTER:
                log.warning("mesa %s: %s desconectado (ações demais)", self.code, self.user.username)
                await self.bye(4429)
                return
            cid = content.get("cid") if isinstance(content, dict) else None
            if isinstance(cid, int) and not isinstance(cid, bool):
                self.last_cid = max(self.last_cid, cid)
            if now - self.warned >= 1:  # um aviso por segundo, não um por ação recusada
                self.warned = now
                await self.send_json({"type": "error", "code": "too_fast", "ack": self.last_cid})
            return
        if kind == "resync":
            self.sent = None  # o cliente perdeu a conta: manda a mesa inteira
            await self.table_state(None)
            return
        if self.spectator:
            # Quem assiste só conversa: a mensagem aparece no chat de todos, marcada como de espectador
            if kind == "chat":
                cid = content.get("cid")
                if isinstance(cid, int) and not isinstance(cid, bool):
                    self.last_cid = max(self.last_cid, cid)
                try:
                    self.table.spectator_chat(self.user.id, self.user.username, content.get("text"))
                except state.ActionError as err:
                    await self.send_json({"type": "error", "code": err.code, "ack": self.last_cid})
                    return
                # Sem mark_changed: conversa de quem assiste não segura aberta uma mesa parada
                await self.broadcast()
                store.schedule_save(self.code, self.table)
                return
            await self.send_json({"type": "error", "code": "spectating", "ack": self.last_cid})
            return
        if kind == "abandon":
            await self.abandon()
            return
        cid = content.get("cid")
        if isinstance(cid, int) and not isinstance(cid, bool):
            self.last_cid = max(self.last_cid, cid)
        # Quem estava ausente e fez alguma coisa voltou (marcar a si mesmo não conta)
        if kind not in ("set_afk", "keep_alive", "peek") and self.table.back_from_afk(self.user.id):
            self.table.mark_changed()
        undoable = kind in state.UNDOABLE
        if undoable:
            before, seq_before = self.table.snapshot(), self.table.data["seq"]
        try:
            quiet = await self.handle(kind, content)
            if undoable:
                self.table.record_undo(self.user.id, kind, before, seq_before)
        except state.ActionError as err:
            await self.send_json({"type": "error", "code": err.code, "ack": self.last_cid})
            return
        if quiet or (kind == "peek" and content.get("quiet")):
            return  # só atualizou a janela de quem está olhando o grimório: nada mudou na mesa
        self.table.replay_frame()  # rever a partida ação a ação: a mesa depois desta ação
        self.table.mark_changed()
        await self.broadcast()
        if self.finished is not None:  # partida confirmada: todos veem o resultado e a mesa fecha
            name, self.finished = self.finished, None
            await closer.close_table(self.code, "finished", name or None)
            return
        if self.closing is not None:  # fechamento confirmado: a mesa fecha para todos
            name, self.closing = self.closing, None
            await closer.close_table(self.code, "closed", name)
            return
        store.schedule_save(self.code, self.table)

    async def handle(self, kind: str, msg: dict) -> bool:
        """Executa a ação. True: nada mudou na mesa (não precisa avisar os outros nem gravar)."""
        t, uid = self.table, self.user.id
        if kind == "load_deck":
            await self.load_deck(msg.get("kind"), str(msg.get("ref", "")))
        elif kind == "draw":
            t.draw(uid, _int(msg.get("n"), 1))
        elif kind == "move":
            to = msg.get("to")
            position = "bottom" if msg.get("position") == "bottom" else "top"
            t.move(uid, str(msg.get("card")), to, msg.get("x"), msg.get("y"), position, slot=msg.get("slot") is True)
        elif kind == "tap":
            t.tap(uid, str(msg.get("card")))
        elif kind == "untap_all":
            t.untap_all(uid)
        elif kind == "arrange":
            t.arrange(uid)
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
        elif kind == "counter":
            t.counter(uid, str(msg.get("card")), msg.get("kind"), _int(msg.get("delta"), 0))
        elif kind == "stat":
            t.stat(uid, str(msg.get("card")), msg.get("which"), _int(msg.get("delta"), 0))
        elif kind == "toggle_stats":
            t.toggle_stats(uid, str(msg.get("card")))
        elif kind == "tax":
            t.commander_tax(uid, str(msg.get("card")), _int(msg.get("delta"), 0))
        elif kind == "cmd_damage":
            t.commander_damage(uid, _int(msg.get("from"), 0), _int(msg.get("delta"), 0))
        elif kind == "poison":
            t.poison(uid, _int(msg.get("delta"), 0))
        elif kind == "mana":
            if msg.get("clear") is True:
                t.clear_mana(uid)
            else:
                t.change_mana(uid, msg.get("color"), _int(msg.get("delta"), 0))
        elif kind == "peek":
            n = msg.get("n")
            cards = t.peek(uid, _int(n) if n is not None else None, quiet=bool(msg.get("quiet")))
            mode = "search" if n is None else "top"
            await self.send_json({"type": "peek", "mode": mode, "cards": cards, "quiet": bool(msg.get("quiet"))})
        elif kind == "reveal":
            t.reveal(uid, str(msg.get("card")))
        elif kind == "token":
            t.create_token(
                uid,
                msg.get("name"),
                msg.get("image"),
                msg.get("x"),
                msg.get("y"),
                msg.get("power"),
                msg.get("toughness"),
                back=msg.get("back") or "",
                helper=msg.get("helper") is True,
            )
        elif kind == "clone":
            t.clone(uid, str(msg.get("card")))
        elif kind == "roll":
            t.roll(uid, _int(msg.get("sides"), 0))
        elif kind == "chat":
            t.chat(uid, msg.get("text"))
        elif kind == "signal":
            t.signal(uid, msg.get("what"))
        elif kind == "pass_turn":
            t.pass_turn(uid)
        elif kind == "end_game":
            # Vira um pedido: outro jogador sentado confirma (end_vote)
            winner = msg.get("winner")
            t.request_end(uid, winner if winner is None else _int(winner, -1))
        elif kind == "end_vote":
            confirmed = t.vote_end(uid, msg.get("approve") is True)
            if confirmed:
                # Confirmado: a vitória conta (sorteio de origem ou ranking das mesas) e a mesa fecha
                previous = (t.data.get("result") or {}).get("record")
                position = t.end_game(confirmed["by"], confirmed["winner"])
                if t.data["dealt"]:
                    await store.save_draw_result(self.code, position)
                else:
                    t.data["result"]["record"] = await store.save_table_result(t.data, previous)
                await store.save_play_time(t.take_play_time())
                await store.save_replay(t.take_replay())
                self.finished = confirmed["winner_name"] or ""
        elif kind == "close_table":
            # Vira um pedido: outro jogador sentado confirma (close_vote); sozinho, fecha na hora
            if t.request_close(uid):
                self.closing = self.user.username
        elif kind == "close_vote":
            confirmed = t.vote_close(uid, msg.get("approve") is True)
            if confirmed:
                self.closing = confirmed["name"]
        elif kind == "new_game":
            t.new_game(uid)
        elif kind == "tap_many":
            t.tap_many(uid, msg.get("cards"), bool(msg.get("tapped")))
        elif kind == "move_many":
            position = "bottom" if msg.get("position") == "bottom" else "top"
            t.move_many(uid, msg.get("cards"), msg.get("to"), position)
        elif kind == "place_many":
            t.place_many(uid, msg.get("places"))
        elif kind == "reorder_top":
            t.reorder_top(uid, msg.get("order"))
        elif kind == "draw_to":
            t.draw_to(uid, _int(msg.get("n"), 1), msg.get("to"), msg.get("from") == "bottom")
        elif kind == "reveal_top":
            t.reveal_top(uid, _int(msg.get("n"), 1))
        elif kind == "top_revealed":
            t.toggle_top_revealed(uid)
        elif kind == "reveal_last_draw":
            t.reveal_last_draw(uid)
        elif kind == "scoop":
            t.scoop(uid)
        elif kind == "shake":
            t.shake(uid, str(msg.get("card")))
        elif kind == "invert":
            t.invert(uid, str(msg.get("card")))
        elif kind == "highlight":
            t.highlight(uid, str(msg.get("card")))
        elif kind == "lock":
            t.lock(uid, str(msg.get("card")))
        elif kind == "note":
            t.note(uid, str(msg.get("card")), msg.get("text"))
        elif kind == "symbol":
            t.symbol(uid, str(msg.get("card")), msg.get("symbol"))
        elif kind == "face_down":
            t.face_down(uid, str(msg.get("card")))
        elif kind == "flip":
            t.flip(uid, str(msg.get("card")))
        elif kind == "control":
            t.give_control(uid, str(msg.get("card")), msg.get("to"))
        elif kind == "request_control":
            t.request_control(uid, str(msg.get("card")))
        elif kind == "answer_control":
            t.answer_control(uid, str(msg.get("card")), msg.get("accept") is True)
        elif kind == "show_hand":
            t.show_hand(uid, msg.get("to"), msg.get("show"))
        elif kind == "set_afk":
            t.set_afk(uid, msg.get("player"), msg.get("afk"))
        elif kind == "attach":
            host = msg.get("to")
            t.attach(uid, str(msg.get("card")), None if host is None else str(host))
        elif kind == "target":
            t.target(uid, str(msg.get("card")), msg.get("to_card"), msg.get("to_player"))
        elif kind == "undo":
            t.request_undo(uid)
        elif kind == "rewind":
            t.request_rewind(uid, _int(msg.get("to")))
        elif kind == "undo_vote":
            t.vote_undo(uid, bool(msg.get("approve")))
        elif kind == "card_action":
            card, index = str(msg.get("card")), msg.get("index")
            out = t.card_action(uid, card, index, pick=msg.get("pick"), n=_int(msg.get("n")), image=msg.get("image"))
            if out and "pick" in out:
                await self.send_json({"type": "action_pick", "card": card, "index": index, "cards": out["pick"]})
                return True
            if out and "peek" in out:  # vidência: o topo do grimório só para quem usou
                cards = t.peek(uid, out["peek"], quiet=True)
                await self.send_json({"type": "peek", "mode": "top", "cards": cards, "quiet": False})
        elif kind == "each":
            await self.each(msg.get("cards"), msg.get("action"))
        elif kind == "keep_alive":
            pass  # só renova o prazo de inatividade
        else:
            raise state.ActionError("unknown_action")

    async def each(self, cards, action) -> None:
        """
        Várias cartas selecionadas: a mesma ação em cada uma (marcadores, inverter, virar para baixo...).
        Uma mensagem só (não estoura o limite de ações) e um desfazer só. Pula as cartas em que a ação
        não vale (de outro jogador, por exemplo); erro só se não valeu em nenhuma.
        """
        if not isinstance(cards, list) or not isinstance(action, dict) or action.get("type") not in EACH_KINDS:
            raise state.ActionError("invalid")
        ids = list(dict.fromkeys(str(c) for c in cards if isinstance(c, str)))[:EACH_MAX]
        done, error = 0, None
        for cid in ids:
            try:
                await self.handle(action["type"], {**action, "card": cid})
                done += 1
            except state.ActionError as err:
                error = err
        if not done and error:
            raise error

    async def abandon(self) -> None:
        """Sai da mesa de vez (o lugar fica livre). Sem ninguém sentado, a mesa fecha."""
        t = self.table
        try:
            t.abandon(self.user.id)
        except state.ActionError as err:
            await self.send_json({"type": "error", "code": err.code, "ack": self.last_cid})
            return
        t.leave(self.user.id)
        self.joined = False  # esta conexão não conta mais como jogador
        await self.channel_layer.group_discard(self.group, self.channel_name)
        log.info("mesa %s: %s abandonou a mesa", self.code, self.user.username)
        if not t.data["seats"]:
            await closer.close_table(self.code, "closed", self.user.username)
        else:
            t.mark_changed()
            await self.broadcast()
            store.schedule_save(self.code, t)
        await self.send_json({"type": "abandoned"})
        await self.close(code=4000)

    async def load_deck(self, kind, ref: str) -> None:
        # Mesa com regras (bracket, tutores, valor): o deck que não serve não entra
        rules = self.table.options()["rules"]
        if any(v is not None for v in rules.values()):
            profile = await store.deck_profile(kind, ref, need_bracket=rules["bracket"] is not None)
            if profile is None:
                raise state.ActionError("deck_not_found")
            problems = state.rule_problems(rules, profile)
            if problems:
                raise state.ActionError(problems[0])
        found = await store.deck_cards(kind, ref)
        if found is None:
            raise state.ActionError("deck_not_found")
        self.table.load_deck(self.user.id, *found)
        self.table.claim_dealt(self.user.id, found[0])

    async def authenticate(self, key: str, spectate: bool = False, setup=None):
        user = await user_for_token(key)
        if user is None:
            await self.bye(4401)
            return
        try:
            table = await get_table(self.code, user.id, setup)
        except state.ServerFull:
            log.warning("mesa %s: servidor cheio (%s mesas)", self.code, state.MAX_TABLES)
            await self.bye(4503)
            return
        except state.TooManyTables:
            log.info("mesa %s: %s já tem %s mesas abertas", self.code, user.username, state.TABLES_PER_USER)
            await self.bye(4430)
            return
        # A mesma conta aberta em muitas abas na mesma mesa (ou robô abrindo conexões)
        if table.online.get(user.id, 0) >= state.MAX_TABS or (
            spectate and len(table.spectators) >= state.MAX_SPECTATORS and user.id not in table.spectators
        ):
            await self.bye(4429)
            return
        seated = table.seat_of(user.id) is not None
        # Só amigos: sentar só amigo de quem abriu; assistir, amigo de qualquer jogador sentado
        friends = await database_sync_to_async(friend_ids)(user.id) if table.options()["friends_only"] and not seated else set()
        can_play, can_follow = table.access(user.id, friends)
        watchable = table.options()["allow_watch"] and can_follow
        if not (can_play or (spectate and can_follow)):
            await self.bye(4408, watch=watchable)
            return
        if spectate and not seated and not watchable:
            await self.bye(4407)
            return
        if spectate and table.seat_of(user.id) is None:
            # Mesa cheia e a pessoa escolheu assistir (quem já tem lugar entra como jogador)
            table.watch(user.id, user.username)
            log.info("mesa %s: %s entrou para assistir", self.code, user.username)
            self.user, self.table, self.spectator = user, table, True
            self.auth_timer.cancel()
            await self.channel_layer.group_add(self.group, self.channel_name)
            await self.broadcast()
            return
        from accounts.avatar import avatar_url
        from accounts.supporter import cosmetics

        photo = await database_sync_to_async(avatar_url)(user)
        perks = await database_sync_to_async(cosmetics)(user)
        try:
            table.join(user.id, user.username, photo, perks)
        except state.TableFull:
            log.info("mesa %s cheia: %s pode assistir", self.code, user.username)
            await self.bye(4403, watch=watchable)
            return
        except state.GameStarted:
            log.info("mesa %s já começou: %s pode assistir", self.code, user.username)
            await self.bye(4409, watch=watchable)
            return
        self.user, self.table, self.joined = user, table, True
        self.auth_timer.cancel()
        closer.ensure_sweeper()
        # Sala online: quem tem conta e foi sorteado já recebe o próprio deck na mesa
        dealt = table.dealt_for(user.id)
        if dealt and not table.seat_of(user.id)["deck"]:
            try:
                await self.load_deck(dealt["kind"], dealt["ref"])
            except state.ActionError:
                pass
        store.schedule_save(self.code, table)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.broadcast()

    async def bye(self, code: int, **extra) -> None:
        """
        Fecha a conexão avisando o motivo também numa mensagem antes. Em produção (Render) o quadro
        de fechamento com o código às vezes não chega ao navegador, que ficava em "Conectando…";
        a mensagem chega como as outras e o navegador para de tentar de novo.
        """
        try:
            await self.send_json({"type": "bye", "code": code, **extra})
        finally:
            await self.close(code=code)

    async def broadcast(self):
        # Nova atualização: a parte comum da visão é montada uma vez e serve a todas as conexões
        self.table.gen += 1
        await self.channel_layer.group_send(self.group, {"type": "table.state"})

    async def table_closed(self, event):
        self.joined = False  # nada de gravar de novo ao sair
        await self.channel_layer.group_discard(self.group, self.channel_name)
        await self.send_json({"type": "closed", "reason": event["reason"], "by": event.get("by")})
        await self.close(code=closer.CLOSE_CODE)

    async def table_state(self, event):
        try:
            await self._send_state()
        except Exception:
            log.exception("mesa %s: erro ao mandar a mesa para %s", self.code, getattr(self.user, "username", "?"))
            raise

    async def _send_state(self):
        # Cada conexão monta a visão do seu jogador (mão dos outros escondida)
        view = {**self.table.view(self.user.id, self.table.gen), "you": self.user.id}
        self.rev += 1
        if self.wants_delta and self.sent is not None:
            patch = delta.diff(self.sent, view)
            await self.send_json({"type": "delta", "rev": self.rev, "ack": self.last_cid, **patch})
        else:
            text = json.dumps(view, separators=(",", ":"))
            await self.send(text_data=f'{{"type":"state","rev":{self.rev},"ack":{self.last_cid},{text[1:]}')
        # A visão já é uma cópia (nada nela aponta para a mesa): guarda como base do próximo delta
        self.sent = view if self.wants_delta else None
        if self.spectator and self.rev == 1:
            log.info("mesa %s: mesa enviada para quem assiste (%s)", self.code, self.user.username)
