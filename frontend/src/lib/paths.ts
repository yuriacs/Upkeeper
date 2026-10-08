import type { DeckSummary } from './types'

export const deckPath = (deck: Pick<DeckSummary, 'kind' | 'slug'>) =>
  deck.kind === 'user' ? `/deck-usuario/${deck.slug}` : `/deck/${deck.slug}`
