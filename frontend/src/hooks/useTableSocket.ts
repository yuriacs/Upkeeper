import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthToken, wsUrl } from '../lib/api'
import { applyLocal, isOptimistic } from '../lib/tableOptimistic'
import type { CardAct } from '../components/table/cardActs'
import type { TableOptions } from '../lib/types'

/** Cores da mana em aberto: as cinco, incolor e "A" (qualquer cor) */
export const MANA_COLORS = ['W', 'U', 'B', 'R', 'G', 'C', 'A'] as const
export type ManaColor = (typeof MANA_COLORS)[number]

export type ZoneName = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'facedown'
export type TableCard = {
  id: string
  name: string
  image: string
  back: string
  /** Equipamento ou aura: ao entrar no campo, pede a carta onde prender */
  attach?: 'equipment' | 'aura' | null
  /** Tipos da carta (cemitério, exílio...): creature, artifact, enchantment... Mesas antigas não têm */
  types?: string[]
  /** Atalhos que o texto da carta permite (só nas suas cartas da mão e do campo) */
  acts?: CardAct[]
}
export type FieldCard = TableCard & {
  x: number
  y: number
  tapped: boolean
  counters: Record<string, number>
  token: boolean
  /** Carta de ajuda (Monarca, Iniciativa, O Anel, Radiação...): ficha sem o selo "Ficha" */
  helper: boolean
  commander: boolean
  /** Força/resistência atuais (sem contar marcadores +1/+1); null = carta sem contador de força */
  stats: { p: number; t: number } | null
  /** Força/resistência impressas na carta */
  base: { p: number; t: number } | null
  /** Dono (id da conta) e quem controla, se for outro jogador */
  owner: number
  controller: number | null
  /** Presa em outra carta do campo (equipamento, aura) */
  attached_to: string | null
  inverted: boolean
  highlight: boolean
  locked: boolean
  /** Virada para baixo: para quem não pode ver, nome e imagem vêm vazios */
  face_down: boolean
  flipped: boolean
  note: string | null
  /** Símbolos (marcações e habilidades), vários ao mesmo tempo */
  symbols: string[]
  /** Vaga na zona do comandante (o quadro no canto do campo); null = solta no campo */
  slot?: number | null
}
/** Destinos de "comprar para" (do topo ou do fundo do grimório) */
export type DrawTarget = 'hand' | 'graveyard' | 'exile' | 'facedown' | 'battlefield' | 'battlefield_down'
export type UndoRequest = {
  /** Desfazer a última ação, ou voltar a mesa inteira para um momento do histórico */
  kind: 'undo' | 'rewind'
  by: number
  name: string
  entry: LogItem
  needed: { id: number; name: string; approved: boolean }[]
  /** Segundos até o pedido expirar */
  left: number
}
export type TableUndo = {
  count: number
  last: LogItem | null
  /** Registros do log para onde a mesa pode voltar */
  checkpoints: number[]
  request: UndoRequest | null
}
export type TableDeck = { kind: 'precon' | 'user'; ref: string; name: string }
export type TablePlayer = {
  id: number
  name: string
  /** Foto de perfil (no lugar do ícone da cadeira) */
  avatar?: string | null
  seat: number
  life: number
  online: boolean
  /** Ausente (AFK): o turno pula; volta sozinho ao fazer qualquer coisa */
  afk: boolean
  /** Para quem este jogador está mostrando a mão (ids). Quem está na lista recebe a mão em `hand` */
  hand_shown: number[]
  /** Mostrando a mão para quem está assistindo (eles recebem a mão em `hand`) */
  hand_spectators: boolean
  deck: TableDeck | null
  poison: number
  /**
   * Mana em aberto, por cor (só as que têm algo): sobe ao virar fontes de mana, desce ao desvirar e
   * quando o jogador gasta; zera ao passar o turno. "A" = qualquer cor (fontes em que se escolhe a cor)
   */
  mana: Partial<Record<ManaColor, number>>
  /** Começo da partida: mão inicial e mulligan, até o jogador passar o primeiro turno */
  opening: boolean
  /** Topo do grimório sempre revelado (e a carta de cima, que todos veem) */
  top_revealed: boolean
  top: TableCard | null
  /** Dano de comandante recebido, por id (conta) de quem causou */
  cmd_damage: Record<string, number>
  /** Imposto de comandante: vezes que cada comandante (id da carta) foi conjurado */
  tax: Record<string, number>
  /** Quantos comandantes o deck tem (vagas da zona do comandante) */
  commanders?: number
  counts: Record<ZoneName, number>
  battlefield: FieldCard[]
  graveyard: TableCard[]
  exile: TableCard[]
  command: TableCard[]
  /** Só para o próprio jogador; para os outros vem null (só a quantidade em counts) */
  hand: TableCard[] | null
  facedown: TableCard[] | null
}
export type LogItem = {
  id?: number
  kind: string
  text?: string
  image?: string
  sides?: number
  counter?: string
  source?: string
  next?: string
  winner?: string | null
  /** Carta da ação (sacudir, alvo) e dono, quando a carta é de outro jogador */
  ref?: string
  owner?: string
  /** Desfazer: a ação desfeita (como saiu no log) */
  undone?: LogItem
  /** Cartas reveladas de uma vez (topo do grimório) */
  cards?: { name: string; image: string }[]
  /** Alvo: carta (id e dono) ou jogador (cadeira) */
  to_ref?: string
  to_owner?: string
  to_seat?: number
  p?: number
  t?: number
  who: string
  seat: number
  /** Ausente/de volta: o jogador marcado (null = quem fez se marcou) */
  target?: string | null
  /** Mostrar/esconder a mão: para quem está assistindo */
  spectators?: boolean
  /** Atalho de carta usado (card_action): qual modelo */
  act?: string
  /** Aviso rápido: "alert" (tenho uma resposta) ou "ok" (sem resposta) */
  what?: 'alert' | 'ok'
  card?: string | null
  frm?: string | number
  to?: string | number
  n?: number
  deck?: string
  position?: 'top' | 'bottom' | null
}
/** Pedido de controle de uma carta: quem pediu (from) e quem responde (to, quem controla agora) */
export type ControlRequest = {
  card: string
  name: string
  image: string
  from: number
  from_name: string
  to: number
  to_name: string
  /** Quando vence (segundos desde 1970, relógio do servidor) */
  until: number
}
export type DealtDeck = { position: number; player: string; deck: TableDeck; claimed: boolean }
export type TableState = {
  code: string
  max_seats: number
  players: TablePlayer[]
  log: LogItem[]
  dealt: DealtDeck[]
  /** Partida encerrada: vencedor (id da conta) ou null se terminou sem vencedor */
  result: { winner: number | null; winner_name: string | null; by: string; turn: number } | null
  /** Desfazer: quantas ações suas dá para desfazer, a última, e o pedido aberto na mesa */
  undo: TableUndo
  /** Pedidos de controle que você fez ou precisa responder */
  control: ControlRequest[]
  /** Quem está assistindo (mesa cheia) */
  spectators: string[]
  /** De quem é o turno (id da conta) e o número do turno */
  turn: { player: number | null; number: number }
  /** Segundos até a mesa fechar por inatividade (quando o estado foi enviado) e o prazo total */
  idle_left: number
  idle_close: number
  you: number
  /** Opções escolhidas ao abrir a mesa (título, estilo, só amigos, espectadores) */
  options: TableOptions
  /** Passou o primeiro turno: ninguém mais senta, só assiste */
  started: boolean
  /** Fim de partida pedido por um jogador, esperando outro confirmar */
  end_request: EndRequest | null
}
/** Pedido de fim de partida: quem pediu, o vencedor marcado (null = sem vencedor) e o tempo que falta */
export type EndRequest = { by: number; name: string; winner: number | null; winner_name: string | null; left: number }
/** Busca de um atalho de carta: as cartas do grimório que servem, para o jogador escolher */
export type ActionPick = { card: string; index: number; cards: TableCard[] }
/** ids: as cartas da primeira resposta (no "olhar o topo", a janela só mostra essas) */
export type Peek = { mode: 'top' | 'search'; cards: TableCard[]; ids: string[] }
export type TableStatus =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'full'
  | 'unauthorized'
  | 'invalid'
  | 'closed'
  // Limites contra abuso (tables/consumers.py): ações ou abas demais, mesas demais na conta, servidor cheio
  | 'blocked'
  | 'limit'
  | 'busy'
  // Você abandonou a mesa (o lugar ficou livre)
  | 'left'
  // Opções da mesa: sem espectadores, só amigos de quem abriu, partida já começada (só assistir)
  | 'no_watch'
  | 'friends_only'
  | 'started'
/** Por que a mesa fechou: 10 minutos sem alteração ("idle") ou um jogador encerrou ("closed") */
export type TableClosed = { reason: 'idle' | 'closed' | 'finished'; by: string | null }
export type TableAction =
  | { type: 'load_deck'; kind: 'precon' | 'user'; ref: string }
  | { type: 'draw'; n?: number }
  | { type: 'move'; card: string; to: ZoneName; x?: number; y?: number; position?: 'top' | 'bottom'; slot?: boolean }
  | { type: 'tap'; card: string }
  | { type: 'untap_all' | 'shuffle' | 'mulligan' | 'restart' | 'arrange' }
  | { type: 'life'; delta: number }
  | { type: 'counter'; card: string; kind: string; delta: number }
  | { type: 'tax'; card: string; delta: number }
  | { type: 'cmd_damage'; from: number; delta: number }
  | { type: 'poison'; delta: number }
  | { type: 'mana'; color: ManaColor; delta: number }
  | { type: 'mana'; clear: true }
  | { type: 'peek'; n: number | null; quiet?: boolean }
  | { type: 'reveal'; card: string }
  | {
      type: 'token'
      name: string
      image: string
      x?: number
      y?: number
      power?: string
      toughness?: string
      back?: string
      helper?: boolean
    }
  | { type: 'stat'; card: string; which: 'p' | 't'; delta: number }
  | { type: 'toggle_stats'; card: string }
  | { type: 'clone'; card: string }
  | { type: 'shake' | 'invert' | 'highlight' | 'lock' | 'face_down' | 'flip'; card: string }
  | { type: 'note'; card: string; text: string }
  | { type: 'draw_to'; n: number; to: DrawTarget; from?: 'top' | 'bottom' }
  | { type: 'tap_many'; cards: string[]; tapped: boolean }
  | { type: 'move_many'; cards: string[]; to: ZoneName; position?: 'top' | 'bottom' }
  | { type: 'place_many'; places: { card: string; x: number; y: number }[] }
  | { type: 'reveal_top'; n: number }
  | { type: 'reorder_top'; order: string[] }
  | { type: 'top_revealed' | 'reveal_last_draw' | 'scoop' }
  | { type: 'symbol'; card: string; symbol: string | null }
  | { type: 'control'; card: string; to: number }
  | { type: 'request_control'; card: string }
  | { type: 'answer_control'; card: string; accept: boolean }
  | { type: 'set_afk'; player: number; afk: boolean }
  | { type: 'show_hand'; to: number | null | 'spectators'; show: boolean }
  | { type: 'attach'; card: string; to: string | null }
  | { type: 'target'; card: string; to_card?: string; to_player?: number }
  | { type: 'roll'; sides: number }
  | { type: 'chat'; text: string }
  | { type: 'pass_turn' | 'new_game' | 'keep_alive' | 'close_table' | 'undo' | 'abandon' }
  | { type: 'undo_vote'; approve: boolean }
  | { type: 'rewind'; to: number }
  | { type: 'end_game'; winner: number | null }
  | { type: 'end_vote'; approve: boolean }
  | { type: 'card_action'; card: string; index: number; pick?: string[]; n?: number; image?: string }
  | { type: 'signal'; what: 'alert' | 'ok' }

const ZONE_COUNTS: Record<ZoneName, number> = {
  library: 0,
  hand: 0,
  battlefield: 0,
  graveyard: 0,
  exile: 0,
  command: 0,
  facedown: 0,
}

/** Completa campos que faltarem numa carta do campo (servidor de outra versão). */
function normalizeCard(c: Partial<FieldCard> & TableCard, ownerId: number): FieldCard {
  return {
    ...c,
    x: c.x ?? 0.5,
    y: c.y ?? 0.5,
    tapped: !!c.tapped,
    counters: c.counters ?? {},
    token: !!c.token,
    helper: !!c.helper,
    commander: !!c.commander,
    stats: c.stats ?? null,
    base: c.base ?? null,
    owner: c.owner ?? ownerId,
    controller: c.controller ?? null,
    attached_to: c.attached_to ?? null,
    inverted: !!c.inverted,
    highlight: !!c.highlight,
    locked: !!c.locked,
    face_down: !!c.face_down,
    flipped: !!c.flipped,
    note: c.note ?? null,
    symbols: c.symbols ?? ((c as { symbol?: string | null }).symbol ? [(c as { symbol?: string }).symbol!] : []),
  }
}

function normalizePlayer(p: TablePlayer): TablePlayer {
  return {
    ...p,
    deck: p.deck ?? null,
    poison: p.poison ?? 0,
    mana: typeof p.mana === 'object' && p.mana ? p.mana : {},
    afk: !!p.afk,
    hand_shown: p.hand_shown ?? [],
    hand_spectators: !!p.hand_spectators,
    opening: p.opening ?? false,
    top_revealed: !!p.top_revealed,
    top: p.top ?? null,
    cmd_damage: p.cmd_damage ?? {},
    tax: p.tax ?? {},
    counts: { ...ZONE_COUNTS, ...p.counts },
    battlefield: (p.battlefield ?? []).map((c) => normalizeCard(c, p.id)),
    graveyard: p.graveyard ?? [],
    exile: p.exile ?? [],
    command: p.command ?? [],
    hand: p.hand ?? null,
    facedown: p.facedown ?? null,
  }
}

/** Completa campos que faltarem (servidor de outra versão) para a tela nunca quebrar. */
function normalize(msg: Partial<TableState>): TableState {
  return {
    code: msg.code ?? '',
    max_seats: msg.max_seats ?? 4,
    you: msg.you ?? 0,
    log: msg.log ?? [],
    dealt: msg.dealt ?? [],
    turn: msg.turn ?? { player: null, number: 0 },
    result: msg.result ?? null,
    undo: { count: 0, last: null, request: null, ...msg.undo, checkpoints: msg.undo?.checkpoints ?? [] },
    control: msg.control ?? [],
    spectators: msg.spectators ?? [],
    idle_left: msg.idle_left ?? 600,
    idle_close: msg.idle_close ?? 600,
    options: { title: '', style: null, friends_only: false, allow_watch: true, ...msg.options },
    started: !!msg.started,
    end_request: msg.end_request ?? null,
    players: (msg.players ?? []).map(normalizePlayer),
  }
}

/** Mudanças que o servidor manda depois da primeira mesa inteira (backend: tables/delta.py). */
type PlayerDelta = Partial<TablePlayer> & {
  full?: TablePlayer
  bf_set?: FieldCard[]
  bf_del?: string[]
  bf_order?: string[]
}
type Delta = Partial<Omit<TableState, 'players' | 'log'>> & {
  log_add?: LogItem[]
  order?: number[]
  players?: Record<string, PlayerDelta>
}

/**
 * Aplica o delta mantendo os mesmos objetos para o que não mudou: jogadores e cartas intactos
 * continuam iguais (===), e a tela só redesenha as cartas que mudaram de verdade.
 */
function applyDelta(prev: TableState, d: Delta): TableState {
  const next: TableState = { ...prev }
  const top = [
    'code',
    'max_seats',
    'you',
    'dealt',
    'turn',
    'result',
    'control',
    'spectators',
    'idle_left',
    'idle_close',
    'options',
    'started',
    'end_request',
  ] as const
  for (const key of top) if (key in d) (next as Record<string, unknown>)[key] = d[key]
  if (d.undo) next.undo = { ...d.undo, checkpoints: d.undo.checkpoints ?? [] }
  if (d.log_add?.length) next.log = [...prev.log, ...d.log_add].slice(-100)
  if (d.players || d.order) {
    const byId = new Map(prev.players.map((p) => [p.id, p]))
    for (const [key, change] of Object.entries(d.players ?? {})) {
      const id = Number(key)
      if (change.full) {
        byId.set(id, normalizePlayer(change.full))
        continue
      }
      const old = byId.get(id)
      if (!old) continue
      const { bf_set, bf_del, bf_order, ...fields } = change
      const p: TablePlayer = { ...old, ...fields }
      if (fields.counts) p.counts = { ...ZONE_COUNTS, ...fields.counts }
      if (bf_set || bf_del || bf_order) {
        const cards = new Map(old.battlefield.map((c) => [c.id, c]))
        for (const c of bf_set ?? []) cards.set(c.id, normalizeCard(c, id))
        for (const cid of bf_del ?? []) cards.delete(cid)
        const ids = bf_order ?? old.battlefield.map((c) => c.id).filter((cid) => cards.has(cid))
        p.battlefield = ids.map((cid) => cards.get(cid)).filter((c): c is FieldCard => !!c)
      }
      byId.set(id, p)
    }
    const order = d.order ?? prev.players.map((p) => p.id)
    next.players = order.map((id) => byId.get(id)).filter((p): p is TablePlayer => !!p)
  }
  return next
}

// Códigos de fechamento definidos no backend (tables/consumers.py): estes não adianta repetir
const FINAL: Record<number, TableStatus> = {
  4401: 'unauthorized',
  4403: 'full',
  4404: 'invalid',
  4410: 'closed',
  4413: 'blocked',
  4429: 'blocked',
  4430: 'limit',
  4503: 'busy',
  4407: 'no_watch',
  4408: 'friends_only',
  4409: 'started',
}

/** Opções da mesa nova (janela "Nova mesa"): vão na primeira conexão de quem abre a mesa */
const SETUP_KEY = (code: string) => `precon-draft:table-setup:${code}`
export function saveTableSetup(code: string, setup: Record<string, unknown>) {
  try {
    sessionStorage.setItem(SETUP_KEY(code), JSON.stringify(setup))
  } catch {
    /* sem armazenamento: a mesa abre com o padrão */
  }
}
function takeTableSetup(code: string): unknown {
  try {
    const raw = sessionStorage.getItem(SETUP_KEY(code))
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}
function dropTableSetup(code: string) {
  try {
    sessionStorage.removeItem(SETUP_KEY(code))
  } catch {
    /* nada */
  }
}

/**
 * Conexão com a mesa virtual. Reconecta sozinha (o servidor gratuito pode reiniciar a qualquer
 * momento) com espera crescente de 1 s até 10 s; a partida fica salva no servidor.
 */
export function useTableSocket(code: string, watchFirst = false) {
  const [table, setTable] = useState<TableState | null>(null)
  const [status, setStatus] = useState<TableStatus>('connecting')
  const [error, setError] = useState<{ code: string; at: number } | null>(null)
  const [outdated, setOutdated] = useState(false)
  // Resposta de "olhar o topo" / "buscar no grimório": só chega para quem pediu
  const [peek, setPeek] = useState<Peek | null>(null)
  const [actionPick, setActionPick] = useState<ActionPick | null>(null)
  // Último registro do log quando a mesa abriu: revelações anteriores não reaparecem
  const [logStart, setLogStart] = useState<number | null>(null)
  // Número do turno quando a mesa abriu: só oferece desvirar + comprar em turnos que começam depois
  const [turnStart, setTurnStart] = useState<number | null>(null)
  // Hora (relógio deste navegador) em que a mesa fecha se ninguém mexer nela
  const [closesAt, setClosesAt] = useState<number | null>(null)
  const [closed, setClosed] = useState<TableClosed | null>(null)
  // Mesa cheia: entrar como espectador (vê a mesa, sem as mãos, sem mexer)
  const [spectating, setSpectating] = useState(watchFirst)
  // Mesa cheia ou já começada: o servidor diz se ela aceita espectadores
  const [canWatch, setCanWatch] = useState(true)
  const ws = useRef<WebSocket | null>(null)
  // Previsão local: último estado do servidor + ações enviadas que ele ainda não confirmou
  const server = useRef<TableState | null>(null)
  const pending = useRef<{ cid: number; action: TableAction }[]>([])
  const cid = useRef(0)
  // Número da última mensagem aplicada: um delta fora de ordem pede a mesa inteira de novo
  const rev = useRef(0)
  const resyncing = useRef(false)
  const render = useCallback(() => {
    if (server.current) setTable(pending.current.reduce((st, p) => applyLocal(st, p.action), server.current))
  }, [])

  useEffect(() => {
    let stopped = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    let answered: ReturnType<typeof setTimeout> | undefined
    // O servidor avisou que vai fechar de vez (mesa cheia, sessão expirada...): não tenta de novo
    let finished = false
    const finish = (sock: WebSocket, status: TableStatus) => {
      finished = true
      clearTimeout(answered)
      setStatus(status)
      sock.close()
    }
    const connect = () => {
      const sock = new WebSocket(wsUrl(`/ws/tables/${code}/`))
      ws.current = sock
      // Conectou mas o servidor não mandou a mesa em 15 s (servidor travado ou acordando): fecha e
      // tenta de novo, em vez de ficar em "Conectando…" para sempre
      clearTimeout(answered)
      answered = setTimeout(() => sock.readyState !== WebSocket.CLOSED && sock.close(4000), 15_000)
      sock.onopen = () => {
        attempt = 0
        pending.current = [] // conexão nova: o servidor recomeça a contagem de "ack"
        cid.current = 0
        rev.current = 0
        resyncing.current = false
        server.current = null
        const setup = takeTableSetup(code)
        sock.send(
          JSON.stringify({ type: 'auth', token: getAuthToken(), delta: true, spectate: spectating, ...(setup ? { setup } : {}) }),
        )
      }
      sock.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'state') {
          clearTimeout(answered)
          dropTableSetup(code) // a mesa já existe: as opções valeram (ou ela já existia antes)
          // Servidor antigo (Fase 0) não manda log nem cartas: sinaliza em vez de quebrar a página
          setOutdated(!Array.isArray(msg.log))
          server.current = normalize(msg)
          rev.current = msg.rev ?? 0
          resyncing.current = false
          pending.current = pending.current.filter((p) => p.cid > (msg.ack ?? 0))
          render()
          setLogStart((prev) => prev ?? (Array.isArray(msg.log) ? (msg.log.at(-1)?.id ?? 0) : 0))
          setTurnStart((prev) => prev ?? msg.turn?.number ?? 0)
          if (typeof msg.idle_left === 'number') setClosesAt(Date.now() + msg.idle_left * 1000)
          setStatus('open')
        } else if (msg.type === 'delta') {
          // Só o que mudou desde a última mensagem
          if (resyncing.current) return // a mesa inteira já foi pedida e está a caminho
          if (!server.current || (msg.rev && msg.rev !== rev.current + 1)) {
            resyncing.current = true
            sock.send(JSON.stringify({ type: 'resync' }))
            return
          }
          rev.current = msg.rev ?? rev.current + 1
          server.current = applyDelta(server.current, msg)
          pending.current = pending.current.filter((p) => p.cid > (msg.ack ?? 0))
          render()
          if (typeof msg.idle_left === 'number') setClosesAt(Date.now() + msg.idle_left * 1000)
        } else if (msg.type === 'peek') {
          // Atualizações (quiet) mantêm o conjunto original de cartas
          // Atualização (quiet) que chega depois de fechar a janela não pode reabri-la
          setPeek((prev) =>
            msg.quiet && !prev
              ? null
              : {
                  mode: msg.mode,
                  cards: msg.cards,
                  ids: prev && prev.mode === msg.mode ? prev.ids : msg.cards.map((c: TableCard) => c.id),
                },
          )
        } else if (msg.type === 'bye') {
          // Motivo do fechamento numa mensagem (o quadro de fechamento às vezes não chega)
          const final = FINAL[msg.code as number]
          if (typeof msg.watch === 'boolean') setCanWatch(msg.watch)
          if (final) finish(sock, final)
        } else if (msg.type === 'action_pick') {
          setActionPick({ card: msg.card, index: msg.index, cards: msg.cards ?? [] })
        } else if (msg.type === 'abandoned') {
          finish(sock, 'left')
        } else if (msg.type === 'closed') {
          setClosed({
            reason: msg.reason === 'closed' || msg.reason === 'finished' ? msg.reason : 'idle',
            by: msg.by ?? null,
          })
          finish(sock, 'closed')
        } else if (msg.type === 'error') {
          // Ação recusada: tira a previsão dela (a tela volta ao estado do servidor)
          pending.current = pending.current.filter((p) => p.cid > (msg.ack ?? 0))
          render()
          setError({ code: msg.code, at: Date.now() })
        }
      }
      sock.onclose = (ev) => {
        clearTimeout(answered)
        if (stopped || finished) return
        const final = FINAL[ev.code]
        if (final) {
          setStatus(final)
          return
        }
        setStatus('reconnecting')
        attempt += 1
        timer = setTimeout(connect, Math.min(10_000, 1000 * attempt))
      }
    }
    connect()
    return () => {
      stopped = true
      clearTimeout(timer)
      clearTimeout(answered)
      ws.current?.close()
    }
  }, [code, render, spectating])

  const send = useCallback(
    (action: TableAction) => {
      if (ws.current?.readyState !== WebSocket.OPEN) return
      cid.current += 1
      ws.current.send(JSON.stringify({ ...action, cid: cid.current }))
      if (isOptimistic(action)) {
        pending.current.push({ cid: cid.current, action })
        render()
      }
    },
    [render],
  )

  const closePeek = useCallback(() => setPeek(null), [])
  const closeActionPick = useCallback(() => setActionPick(null), [])
  /** Assistir (mesa cheia) ou, assistindo, sentar num lugar que vagou */
  const watch = useCallback(() => {
    setStatus('connecting')
    setSpectating(true)
  }, [])
  const play = useCallback(() => {
    setStatus('connecting')
    setSpectating(false)
  }, [])
  return {
    table,
    status,
    error,
    send,
    outdated,
    peek,
    closePeek,
    actionPick,
    closeActionPick,
    logStart,
    turnStart,
    closesAt,
    closed,
    spectating,
    canWatch,
    watch,
    play,
  }
}
