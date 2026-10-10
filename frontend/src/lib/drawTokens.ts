import { readJSON, writeJSON } from './storage'

// Quem cria um sorteio sem conta recebe um token para marcar o vencedor depois.
// Guardamos os mais recentes neste navegador.
const KEY = 'choose-at-random:draws'
const MAX = 50

type Saved = Record<string, { t: string; at: number }>

export function getDrawToken(code: string): string | null {
  return readJSON<Saved>(KEY, {})[code]?.t ?? null
}

export function saveDrawToken(code: string, token: string) {
  const all = readJSON<Saved>(KEY, {})
  all[code] = { t: token, at: Date.now() }
  const keep = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX)
  writeJSON(KEY, Object.fromEntries(keep))
}
