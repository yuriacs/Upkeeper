import type { AnalysisCategoryKey } from './types'

// Textos em inglês: traduzidos com t() na renderização
export const CATEGORIES: {
  key: AnalysisCategoryKey
  label: string
  hint: string
  /** Referência comum em decks de Commander (só informativa) */
  typical?: [number, number | null]
}[] = [
  { key: 'ramp', label: 'Ramp', hint: 'Speed up your mana: mana rocks, elves, land search.', typical: [10, null] },
  { key: 'fast_mana', label: 'Fast mana', hint: 'Very strong early acceleration (Sol Ring, Lotus Petal, Mox...).' },
  {
    key: 'draw',
    label: 'Card draw',
    hint: 'Cards that draw or generate card advantage.',
    typical: [10, null],
  },
  { key: 'tutor', label: 'Tutors', hint: 'Search your library for a specific card (not counting land search).' },
  { key: 'removal', label: 'Spot removal', hint: 'Deal with one threat at a time.', typical: [8, null] },
  {
    key: 'board_wipe',
    label: 'Board wipes',
    hint: 'Clear the board (all creatures, artifacts...).',
    typical: [2, 4],
  },
  { key: 'counterspell', label: 'Counterspells', hint: "Counter your opponents' spells." },
  { key: 'protection', label: 'Protection', hint: 'Protect your commander or your permanents.' },
]

/** `unit` é um modelo em inglês com {n}: formate com t(unit, { n }) no componente. */
export const FACTOR_LABELS: Record<string, { label: string; unit: string }> = {
  speed: { label: 'Mana curve', unit: 'avg {n}' },
  ramp: { label: 'Acceleration', unit: '{n} ramp + fast mana' },
  draw: { label: 'Card draw', unit: '{n} cards' },
  tutor: { label: 'Tutors', unit: '{n} cards' },
  interaction: { label: 'Interaction', unit: '{n} removal, wipes and counterspells' },
  protection: { label: 'Protection', unit: '{n} cards' },
  combos: { label: 'Game Changers and combos', unit: '{n}' },
}

/** Nível de poder com 1 casa decimal no formato do idioma (4.6 / 4,6). */
export const fmtPower = (p: number, locale: string) =>
  p.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Número com 2 casas decimais no formato do idioma (2.40 / 2,40). */
export const fmtDecimal2 = (v: number, locale: string) =>
  v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const POWER_FILTERS = [
  { value: '', label: 'All power levels' },
  { value: '0-4', label: 'Casual (up to 4)' },
  { value: '4-6', label: 'Upper casual (4 to 6)' },
  { value: '6-', label: 'Focused or higher (6+)' },
]
