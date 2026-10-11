import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthToken, wsUrl } from '../lib/api'
import { applyLocal, isOptimistic } from '../lib/tableOptimistic'

export type ZoneName = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'facedown'
export type TableCard = { id: string; name: string; image: string; back: string }
export type FieldCard = TableCard & {
  x: number
  y: number
  tapped: boolean
  counters: Record<string, number>
  token: boolean
  commander: boolean
  /** Força/resistência atuais (sem contar marcadores +1/+1); null = carta sem contador de força */
  stats: { p: number; t: number } | null
  /** Força/resistência impressas na carta */
  base: { p: number; t: number } | null
}
export type TableDeck = { kind: 'precon' | 'user'; ref: string; name: string }
export type TablePlayer = {
  id: number
  name: string
  seat: number
  life: number
  online: boolean
  deck: TableDeck | null
  poison: number
  /** Começo da partida: mão inicial e mulligan, até o jogador passar o primeiro turno */
  opening: boolean
  /** Dano de comandante recebido, por id (conta) de quem causou */
  cmd_damage: Record<string, number>
  /** Imposto de comandante: vezes que cada comandante (id da carta) foi conjurado */
  tax: Record<string, number>
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
  p?: number
  t?: number
  who: string
  seat: number
  card?: string | null
  frm?: string | number
  to?: string | number
  n?: number
  deck?: string
  position?: 'top' | 'bottom' | null
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
  /** De quem é o turno (id da conta) e o número do turno */
  turn: { player: number | null; number: number }
  /** Segundos até a mesa fechar por inatividade (quando o estado foi enviado) e o prazo total */
  idle_left: number
  idle_close: number
  you: number
}
/** ids: as cartas da primeira resposta (no "olhar o topo", a janela só mostra essas) */
export type Peek = { mode: 'top' | 'search'; cards: TableCard[]; ids: string[] }
export type TableStatus = 'connecting' | 'open' | 'reconnecting' | 'full' | 'unauthorized' | 'invalid' | 'closed'
/** Por que a mesa fechou: 10 minutos sem alteração ("idle") ou um jogador encerrou ("closed") */
export type TableClosed = { reason: 'idle' | 'closed'; by: string | null }
export type TableAction =
  | { type: 'load_deck'; kind: 'precon' | 'user'; ref: string }
  | { type: 'draw'; n?: number }
  | { type: 'move'; card: string; to: ZoneName; x?: number; y?: number; position?: 'top' | 'bottom' }
  | { type: 'tap'; card: string }
  | { type: 'untap_all' | 'shuffle' | 'mulligan' | 'restart' }
  | { type: 'life'; delta: number }
  | { type: 'counter'; card: string; kind: string; delta: number }
  | { type: 'tax'; card: string; delta: number }
  | { type: 'cmd_damage'; from: number; delta: number }
  | { type: 'poison'; delta: number }
  | { type: 'peek'; n: number | null; quiet?: boolean }
  | { type: 'reveal'; card: string }
  | { type: 'token'; name: string; image: string; x?: number; y?: number; power?: string; toughness?: string }
  | { type: 'stat'; card: string; which: 'p' | 't'; delta: number }
  | { type: 'toggle_stats'; card: string }
  | { type: 'clone'; card: string }
  | { type: 'roll'; sides: number }
  | { type: 'chat'; text: string }
  | { type: 'pass_turn' | 'new_game' | 'keep_alive' | 'close_table' }
  | { type: 'end_game'; winner: number | null }

const ZONE_COUNTS: Record<ZoneName, number> = {
  library: 0,
  hand: 0,
  battlefield: 0,
  graveyard: 0,
  exile: 0,
  command: 0,
  facedown: 0,
}

/** Completa campos que faltarem (servidor de outra versão) para a tela nunca quebrar. */
function normalize(msg: Partial<TableState>): TableState {
  const players = (msg.players ?? []).map((p) => ({
    ...p,
    deck: p.deck ?? null,
    poison: p.poison ?? 0,
    opening: p.opening ?? false,
    cmd_damage: p.cmd_damage ?? {},
    tax: p.tax ?? {},
    counts: { ...ZONE_COUNTS, ...p.counts },
    battlefield: (p.battlefield ?? []).map((c) => ({
      ...c,
      counters: c.counters ?? {},
      token: !!c.token,
      commander: !!c.commander,
      stats: c.stats ?? null,
      base: c.base ?? null,
    })),
    graveyard: p.graveyard ?? [],
    exile: p.exile ?? [],
    command: p.command ?? [],
    hand: p.hand ?? null,
    facedown: p.facedown ?? null,
  }))
  return {
    code: msg.code ?? '',
    max_seats: msg.max_seats ?? 4,
    you: msg.you ?? 0,
    log: msg.log ?? [],
    dealt: msg.dealt ?? [],
    turn: msg.turn ?? { player: null, number: 0 },
    result: msg.result ?? null,
    idle_left: msg.idle_left ?? 600,
    idle_close: msg.idle_close ?? 600,
    players,
  }
}

// Códigos de fechamento definidos no backend (tables/consumers.py): estes não adianta repetir
const FINAL: Record<number, TableStatus> = { 4401: 'unauthorized', 4403: 'full', 4404: 'invalid', 4410: 'closed' }

/**
 * Conexão com a mesa virtual. Reconecta sozinha (o servidor gratuito pode reiniciar a qualquer
 * momento) com espera crescente de 1 s até 10 s; a partida fica salva no servidor.
 */
export function useTableSocket(code: string) {
  const [table, setTable] = useState<TableState | null>(null)
  const [status, setStatus] = useState<TableStatus>('connecting')
  const [error, setError] = useState<{ code: string; at: number } | null>(null)
  const [outdated, setOutdated] = useState(false)
  // Resposta de "olhar o topo" / "buscar no grimório": só chega para quem pediu
  const [peek, setPeek] = useState<Peek | null>(null)
  // Último registro do log quando a mesa abriu: revelações anteriores não reaparecem
  const [logStart, setLogStart] = useState<number | null>(null)
  // Número do turno quando a mesa abriu: só oferece desvirar + comprar em turnos que começam depois
  const [turnStart, setTurnStart] = useState<number | null>(null)
  // Hora (relógio deste navegador) em que a mesa fecha se ninguém mexer nela
  const [closesAt, setClosesAt] = useState<number | null>(null)
  const [closed, setClosed] = useState<TableClosed | null>(null)
  const ws = useRef<WebSocket | null>(null)
  // Previsão local: último estado do servidor + ações enviadas que ele ainda não confirmou
  const server = useRef<TableState | null>(null)
  const pending = useRef<{ cid: number; action: TableAction }[]>([])
  const cid = useRef(0)
  const render = useCallback(() => {
    if (server.current) setTable(pending.current.reduce((st, p) => applyLocal(st, p.action), server.current))
  }, [])

  useEffect(() => {
    let stopped = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      const sock = new WebSocket(wsUrl(`/ws/tables/${code}/`))
      ws.current = sock
      sock.onopen = () => {
        attempt = 0
        pending.current = [] // conexão nova: o servidor recomeça a contagem de "ack"
        cid.current = 0
        sock.send(JSON.stringify({ type: 'auth', token: getAuthToken() }))
      }
      sock.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'state') {
          // Servidor antigo (Fase 0) não manda log nem cartas: sinaliza em vez de quebrar a página
          setOutdated(!Array.isArray(msg.log))
          server.current = normalize(msg)
          pending.current = pending.current.filter((p) => p.cid > (msg.ack ?? 0))
          render()
          setLogStart((prev) => prev ?? (Array.isArray(msg.log) ? (msg.log.at(-1)?.id ?? 0) : 0))
          setTurnStart((prev) => prev ?? msg.turn?.number ?? 0)
          if (typeof msg.idle_left === 'number') setClosesAt(Date.now() + msg.idle_left * 1000)
          setStatus('open')
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
        } else if (msg.type === 'closed') {
          setClosed({ reason: msg.reason === 'closed' ? 'closed' : 'idle', by: msg.by ?? null })
        } else if (msg.type === 'error') {
          // Ação recusada: tira a previsão dela (a tela volta ao estado do servidor)
          pending.current = pending.current.filter((p) => p.cid > (msg.ack ?? 0))
          render()
          setError({ code: msg.code, at: Date.now() })
        }
      }
      sock.onclose = (ev) => {
        if (stopped) return
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
      ws.current?.close()
    }
  }, [code, render])

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
  return { table, status, error, send, outdated, peek, closePeek, logStart, turnStart, closesAt, closed }
}
