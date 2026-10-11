/*
 * Carta sob o mouse (para a prévia ampliada), fora do estado da mesa: só o componente da prévia
 * redesenha quando o mouse passa de uma carta para outra.
 */
import { useSyncExternalStore } from 'react'
import type { TableCard } from '../hooks/useTableSocket'

export type HoverPreview = { card: TableCard; side: 'left' | 'right' } | null

let current: HoverPreview = null
const listeners = new Set<() => void>()

export function setHoverPreview(next: HoverPreview) {
  if (next === current || (next && current && next.card === current.card && next.side === current.side)) return
  current = next
  listeners.forEach((fn) => fn())
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const get = () => current

export const useHoverPreview = () => useSyncExternalStore(subscribe, get, get)
