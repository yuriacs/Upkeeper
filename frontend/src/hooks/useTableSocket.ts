import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthToken, wsUrl } from '../lib/api'

export type ZoneName = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'facedown'
export type TableCard = { id: string; name: string; image: string; back: string }
export type FieldCard = TableCard & { x: number; y: number; tapped: boolean }
export type TableDeck = { kind: 'precon' | 'user'; ref: string; name: string }
export type TablePlayer = {
  id: number
  name: string
  seat: number
  life: number
  online: boolean
  deck: TableDeck | null
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
  kind: string
  who: string
  seat: number
  card?: string | null
  frm?: string | number
  to?: string | number
  n?: number
  deck?: string
  position?: 'top' | 'bottom' | null
}
export type TableState = { code: string; max_seats: number; players: TablePlayer[]; log: LogItem[]; you: number }
export type TableStatus = 'connecting' | 'open' | 'reconnecting' | 'full' | 'unauthorized' | 'invalid'
export type TableAction =
  | { type: 'load_deck'; kind: 'precon' | 'user'; ref: string }
  | { type: 'draw'; n?: number }
  | { type: 'move'; card: string; to: ZoneName; x?: number; y?: number; position?: 'top' | 'bottom' }
  | { type: 'tap'; card: string }
  | { type: 'untap_all' | 'shuffle' | 'mulligan' | 'restart' }
  | { type: 'life'; delta: number }

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
    counts: { ...ZONE_COUNTS, ...p.counts },
    battlefield: p.battlefield ?? [],
    graveyard: p.graveyard ?? [],
    exile: p.exile ?? [],
    command: p.command ?? [],
    hand: p.hand ?? null,
    facedown: p.facedown ?? null,
  }))
  return { code: msg.code ?? '', max_seats: msg.max_seats ?? 4, you: msg.you ?? 0, log: msg.log ?? [], players }
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
          setStatus('open')
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

  return { table, status, error, send, outdated }
}
