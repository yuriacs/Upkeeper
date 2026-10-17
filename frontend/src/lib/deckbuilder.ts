/*
 * Deckbuilder (página "Montar deck"): busca de cartas no Scryfall, o deck em montagem, as regras de
 * Commander conferidas ao vivo e a lista em texto que vai para a mesma API da importação (backend
 * pools/services/import_deck.py), com a edição exata de cada carta ("1 Sol Ring (C21) 263").
 */
import type { DeckDetail } from './types'
import { readJSON, writeJSON } from './storage'

export type BuilderCard = {
  /** id do Scryfall da edição escolhida */
  id: string
  name: string
  set: string
  number: string
  image: string
  small: string
  typeLine: string
  oracle: string
  manaCost: string
  cmc: number
  /** Identidade de cor ("W", "U", "B", "R", "G") */
  identity: string[]
  priceUsd: number | null
  /** Legal em Commander (null = não sabemos, ex.: carta vinda de um deck salvo) */
  legal: boolean | null
}

export type DeckEntry = { card: BuilderCard; qty: number }
export type BuilderDeck = { name: string; commanders: BuilderCard[]; cards: DeckEntry[] }

export const DECK_SIZE = 100
export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const

// ---- Scryfall ------------------------------------------------------------------------------

type ScryFace = { image_uris?: { normal: string; small: string }; oracle_text?: string; mana_cost?: string; type_line?: string }
type ScryCard = ScryFace & {
  id: string
  name: string
  set: string
  collector_number: string
  cmc?: number
  color_identity?: string[]
  prices?: { usd?: string | null; usd_foil?: string | null }
  legalities?: { commander?: string }
  card_faces?: ScryFace[]
}

export function fromScryfall(c: ScryCard): BuilderCard {
  const front = c.card_faces?.[0]
  const price = c.prices?.usd ?? c.prices?.usd_foil
  return {
    id: c.id,
    name: c.name,
    set: c.set.toUpperCase(),
    number: c.collector_number,
    image: c.image_uris?.normal ?? front?.image_uris?.normal ?? '',
    small: c.image_uris?.small ?? front?.image_uris?.small ?? '',
    typeLine: c.type_line ?? front?.type_line ?? '',
    oracle: c.oracle_text ?? (c.card_faces ?? []).map((f) => f.oracle_text ?? '').join('\n//\n'),
    manaCost: c.mana_cost ?? front?.mana_cost ?? '',
    cmc: c.cmc ?? 0,
    identity: c.color_identity ?? [],
    priceUsd: price ? Number(price) : null,
    legal: c.legalities ? c.legalities.commander === 'legal' : null,
  }
}

export type SearchFilters = {
  text: string
  type: string
  /** "" = qualquer; "0".."6"; "7" = 7 ou mais */
  cmc: string
  /** Só cartas dentro da identidade de cor do comandante */
  inIdentity: boolean
  /** Buscando um comandante (criatura lendária ou "pode ser seu comandante") */
  commander: boolean
}

export type SearchPage = { cards: BuilderCard[]; total: number; next: string | null }

/** Consulta do Scryfall a partir dos filtros: legal em Commander, na ordem de popularidade (EDHREC) */
export function buildQuery(f: SearchFilters, identity: string[]): string {
  const parts = [f.text.trim(), 'legal:commander', 'game:paper']
  if (f.commander) parts.push('is:commander')
  if (f.type) parts.push(`t:${f.type}`)
  if (f.cmc) parts.push(f.cmc === '7' ? 'mv>=7' : `mv=${f.cmc}`)
  if (f.inIdentity && !f.commander && identity.length) parts.push(`id<=${identity.join('').toLowerCase()}`)
  else if (f.inIdentity && !f.commander && identity.length === 0) parts.push('id<=c')
  return parts.filter(Boolean).join(' ')
}

export async function searchCards(query: string, signal?: AbortSignal, next?: string | null): Promise<SearchPage> {
  const url = next ?? `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards`
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal })
  if (r.status === 404) return { cards: [], total: 0, next: null } // nada encontrado
  if (!r.ok) throw new Error(`Scryfall ${r.status}`)
  const d: { data?: ScryCard[]; total_cards?: number; has_more?: boolean; next_page?: string } = await r.json()
  return {
    cards: (d.data ?? []).map(fromScryfall).filter((c) => c.image),
    total: d.total_cards ?? 0,
    next: d.has_more ? (d.next_page ?? null) : null,
  }
}

// ---- deck salvo → deckbuilder ----------------------------------------------------------------

/** Deck da pool (API) para o formato do deckbuilder, com a mesma edição de cada carta */
export function fromSavedDeck(d: DeckDetail): BuilderDeck {
  const conv = (c: DeckDetail['commanders'][number]['card']): BuilderCard => ({
    id: c.scryfall_id,
    name: c.name,
    set: c.set_code,
    number: c.collector_number,
    image: c.image_normal,
    small: c.image_small || c.image_normal,
    typeLine: c.type_line,
    oracle: c.oracle_text,
    manaCost: c.mana_cost,
    cmc: Number(c.cmc) || 0,
    identity: c.color_identity.split('').filter((x) => 'WUBRG'.includes(x)),
    priceUsd: c.price_usd ? Number(c.price_usd) : null,
    legal: null,
  })
  return {
    name: d.name,
    commanders: d.commanders.map((dc) => conv(dc.card)),
    cards: d.sections.flatMap((s) => s.cards.map((dc) => ({ card: conv(dc.card), qty: dc.quantity }))),
  }
}

// ---- regras de Commander ---------------------------------------------------------------------

const isBasic = (c: BuilderCard) => /\bBasic\b/.test(c.typeLine)
/** "Relentless Rats", "Persistent Petitioners"...: o texto permite quantas cópias quiser */
const anyNumber = (c: BuilderCard) => /any number of cards named/i.test(c.oracle)
export const maxCopies = (c: BuilderCard) => (isBasic(c) || anyNumber(c) ? 99 : /up to (\w+) cards named/i.test(c.oracle) ? 9 : 1)

/** Pode ser comandante: criatura lendária, "can be your commander" ou Background */
export function canCommand(c: BuilderCard): boolean {
  const front = c.typeLine.split(' // ')[0]
  return (/Legendary/.test(front) && /Creature/.test(front)) || /can be your commander/i.test(c.oracle) || /Background/.test(front)
}

/** Dois comandantes juntos: Partner, "Partner with", Friends forever, Background, Doctor's companion */
export function canPair(a: BuilderCard, b: BuilderCard): boolean {
  const partner = (c: BuilderCard) => /\bPartner\b(?! with)/.test(c.oracle)
  const partnerWith = (c: BuilderCard, other: BuilderCard) => c.oracle.includes(`Partner with ${other.name.split(' // ')[0]}`)
  const friends = (c: BuilderCard) => /Friends forever/.test(c.oracle)
  const background = (c: BuilderCard) => /Background/.test(c.typeLine)
  const choosesBackground = (c: BuilderCard) => /Choose a Background/.test(c.oracle)
  const doctor = (c: BuilderCard) => /Time Lord Doctor/.test(c.typeLine)
  const companion = (c: BuilderCard) => /Doctor's companion/.test(c.oracle)
  return (
    (partner(a) && partner(b)) ||
    partnerWith(a, b) ||
    partnerWith(b, a) ||
    (friends(a) && friends(b)) ||
    (choosesBackground(a) && background(b)) ||
    (choosesBackground(b) && background(a)) ||
    (doctor(a) && companion(b)) ||
    (doctor(b) && companion(a))
  )
}

export const deckIdentity = (d: BuilderDeck) => COLORS.filter((x) => d.commanders.some((c) => c.identity.includes(x)))
export const deckCount = (d: BuilderDeck) => d.commanders.length + d.cards.reduce((n, e) => n + e.qty, 0)

export type Problem =
  | { kind: 'size'; n: number }
  | { kind: 'no_commander' }
  | { kind: 'bad_commander'; name: string }
  | { kind: 'bad_pair' }
  | { kind: 'identity'; names: string[] }
  | { kind: 'copies'; names: string[] }
  | { kind: 'illegal'; names: string[] }

/** O que impede (ou deve chamar a atenção) num deck de Commander */
export function problems(d: BuilderDeck): Problem[] {
  const out: Problem[] = []
  if (!d.commanders.length) out.push({ kind: 'no_commander' })
  for (const c of d.commanders) if (!canCommand(c)) out.push({ kind: 'bad_commander', name: c.name })
  if (d.commanders.length === 2 && !canPair(d.commanders[0], d.commanders[1])) out.push({ kind: 'bad_pair' })
  const n = deckCount(d)
  if (n !== DECK_SIZE) out.push({ kind: 'size', n })
  const identity = deckIdentity(d)
  if (d.commanders.length) {
    const outside = d.cards.filter((e) => e.card.identity.some((x) => !identity.includes(x as (typeof COLORS)[number])))
    if (outside.length) out.push({ kind: 'identity', names: outside.map((e) => e.card.name) })
  }
  const byName = new Map<string, number>()
  for (const e of d.cards) byName.set(e.card.name, (byName.get(e.card.name) ?? 0) + e.qty)
  const extra = d.cards.filter((e) => (byName.get(e.card.name) ?? 0) > maxCopies(e.card))
  if (extra.length) out.push({ kind: 'copies', names: [...new Set(extra.map((e) => e.card.name))] })
  const illegal = [...d.commanders, ...d.cards.map((e) => e.card)].filter((c) => c.legal === false)
  if (illegal.length) out.push({ kind: 'illegal', names: illegal.map((c) => c.name) })
  return out
}

// ---- grupos, curva, valor ---------------------------------------------------------------------

export const GROUPS = ['creature', 'planeswalker', 'instant', 'sorcery', 'artifact', 'enchantment', 'battle', 'land', 'other'] as const
export type Group = (typeof GROUPS)[number]

/** Grupo de exibição pelo tipo principal (como no catálogo: terreno ganha de criatura) */
export function groupOf(c: BuilderCard): Group {
  const front = c.typeLine.split(' // ')[0]
  if (/\bLand\b/.test(front)) return 'land'
  if (/\bCreature\b/.test(front)) return 'creature'
  for (const g of ['planeswalker', 'instant', 'sorcery', 'artifact', 'enchantment', 'battle'] as const)
    if (new RegExp(`\\b${g}\\b`, 'i').test(front)) return g
  return 'other'
}

/** Curva de mana (sem terrenos): quantas cartas por valor de mana, de 0 a 7+ */
export function curve(d: BuilderDeck): number[] {
  const out = Array(8).fill(0)
  for (const e of d.cards) if (groupOf(e.card) !== 'land') out[Math.min(7, Math.floor(e.card.cmc))] += e.qty
  return out
}

export const deckPrice = (d: BuilderDeck) =>
  [...d.commanders.map((c) => ({ card: c, qty: 1 })), ...d.cards].reduce((n, e) => n + (e.card.priceUsd ?? 0) * e.qty, 0)

// ---- texto (salvar e exportar) ----------------------------------------------------------------

const line = (qty: number, c: BuilderCard) => `${qty} ${c.name}${c.set && c.number ? ` (${c.set}) ${c.number}` : ''}`

/** Lista no formato que a importação entende: comandantes, linha em branco, o resto */
export function toDecklist(d: BuilderDeck): string {
  return [...d.commanders.map((c) => line(1, c)), '', ...d.cards.map((e) => line(e.qty, e.card))].join('\n')
}

// ---- rascunho no navegador ------------------------------------------------------------------

const draftKey = (id?: string) => `precon-draft:builder:${id ?? 'new'}`
export const loadDraft = (id?: string) => readJSON<BuilderDeck | null>(draftKey(id), null)
export const saveDraft = (d: BuilderDeck, id?: string) => writeJSON(draftKey(id), d)
export const clearDraft = (id?: string) => writeJSON(draftKey(id), null)
