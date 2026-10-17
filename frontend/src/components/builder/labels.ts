import type { Group, Role } from '../../lib/deckbuilder'

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
