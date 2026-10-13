/*
 * Marcadores com nome próprio que você já usou (ex.: "Lore", "Oil", "Shield"), guardados neste
 * navegador: aparecem no menu de marcadores para pôr em outra carta com um clique.
 */
import { useSyncExternalStore } from 'react'
import { readJSON, writeJSON } from './storage'

const KEY = 'precon-draft:saved-counters'
const MAX = 12

let current: string[] = readJSON<string[]>(KEY, [])
  .filter((k) => typeof k === 'string')
  .slice(0, MAX)
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

/** Guarda (no começo da lista) um marcador com nome próprio */
export function rememberCounter(kind: string) {
  const name = kind.trim()
  if (!name) return
  current = [name, ...current.filter((k) => k.toLowerCase() !== name.toLowerCase())].slice(0, MAX)
  writeJSON(KEY, current)
  emit()
}

export function forgetCounter(kind: string) {
  current = current.filter((k) => k !== kind)
  writeJSON(KEY, current)
  emit()
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const get = () => current

export const useSavedCounters = () => useSyncExternalStore(subscribe, get, get)
