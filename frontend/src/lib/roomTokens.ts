import { readJSON, writeJSON } from './storage'

// Token do jogador em cada sala (identifica este navegador; não precisa de conta)
const KEY = 'precon-draft:rooms'

export function getRoomToken(code: string): string | null {
  return readJSON<Record<string, string>>(KEY, {})[code] ?? null
}

export function setRoomToken(code: string, token: string | null) {
  const all = readJSON<Record<string, string>>(KEY, {})
  if (token) all[code] = token
  else delete all[code]
  writeJSON(KEY, all)
}
