import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthToken, wsUrl } from '../lib/api'

export type TablePlayer = { id: number; name: string; seat: number; life: number; online: boolean }
export type TableState = { code: string; max_seats: number; players: TablePlayer[]; you: number }
export type TableStatus = 'connecting' | 'open' | 'reconnecting' | 'full' | 'unauthorized' | 'invalid'

// Códigos de fechamento definidos no backend (tables/consumers.py): estes não adianta repetir
const FINAL: Record<number, TableStatus> = { 4401: 'unauthorized', 4403: 'full', 4404: 'invalid' }

/**
 * Conexão com a mesa virtual. Reconecta sozinha (o servidor gratuito pode reiniciar a qualquer
 * momento) com espera crescente de 1 s até 10 s; a cadeira e a vida continuam no servidor.
 */
export function useTableSocket(code: string) {
  const [table, setTable] = useState<TableState | null>(null)
  const [status, setStatus] = useState<TableStatus>('connecting')
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
          setTable(msg as TableState)
          setStatus('open')
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

  const changeLife = useCallback((delta: number) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: 'life', delta }))
  }, [])

  return { table, status, changeLife }
}
