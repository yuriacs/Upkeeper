import { DECK_SIZE, type Group, type Problem, type Role } from '../../lib/deckbuilder'

export type T = (s: string, v?: Record<string, string | number>) => string

export const roleLabel = (t: T, r: Role) =>
  ({
    ramp: t('Ramp'),
    draw: t('Card draw'),
    tutor: t('Tutors'),
    removal: t('Removal'),
    board_wipe: t('Board wipes'),
    counterspell: t('Counterspells'),
    protection: t('Protection'),
    recursion: t('Recursion'),
    tokens: t('Token makers'),
    sac_outlet: t('Sacrifice outlets'),
    drain: t('Drain'),
    anthem: t('Anthems'),
    blink: t('Blink'),
    self_mill: t('Self-mill'),
    graveyard_hate: t('Graveyard hate'),
    discard: t('Discard'),
    lifegain: t('Lifegain'),
    land: t('Lands'),
    other: t('Other'),
  })[r]

export const typeGroupLabel = (t: T, g: Group) =>
  ({
    creature: t('Creatures'),
    planeswalker: t('Planeswalkers'),
    instant: t('Instants'),
    sorcery: t('Sorceries'),
    artifact: t('Artifacts'),
    enchantment: t('Enchantments'),
    battle: t('Battles'),
    land: t('Lands'),
    other: t('Other'),
  })[g]

/** Tipos do filtro de cartas (busca e favoritas); "" = todos */
export const CARD_TYPES = ['', 'creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'] as const

export const cardTypeLabel = (t: T, k: string) => (k ? typeGroupLabel(t, k as Group) : t('All types'))

/** O problema do deck (regras de Commander) em uma frase */
export function problemText(t: T, p: Problem): string {
  switch (p.kind) {
    case 'no_commander':
      return t('Choose a commander (search with “Commanders” on, or use the crown on a card).')
    case 'bad_commander':
      return t('{name} can’t be a commander.', { name: p.name })
    case 'bad_pair':
      return t('These two can’t be commanders together (they need Partner, Background or similar).')
    case 'size':
      return p.n < DECK_SIZE
        ? t('{n} of 100 cards: {missing} to go.', { n: p.n, missing: DECK_SIZE - p.n })
        : t('{n} cards: {extra} too many.', { n: p.n, extra: p.n - DECK_SIZE })
    case 'identity':
      return t('Outside the commander’s colors: {names}', { names: p.names.join(', ') })
    case 'copies':
      return t('More copies than allowed (Commander is singleton): {names}', { names: p.names.join(', ') })
    case 'illegal':
      return t('Not legal in Commander: {names}', { names: p.names.join(', ') })
  }
}
