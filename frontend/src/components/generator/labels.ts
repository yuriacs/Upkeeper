/* Rótulos e estilos do gerador de decks usados em mais de um componente */
import { COLORS } from '../../lib/deckbuilder'
import { COLOR_SLUGS } from '../../lib/edhrec'
import type { Lane, StepKey } from '../../lib/generator'

export type T = (s: string, v?: Record<string, string | number>) => string

/** Nome da combinação de cores ("Rakdos", "Esper"); vazio para uma cor só */
export function colorComboName(colors: string[]): string {
  const slug = COLOR_SLUGS[COLORS.filter((c) => colors.includes(c)).join('')] ?? ''
  if (!slug || slug.startsWith('mono') || slug === 'colorless') return ''
  return slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-')
}

export function laneLabel(t: T, lane: Lane) {
  return { describe: t('Describe your deck'), guide: t('Guide me'), commander: t('I have a commander'), collection: t('Use my cards') }[lane]
}

export function stepLabel(t: T, s: StepKey) {
  return {
    start: t('Start'),
    describe: t('Description'),
    colors: t('Colors'),
    commander: t('Commander'),
    themes: t('Themes'),
    budget: t('Budget'),
    power: t('Power'),
    details: t('Details'),
    review: t('Review'),
  }[s]
}

export const chipClass = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-semibold transition ${
    on ? 'border-gold bg-gold/15 text-gold' : 'border-line text-parchment/60 hover:text-parchment'
  }`
