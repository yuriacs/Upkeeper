import { readJSON, writeJSON } from './storage'

// Precons marcados sem login (só neste navegador). Ao entrar na conta, vão para o servidor.
const KEY = 'precon-draft:my-decks'
let slugs: string[] = readJSON<string[]>(KEY, [])
const listeners = new Set<() => void>()

export const localDecks = {
  get: () => slugs,
  set(next: string[]) {
    slugs = next
    writeJSON(KEY, next)
    listeners.forEach((l) => l())
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        slugs = readJSON<string[]>(KEY, [])
        listener()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(listener)
      window.removeEventListener('storage', onStorage)
    }
  },
}
