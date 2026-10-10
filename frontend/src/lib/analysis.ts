import type { AnalysisCategoryKey } from './types'

export const CATEGORIES: {
  key: AnalysisCategoryKey
  label: string
  hint: string
  /** Referência comum em decks de Commander (só informativa) */
  typical?: [number, number | null]
}[] = [
  { key: 'ramp', label: 'Ramp', hint: 'Aceleram a mana: pedras de mana, elfos, buscar terrenos.', typical: [10, null] },
  { key: 'fast_mana', label: 'Mana rápida', hint: 'Aceleração muito forte no começo (Sol Ring, Lotus Petal, Mox...).' },
  {
    key: 'draw',
    label: 'Compra de cartas',
    hint: 'Cartas que compram ou geram vantagem de cartas.',
    typical: [10, null],
  },
  { key: 'tutor', label: 'Tutores', hint: 'Buscam uma carta específica no grimório (sem contar busca de terreno).' },
  { key: 'removal', label: 'Remoção pontual', hint: 'Lidam com uma ameaça de cada vez.', typical: [8, null] },
  {
    key: 'board_wipe',
    label: 'Board wipes',
    hint: 'Limpam a mesa (todas as criaturas, artefatos...).',
    typical: [2, 4],
  },
  { key: 'counterspell', label: 'Contramágicas', hint: 'Anulam mágicas dos oponentes.' },
  { key: 'protection', label: 'Proteção', hint: 'Protegem o comandante ou suas permanentes.' },
]

export const FACTOR_LABELS: Record<string, { label: string; unit: (v: number) => string }> = {
  speed: { label: 'Curva de mana', unit: (v) => `média ${v.toFixed(2).replace('.', ',')}` },
  ramp: { label: 'Aceleração', unit: (v) => `${v} ramp + mana rápida` },
  draw: { label: 'Compra de cartas', unit: (v) => `${v} cartas` },
  tutor: { label: 'Tutores', unit: (v) => `${v} cartas` },
  interaction: { label: 'Interação', unit: (v) => `${v} remoções, wipes e contramágicas` },
  protection: { label: 'Proteção', unit: (v) => `${v} cartas` },
  combos: { label: 'Game Changers e combos', unit: (v) => `${v}` },
}

export const fmtPower = (p: number) => p.toFixed(1).replace('.', ',')

export const POWER_FILTERS = [
  { value: '', label: 'Todos os níveis' },
  { value: '0-4', label: 'Casual (até 4)' },
  { value: '4-6', label: 'Casual forte (4 a 6)' },
  { value: '6-', label: 'Focado ou mais (6+)' },
]
