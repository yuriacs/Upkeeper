import { readJSON, writeJSON } from './storage'

// Código do último sorteio feito neste navegador (aparece na página inicial)
const KEY = 'choose-at-random:last-deal'

export const getLastDeal = (): string | null => readJSON<string | null>(KEY, null)
export const setLastDeal = (code: string) => writeJSON(KEY, code)
