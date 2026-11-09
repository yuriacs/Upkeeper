/*
 * Artes personalizadas das cartas de um deck montado (enviadas pelo dono): a imagem da carta passa
 * a ser a arte, em qualquer lugar que mostre o deck. As artes vêm do backend como {oracle_id: url}.
 */
import type { BuilderCard } from './deckbuilder'
import type { DeckDetail } from './types'

/** Deck com as imagens das cartas trocadas pelas artes personalizadas (e o verso, nas de duas faces) */
export function withArts(d: DeckDetail): DeckDetail {
  const arts = d.arts ?? {}
  const backs = d.back_arts ?? {}
  if (!Object.keys(arts).length && !Object.keys(backs).length) return d
  const swap = <T extends { card: DeckDetail['commanders'][number]['card'] }>(dc: T): T => {
    const art = dc.card.oracle_id ? arts[dc.card.oracle_id] : undefined
    const back = dc.card.oracle_id && dc.card.image_back ? backs[dc.card.oracle_id] : undefined
    if (!art && !back) return dc
    return {
      ...dc,
      card: { ...dc.card, ...(art ? { image_normal: art, image_small: art } : {}), ...(back ? { image_back: back } : {}) },
    }
  }
  return {
    ...d,
    commanders: d.commanders.map(swap),
    sections: d.sections.map((s) => ({ ...s, cards: s.cards.map(swap) })),
  }
}

/** Carta do deckbuilder com as artes personalizadas no lugar das imagens (frente e verso, se tiver) */
export function withArt(c: BuilderCard, arts?: Record<string, string>, backArts?: Record<string, string>): BuilderCard {
  const art = c.oracleId ? arts?.[c.oracleId] : undefined
  const backArt = c.oracleId && c.back ? backArts?.[c.oracleId] : undefined
  if (!art && !backArt) return c
  return { ...c, ...(art ? { image: art, small: art } : {}), ...(backArt ? { back: backArt } : {}) }
}
