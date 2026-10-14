import { useState } from 'react'
import type { TableCard } from '../../hooks/useTableSocket'

/** Tipos de carta do filtro das zonas (na ordem em que aparecem), com o texto do botão */
export const CARD_TYPES = [
  ['creature', 'Creatures'],
  ['artifact', 'Artifacts'],
  ['enchantment', 'Enchantments'],
  ['planeswalker', 'Planeswalkers'],
  ['instant', 'Instants'],
  ['sorcery', 'Sorceries'],
  ['land', 'Lands'],
  ['battle', 'Battles'],
] as const

/**
 * Filtro por tipo (criatura, artefato...) de uma lista de cartas: só os tipos que aparecem nela.
 * Mesas antigas não mandam o tipo das cartas e ficam sem filtro (`chips` vazio).
 */
export function useTypeFilter<C extends TableCard>(all: C[]) {
  const [only, setOnly] = useState<string | null>(null)
  const count = new Map<string, number>()
  for (const c of all) for (const ty of c.types ?? []) count.set(ty, (count.get(ty) ?? 0) + 1)
  const filter = only && count.has(only) ? only : null
  return {
    cards: filter ? all.filter((c) => c.types?.includes(filter)) : all,
    chips: CARD_TYPES.filter(([key]) => count.has(key)).map(([key, label]) => ({ key, label, n: count.get(key)! })),
    total: all.length,
    filter,
    setOnly,
  }
}
