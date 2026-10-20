/*
 * Artes personalizadas das cartas de um deck montado (enviadas pelo dono): a imagem da carta passa
 * a ser a arte, em qualquer lugar que mostre o deck. As artes vêm do backend como {oracle_id: url}.
 */
import type { DeckDetail } from './types'

/** Deck com as imagens das cartas trocadas pelas artes personalizadas */
export function withArts(d: DeckDetail): DeckDetail {
  const arts = d.arts
  if (!arts || !Object.keys(arts).length) return d
  const swap = <T extends { card: DeckDetail['commanders'][number]['card'] }>(dc: T): T => {
    const art = dc.card.oracle_id ? arts[dc.card.oracle_id] : undefined
    return art ? { ...dc, card: { ...dc.card, image_normal: art, image_small: art } } : dc
  }
  return {
    ...d,
    commanders: d.commanders.map(swap),
    sections: d.sections.map((s) => ({ ...s, cards: s.cards.map(swap) })),
  }
}
