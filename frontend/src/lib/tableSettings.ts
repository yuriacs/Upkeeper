/*
 * Configurações da mesa virtual, por navegador (localStorage). Qualquer componente lê com
 * useTableSettings() e redesenha quando algo muda na janela de configurações.
 */
import { useSyncExternalStore } from 'react'
import { readJSON, writeJSON } from './storage'

export type PreviewSide = 'auto' | 'left' | 'right'

export type TableSettings = {
  /** Tamanho das cartas no campo (1 = padrão) */
  boardScale: number
  /** Tamanho das cartas na mão */
  handScale: number
  /** Carta ampliada ao passar o mouse */
  previewEnabled: boolean
  previewWidth: number
  previewSide: PreviewSide
  /** Espera antes de ampliar (ms): evita a carta grande piscando ao passar o mouse pelo campo */
  previewDelay: number
  /** Ao receber o turno, desvirar tudo e comprar sem perguntar */
  autoUntap: boolean
  /** Menos movimento: sem tremer/girar cartas e sem animações de entrada */
  reduceMotion: boolean
  /** Símbolos (voar, toque mortífero...) ao lado das cartas */
  showSymbols: boolean
  /** Nome do jogador em marca d'água no fundo de cada campo */
  showBoardNames: boolean
}

export const DEFAULT_SETTINGS: TableSettings = {
  boardScale: 1,
  handScale: 1,
  previewEnabled: true,
  previewWidth: 272,
  previewSide: 'auto',
  previewDelay: 0,
  autoUntap: false,
  reduceMotion: false,
  showSymbols: true,
  showBoardNames: true,
}

export const BOARD_CARD = { large: 104, small: 60 } as const
export const HAND_CARD = 84

const KEY = 'precon-draft:table-settings'
const OLD_AUTO_UNTAP = 'precon-draft:table-auto-untap' // versão anterior guardava só isto

function load(): TableSettings {
  const saved = readJSON<Partial<TableSettings>>(KEY, {})
  return {
    ...DEFAULT_SETTINGS,
    autoUntap: readJSON<boolean>(OLD_AUTO_UNTAP, false),
    ...saved,
  }
}

let current = load()
const listeners = new Set<() => void>()

export function getTableSettings(): TableSettings {
  return current
}

export function updateTableSettings(patch: Partial<TableSettings>) {
  current = { ...current, ...patch }
  writeJSON(KEY, current)
  listeners.forEach((fn) => fn())
}

export function resetTableSettings() {
  current = { ...DEFAULT_SETTINGS }
  writeJSON(KEY, current)
  writeJSON(OLD_AUTO_UNTAP, false)
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useTableSettings(): TableSettings {
  return useSyncExternalStore(subscribe, getTableSettings, getTableSettings)
}
