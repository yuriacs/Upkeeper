/* Estilos de jogo da mesa (janela "Nova mesa", lista de mesas e o painel da mesa) */
import type { Playstyle } from './types'

type T = (s: string, v?: Record<string, string | number>) => string

export const PLAYSTYLES: Playstyle[] = ['beginner', 'janky', 'relaxed', 'optimized', 'competitive']

export const playstyleLabel = (t: T, s: Playstyle) =>
  ({
    beginner: t('Beginner'),
    janky: t('Janky'),
    relaxed: t('Relaxed'),
    optimized: t('Optimized'),
    competitive: t('Competitive'),
  })[s]

export const playstyleText = (t: T, s: Playstyle) =>
  ({
    beginner: t('New to Magic or to online tables. Easy pace: questions are welcome and mistakes get a pass.'),
    janky: t('Odd decks and wild combos. Doing something fun matters more than winning.'),
    relaxed: t('Casual games with decks that work, at a calm pace.'),
    optimized: t('Strong decks and focused play, without going all out.'),
    competitive: t('The strongest decks and tight play, cEDH style.'),
  })[s]
