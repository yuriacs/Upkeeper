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

/** A carta sob o mouse agora (para o atalho L) */
export const getBuilderHover = () => current

// Cartas de duas faces mostrando o verso no deckbuilder (L ou o botão de virar), pelo id da edição
const backs = new Set<string>()
const backListeners = new Set<() => void>()

export function toggleBuilderBack(id: string) {
  if (!backs.delete(id)) backs.add(id)
  backListeners.forEach((fn) => fn())
}

const subscribeBacks = (fn: () => void) => {
  backListeners.add(fn)
  return () => backListeners.delete(fn)
}

/** A carta está mostrando o verso no deckbuilder */
export const useBuilderBack = (id: string | undefined) =>
  useSyncExternalStore(
    subscribeBacks,
    () => !!id && backs.has(id),
    () => false,
  )
