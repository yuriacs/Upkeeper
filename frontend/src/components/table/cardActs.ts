/*
 * Atalhos de carta (backend: tables/card_actions.py). O servidor lê o texto oficial e manda, em
 * cada carta, a lista do que dá para fazer com um clique; aqui ficam o texto dos botões e a busca
 * da imagem da ficha no Scryfall.
 */
import type { TableCard } from '../../hooks/useTableSocket'

type Cost = { sac?: boolean; life?: number; tap?: boolean }
export type CardAct = Cost &
  (
    | {
        k: 'search'
        n: number
        upto?: boolean
        basic?: boolean
        sub?: string[]
        types?: string[]
        /** Para onde vai cada carta escolhida (a última vale para as que sobrarem) */
        to: ('field' | 'field_tapped' | 'hand' | 'top')[]
        noshuffle?: boolean
      }
    /** n = 0: a quantidade depende do jogo (X, "for each..."), o jogador diz quantas */
    | { k: 'tokens'; n: number; name: string; p?: string; t?: string; c?: string; tapped?: boolean }
    | { k: 'counters'; n: number; other?: boolean }
    | { k: 'draw' | 'mill' | 'scry' | 'surveil' | 'gain'; n: number }
    | { k: 'drain'; n: number; gain?: number; gain_lost?: boolean }
    | { k: 'wipe'; to: 'graveyard' | 'exile'; what: string[]; other?: boolean }
  )

type T = (s: string, v?: Record<string, string | number>) => string

const dest = (t: T, to: string) =>
  ({
    field: t('onto the battlefield'),
    field_tapped: t('onto the battlefield tapped'),
    hand: t('into your hand'),
    top: t('on top of your library'),
  })[to] ?? to

/** O que a busca procura: "basic land", "Forest or Plains", "creature", "card" */
export function searchWhat(t: T, act: Extract<CardAct, { k: 'search' }>): string {
  if (act.sub?.length) return act.sub.join(' / ')
  if (act.basic) return t('basic land')
  if (act.types?.length) return act.types.map((k) => typeName(t, k)).join(' / ')
  return t('card')
}

const typeName = (t: T, k: string) =>
  ({
    land: t('land'),
    creature: t('creature'),
    artifact: t('artifact'),
    enchantment: t('enchantment'),
    instant: t('instant'),
    sorcery: t('sorcery'),
    planeswalker: t('planeswalker'),
    nonland: t('nonland permanent'),
  })[k] ?? k

/** Texto do botão: o que acontece ao clicar */
export function actLabel(t: T, act: CardAct): string {
  switch (act.k) {
    case 'search': {
      const n = act.upto ? t('up to {n}', { n: act.n }) : String(act.n)
      const where =
        act.to.length > 1
          ? t('1 onto the battlefield tapped, 1 into your hand')
          : dest(t, act.to[0])
      return t('Search {n} {what}, put {where}', { n, what: searchWhat(t, act), where })
    }
    case 'tokens': {
      const what = act.p ? `${act.p}/${act.t} ${act.name}` : act.name
      return act.n ? t('Create {n} {what} token(s)', { n: act.n, what }) : t('Create X {what} tokens', { what })
    }
    case 'counters':
      return act.other
        ? t('{n} +1/+1 counter(s) on each other creature you control', { n: act.n })
        : t('{n} +1/+1 counter(s) on each creature you control', { n: act.n })
    case 'draw':
      return t('Draw {n} card(s)', { n: act.n })
    case 'mill':
      return t('Mill {n} card(s)', { n: act.n })
    case 'scry':
      return t('Scry {n}', { n: act.n })
    case 'surveil':
      return t('Surveil {n}', { n: act.n })
    case 'gain':
      return t('Gain {n} life', { n: act.n })
    case 'drain':
      return act.gain_lost
        ? t('Each opponent loses {n} life, you gain what they lost', { n: act.n })
        : act.gain
          ? t('Each opponent loses {n} life, you gain {g}', { n: act.n, g: act.gain })
          : t('Each opponent loses {n} life', { n: act.n })
    case 'wipe': {
      const what = act.what.map((k) => typeName(t, k)).join(' / ')
      if (act.to === 'exile') return act.other ? t('Exile all other: {what}', { what }) : t('Exile all: {what}', { what })
      return act.other ? t('Destroy all other: {what}', { what }) : t('Destroy all: {what}', { what })
    }
  }
}

/** Custo que vem junto ("sacrifica", "paga 1 de vida", "vira") */
export function costLabel(t: T, act: CardAct): string {
  return [
    act.tap && !act.sac ? t('tap') : '',
    act.life ? t('pay {n} life', { n: act.life }) : '',
    act.sac ? t('sacrifice') : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Mágicas usam o atalho da mão; permanentes, do campo */
export const isSpell = (card: TableCard) => !!card.types?.some((k) => k === 'instant' || k === 'sorcery')

/** Atinge outros jogadores (pede confirmação): destruir tudo e drenar */
export const affectsOthers = (act: CardAct) => act.k === 'wipe' || act.k === 'drain'

type ScryFace = { name: string; oracle_id?: string; image_uris?: { normal: string } }
type ScryToken = ScryFace & { card_faces?: ScryFace[] }
/** Ficha achada: a imagem e qual ficha é (para a arte personalizada do jogador) */
export type FoundToken = { image: string; oracleId?: string }

/**
 * Imagem da face com esse nome. A busca pelo nome exato também traz fichas de duas faces
 * ("Dinosaur // Treasure"): a imagem tem que ser a da face "Treasure", não a da primeira.
 */
function faceImage(c: ScryToken, name: string): FoundToken | null {
  if (c.name === name && c.image_uris) return { image: c.image_uris.normal, oracleId: c.oracle_id }
  const face = c.card_faces?.find((f) => f.name === name)
  const image = face?.image_uris?.normal ?? (c.name === name ? (c.card_faces?.[0]?.image_uris?.normal ?? null) : null)
  return image ? { image, oracleId: face?.oracle_id ?? c.oracle_id } : null
}

/** Imagem de uma ficha com esse nome (e, se der, a mesma força/resistência e cor) no Scryfall */
export async function findTokenImage(act: Extract<CardAct, { k: 'tokens' }>): Promise<FoundToken | null> {
  const name = `!"${act.name}"`
  const pt = act.p ? ` pow=${act.p} tou=${act.t}` : ''
  const color = act.c ? ` c=${act.c === 'c' ? 'c' : act.c}` : ''
  for (const q of [`t:token ${name}${pt}${color}`, `t:token ${name}${pt}`, `t:token ${name}`]) {
    try {
      const r = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=art`, {
        headers: { Accept: 'application/json' },
      })
      if (!r.ok) continue
      const data: { data?: ScryToken[] } = await r.json()
      const cards = data.data ?? []
      // Fichas de uma face só primeiro; as de duas faces só se não houver outra
      const single = cards.find((c) => c.name === act.name && c.image_uris)
      if (single?.image_uris) return { image: single.image_uris.normal, oracleId: single.oracle_id }
      for (const c of cards) {
        const found = faceImage(c, act.name)
        if (found) return found
      }
    } catch {
      return null
    }
  }
  return null
}
