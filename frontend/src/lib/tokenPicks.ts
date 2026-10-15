/*
 * Fichas e cartas de ajuda favoritas e usadas por último, guardadas neste navegador: aparecem no
 * topo da janela de fichas para criar de novo com um clique.
 */
import { useSyncExternalStore } from 'react'
import { readJSON, writeJSON } from './storage'

/** Ficha do Scryfall (a imagem identifica a arte escolhida) */
export type SavedToken = { name: string; image: string; small: string; power?: string; toughness?: string }

type Picks = {
  tokens: { recent: SavedToken[]; favorite: SavedToken[] }
  /** Cartas de ajuda: só a chave (helpers.ts) */
  helpers: { recent: string[]; favorite: string[] }
}

const KEY = 'precon-draft:token-picks'
const MAX_RECENT = 8
const MAX_FAVORITE = 24

const isToken = (t: unknown): t is SavedToken =>
  !!t && typeof (t as SavedToken).name === 'string' && typeof (t as SavedToken).image === 'string'
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [])
const tokens = (v: unknown) => (Array.isArray(v) ? v.filter(isToken) : [])

function load(): Picks {
  const raw = readJSON<Partial<Picks>>(KEY, {})
  return {
    tokens: {
      recent: tokens(raw.tokens?.recent).slice(0, MAX_RECENT),
      favorite: tokens(raw.tokens?.favorite).slice(0, MAX_FAVORITE),
    },
    helpers: {
      recent: strings(raw.helpers?.recent).slice(0, MAX_RECENT),
      favorite: strings(raw.helpers?.favorite).slice(0, MAX_FAVORITE),
    },
  }
}

let current = load()
const listeners = new Set<() => void>()
const save = (next: Picks) => {
  current = next
  writeJSON(KEY, current)
  listeners.forEach((fn) => fn())
}

/** Ficha criada: vai para o começo dos recentes */
export function rememberToken(token: SavedToken) {
  const recent = [token, ...current.tokens.recent.filter((t) => t.image !== token.image)].slice(0, MAX_RECENT)
  save({ ...current, tokens: { ...current.tokens, recent } })
}

export function toggleFavoriteToken(token: SavedToken) {
  const list = current.tokens.favorite
  const favorite = list.some((t) => t.image === token.image)
    ? list.filter((t) => t.image !== token.image)
    : [token, ...list].slice(0, MAX_FAVORITE)
  save({ ...current, tokens: { ...current.tokens, favorite } })
}

/** Carta de ajuda criada: vai para o começo dos recentes */
export function rememberHelper(key: string) {
  const recent = [key, ...current.helpers.recent.filter((k) => k !== key)].slice(0, MAX_RECENT)
  save({ ...current, helpers: { ...current.helpers, recent } })
}

export function toggleFavoriteHelper(key: string) {
  const list = current.helpers.favorite
  const favorite = list.includes(key) ? list.filter((k) => k !== key) : [key, ...list].slice(0, MAX_FAVORITE)
  save({ ...current, helpers: { ...current.helpers, favorite } })
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const get = () => current

export const useTokenPicks = () => useSyncExternalStore(subscribe, get, get)
