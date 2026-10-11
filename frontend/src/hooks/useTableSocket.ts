import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthToken, wsUrl } from '../lib/api'

export type ZoneName = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'facedown'
export type TableCard = { id: string; name: string; image: string; back: string }
export type FieldCard = TableCard & {
  x: number
  y: number
  tapped: boolean
  counters: Record<string, number>
  token: boolean
  commander: boolean
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
  you: number
}
/** ids: as cartas da primeira resposta (no "olhar o topo", a janela só mostra essas) */
export type Peek = { mode: 'top' | 'search'; cards: TableCard[]; ids: string[] }
export type TableStatus = 'connecting' | 'open' | 'reconnecting' | 'full' | 'unauthorized' | 'invalid'
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
  | { type: 'token'; name: string; image: string; x?: number; y?: number }
  | { type: 'clone'; card: string }
  | { type: 'roll'; sides: number }
  | { type: 'chat'; text: string }

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
    cmd_damage: p.cmd_damage ?? {},
    tax: p.tax ?? {},
    counts: { ...ZONE_COUNTS, ...p.counts },
    battlefield: (p.battlefield ?? []).map((c) => ({
      ...c,
      counters: c.counters ?? {},
      token: !!c.token,
      commander: !!c.commander,
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
    players,
  }
}

// Códigos de fechamento definidos no backend (tables/consumers.py): estes não adianta repetir
const FINAL: Record<number, TableStatus> = { 4401: 'unauthorized', 4403: 'full', 4404: 'invalid' }

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
  const ws = useRef<WebSocket | null>(null)

  useEffect(() => {
    let stopped = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      const sock = new WebSocket(wsUrl(`/ws/tables/${code}/`))
      ws.current = sock
      sock.onopen = () => {
        attempt = 0
        sock.send(JSON.stringify({ type: 'auth', token: getAuthToken() }))
      }
      sock.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'state') {
          // Servidor antigo (Fase 0) não manda log nem cartas: sinaliza em vez de quebrar a página
          setOutdated(!Array.isArray(msg.log))
          setTable(normalize(msg))
          setLogStart((prev) => prev ?? (Array.isArray(msg.log) ? (msg.log.at(-1)?.id ?? 0) : 0))
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
        } else if (msg.type === 'error') {
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
  }, [code])

  const send = useCallback((action: TableAction) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(action))
  }, [])

  const closePeek = useCallback(() => setPeek(null), [])
  return { table, status, error, send, outdated, peek, closePeek, logStart }
}
