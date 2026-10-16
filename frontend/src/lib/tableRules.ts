/* Regras da mesa para os decks (bracket máximo, tutores, valor): backend tables/state.py, deck_rules */
import { money } from './money'
import type { DeckSummary, TableRules } from './types'

type T = (s: string, v?: Record<string, string | number>) => string

export const RULE_BRACKETS = [2, 3, 4] as const
export const RULE_TUTORS = [0, 1, 3] as const
export const RULE_PRICES = [100, 300] as const

export const hasRules = (r?: TableRules | null) => !!r && (r.bracket != null || r.tutors != null || r.price != null)

/** Etiquetas curtas: "Bracket até 3", "Até 1 tutor", "Até US$ 100" */
export function ruleChips(t: T, r: TableRules | null | undefined, locale: string): string[] {
  if (!r) return []
  return [
    r.bracket != null ? t('Bracket up to {n}', { n: r.bracket }) : '',
    r.tutors != null ? (r.tutors === 0 ? t('No tutors') : t('Up to {n} tutor(s)', { n: r.tutors })) : '',
    r.price != null ? t('Up to {price}', { price: money(r.price, 'USD', locale, true) ?? '' }) : '',
  ].filter(Boolean)
}

/**
 * Motivo para o deck não servir, pelo que a lista já sabe (bracket e valor). Os tutores só o
 * servidor confere, ao carregar.
 */
export function deckRuleIssue(t: T, r: TableRules | null | undefined, deck: DeckSummary, locale: string): string | null {
  if (!r) return null
  if (r.bracket != null && deck.bracket != null && deck.bracket > r.bracket)
    return t('Bracket {n} (table allows up to {max})', { n: deck.bracket, max: r.bracket })
  if (r.price != null && deck.price_usd != null && Number(deck.price_usd) > r.price)
    return t('{price} (table allows up to {max})', {
      price: money(deck.price_usd, 'USD', locale, true) ?? '',
      max: money(r.price, 'USD', locale, true) ?? '',
    })
  return null
}
