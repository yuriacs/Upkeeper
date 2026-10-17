/*
 * Carta sob o mouse no deckbuilder (para a prévia ampliada), fora do estado da página: só a prévia
 * redesenha quando o mouse passa de uma carta para outra, e a lista e a busca ficam paradas.
 */
import { useSyncExternalStore } from 'react'
import type { BuilderCard } from './deckbuilder'

let current: BuilderCard | null = null
const listeners = new Set<() => void>()

export function setBuilderHover(next: BuilderCard | null) {
  if (next === current) return
  current = next
  listeners.forEach((fn) => fn())
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const get = () => current

export const useBuilderHover = () => useSyncExternalStore(subscribe, get, get)
