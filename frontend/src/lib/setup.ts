import { readJSON, writeJSON } from './storage'
import type { ColorRule, DrawFilters, DrawMode } from './types'

// Última configuração de mesa, para não precisar redigitar os nomes toda vez.
export type TableSetup = {
  mode: DrawMode
  players: number
  names: string[]
  yearFrom: string
  yearTo: string
  edition: string
  colorRule: ColorRule
  sameEdition: boolean
  onlyMine: boolean
  noRepeat: boolean
  /** 0 = qualquer */
  maxBracket: number
  bracketBalance: boolean
}

const KEY = 'precon-draft:setup'

export const DEFAULT_SETUP: TableSetup = {
  mode: 'precon',
  players: 4,
  names: ['', '', '', ''],
  yearFrom: '',
  yearTo: '',
  edition: '',
  colorRule: 'any',
  sameEdition: false,
  onlyMine: false,
  noRepeat: false,
  maxBracket: 0,
  bracketBalance: false,
}

export function loadSetup(): TableSetup {
  const saved = readJSON<Partial<TableSetup>>(KEY, {})
  const setup = { ...DEFAULT_SETUP, ...saved }
  setup.names = [...setup.names, '', '', '', ''].slice(0, 4)
  return setup
}

export function saveSetup(setup: TableSetup) {
  writeJSON(KEY, setup)
}

export function setupToRequest(
  setup: TableSetup,
  mySlugs: string[],
): { names: string[]; filters: DrawFilters; mode: DrawMode } {
  if (setup.mode === 'pool') {
    // A deckpool acontece numa sala: os jogadores entram por conta própria
    return {
      mode: 'pool',
      names: [],
      filters: { ...bracketFilters(setup), color_rule: setup.colorRule, no_repeat: setup.noRepeat },
    }
  }
  const filters: DrawFilters = {
    ...bracketFilters(setup),
    color_rule: setup.colorRule,
    same_edition: setup.sameEdition,
    no_repeat: setup.noRepeat,
  }
  if (setup.yearFrom) filters.year_from = Number(setup.yearFrom)
  if (setup.yearTo) filters.year_to = Number(setup.yearTo)
  if (setup.edition) filters.editions = [setup.edition]
  if (setup.onlyMine) filters.deck_slugs = mySlugs
  return { mode: 'precon', names: setup.names.slice(0, setup.players).map((n) => n.trim()), filters }
}

function bracketFilters(setup: TableSetup): DrawFilters {
  return { max_bracket: setup.maxBracket || null, bracket_balance: setup.bracketBalance }
}
