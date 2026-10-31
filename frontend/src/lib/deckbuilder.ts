/*
 * Deckbuilder (página "Montar deck"): busca de cartas no Scryfall, o deck em montagem, as regras de
 * Commander conferidas ao vivo e a lista em texto que vai para a mesma API da importação (backend
 * pools/services/import_deck.py), com a edição exata de cada carta ("1 Sol Ring (C21) 263").
 */
import type { Card, DeckDetail } from './types'
import { readJSON, writeJSON } from './storage'

export type BuilderCard = {
  /** id do Scryfall da edição escolhida */
  id: string
  /** id do Scryfall da carta (qualquer edição): a função dela (ramp, compra...) vem por ele */
  oracleId: string
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
  /** Nome da edição ("Commander 2021"), para a escolha da edição */
  setName?: string
  /** Game Changer da lista oficial de brackets (vem do Scryfall; ausente em carta de deck salvo) */
  gameChanger?: boolean
}

/** `category`: categoria escolhida à mão (vale mais que a função automática); vai para o texto como [Ramp] */
export type DeckEntry = { card: BuilderCard; qty: number; category?: string }
/** `maybe`: cartas em consideração (maybeboard), fora das 100 */
export type BuilderDeck = { name: string; commanders: BuilderCard[]; cards: DeckEntry[]; maybe: DeckEntry[] }

export const DECK_SIZE = 100
export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const

// ---- Scryfall ------------------------------------------------------------------------------

type ScryFace = {
  image_uris?: { normal: string; small: string }
  oracle_text?: string
  mana_cost?: string
  type_line?: string
  oracle_id?: string
}
type ScryCard = ScryFace & {
  id: string
  oracle_id?: string
  name: string
  set: string
  set_name?: string
  collector_number: string
  cmc?: number
  color_identity?: string[]
  prices?: { usd?: string | null; usd_foil?: string | null }
  legalities?: { commander?: string }
  card_faces?: ScryFace[]
  game_changer?: boolean
}

export function fromScryfall(c: ScryCard): BuilderCard {
  const front = c.card_faces?.[0]
  const price = c.prices?.usd ?? c.prices?.usd_foil
  return {
    id: c.id,
    oracleId: c.oracle_id ?? front?.oracle_id ?? '',
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
    setName: c.set_name,
    ...(c.game_changer ? { gameChanger: true } : {}),
  }
}

/** Onde procurar o texto digitado: no nome, no texto de regras ou na linha de tipo */
export type SearchField = 'name' | 'text' | 'type'

export type SearchFilters = {
  text: string
  field: SearchField
  type: string
  /** "" = qualquer; "0".."6"; "7" = 7 ou mais */
  cmc: string
  /** Só cartas dentro da identidade de cor do comandante */
  inIdentity: boolean
  /** Buscando um comandante (criatura lendária ou "pode ser seu comandante") */
  commander: boolean
  /** Cores marcadas (W, U, B, R, G e C = incolor): comandantes com essa identidade exata; cartas de qualquer uma delas */
  colors: string[]
}

export type SearchPage = { cards: BuilderCard[]; total: number; next: string | null }

/**
 * As edições em phyrexiano (Jace, the Perfected Mind de ONE, por exemplo) às vezes são as mais
 * baratas, mas o texto delas não dá para ler: ficam de fora de toda busca "pela mais barata".
 */
export const NO_PHYREXIAN = '-lang:ph'

/**
 * Consulta do Scryfall a partir dos filtros: legal em Commander, na ordem de popularidade (EDHREC).
 * Quem procura pelo nome acha também as cartas fora do formato (playtest como Blor the Impervious,
 * Un-sets, banidas): elas aparecem com um aviso, e o deck lembra que não são legais.
 */
export function buildQuery(f: SearchFilters, identity: string[]): string {
  const byName = f.field === 'name' && !!f.text.trim() && !/[:<>=]/.test(f.text)
  const parts = [textQuery(f.text, f.field), byName ? '' : 'legal:commander', 'game:paper']
  if (f.commander) parts.push('is:commander')
  if (f.type) parts.push(`t:${f.type}`)
  if (f.cmc) parts.push(f.cmc === '7' ? 'mv>=7' : `mv=${f.cmc}`)
  if (f.colors.length) parts.push(colorQuery(f.colors, f.commander))
  // Só vale com o comandante escolhido (sem ele, não há cores para limitar)
  if (f.inIdentity && !f.commander && identity.length) parts.push(`id<=${identity.join('').toLowerCase()}`)
  // Edição mais barata de cada carta (o preço mostrado é o que entra no valor do deck), a não ser
  // que quem busca já tenha escolhido outra com a sintaxe do Scryfall
  if (!/\bprefer:/i.test(f.text)) parts.push('prefer:usd-low')
  // Sem as edições em phyrexiano (texto ilegível), a não ser que quem busca peça um idioma
  if (!/\blang:/i.test(f.text)) parts.push(NO_PHYREXIAN)
  return parts.filter(Boolean).join(' ')
}

/**
 * O texto digitado no campo escolhido: nome ("name:draw" acha Drawn from Dreams), texto de regras
 * (o:"draw a card") ou tipo (t:dragon). Quem já escreve a sintaxe do Scryfall (tem ":", "<", ">"
 * ou "=") manda a consulta como está.
 */
export function textQuery(text: string, field: SearchField): string {
  const q = text.trim()
  if (!q || /[:<>=]/.test(q)) return q
  const quoted = (s: string) => (/\s/.test(s) ? `"${s.replace(/"/g, '')}"` : s.replace(/"/g, ''))
  if (field === 'text') return `o:${quoted(q)}`
  if (field === 'type') return q.split(/\s+/).map((w) => `t:${quoted(w)}`).join(' ')
  return `name:${quoted(q)}`
}

/**
 * Filtro de cores. Comandantes: identidade exatamente essas cores ("id=wubg"; só incolor: "id=c").
 * Cartas: de qualquer uma das cores marcadas ("(c:w or c:g)"; incolor: "c:c").
 */
export function colorQuery(colors: string[], commander: boolean): string {
  const real = colors.filter((c) => c !== 'C').map((c) => c.toLowerCase())
  const colorless = colors.includes('C')
  if (commander) return real.length ? `id=${real.join('')}` : 'id=c'
  const each = [...real.map((c) => `c:${c}`), ...(colorless ? ['c:c'] : [])]
  return each.length === 1 ? each[0] : `(${each.join(' or ')})`
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

/**
 * Cartas pelo oracle id (qualquer edição), na edição mais barata de cada uma: buscas de 20 por vez
 * no Scryfall ("oracleid:… or oracleid:…"), uma depois da outra.
 */
export async function fetchByOracle(ids: string[], signal?: AbortSignal): Promise<BuilderCard[]> {
  const out: BuilderCard[] = []
  for (let i = 0; i < ids.length; i += 20) {
    const q = `(${ids.slice(i, i + 20).map((id) => `oracleid:${id}`).join(' or ')}) prefer:usd-low ${NO_PHYREXIAN}`
    let page: SearchPage | null = await searchCards(q, signal).catch(() => null)
    while (page) {
      out.push(...page.cards)
      page = page.next ? await searchCards(q, signal, page.next).catch(() => null) : null
    }
    if (i + 20 < ids.length) await new Promise((r) => setTimeout(r, 300))
  }
  return out
}

/**
 * Todas as edições em inglês de uma carta, da mais barata para a mais cara; as sem preço no fim.
 * Sol Ring tem mais de 130: no máximo 4 páginas do Scryfall (175 cada).
 */
export async function fetchPrints(oracleId: string, signal?: AbortSignal): Promise<BuilderCard[]> {
  // Com unique=prints o Scryfall traz todos os idiomas: só as em inglês
  const q = `oracleid:${oracleId} game:paper lang:en`
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=usd&dir=asc`
  const out: BuilderCard[] = []
  let page: SearchPage | null = await searchCards('', signal, url)
  for (let n = 1; page; n++) {
    out.push(...page.cards)
    page = page.next && n < 4 ? await searchCards('', signal, page.next) : null
  }
  // O preço mostrado é o normal ou, sem ele, o foil: a ordem do Scryfall só olha o normal
  return out.sort((a, b) => (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity))
}

/** Uma carta pelo nome (aproximado, como "sol rng"): para adicionar rápido digitando; null se não achar */
export async function findByName(name: string): Promise<BuilderCard | null> {
  const r = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`, {
    headers: { Accept: 'application/json' },
  })
  if (!r.ok) return null
  const c = fromScryfall(await r.json())
  if (!c.image) return null
  // A mesma carta na edição mais barata (se a busca falhar, fica a edição que veio)
  if (c.oracleId) {
    const cheap = await searchCards(`oracleid:${c.oracleId} prefer:usd-low ${NO_PHYREXIAN}`).catch(() => null)
    if (cheap?.cards[0]) return cheap.cards[0]
  }
  return c
}

// ---- deck salvo → deckbuilder ----------------------------------------------------------------

/** Uma linha da lista em texto: quantidade, nome, edição e a categoria entre colchetes */
export type TextLine = { qty: number; name: string; set: string; number: string; category: string }
const TEXT_LINE = /^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([^\s[*^]+))?)?(?:\s*\*[A-Za-z]+\*)*(?:\s*\[([^\]]*)\])?(?:\s*\^[^^]*\^)*\s*$/
const MAYBE_SECTION = /^(maybeboard|considering)\s*:?\s*(\(\d+\))?$/i
const OTHER_SECTION = /^(commanders?|comandantes?|companion|deck|main(board)?|sideboard|tokens?)\s*:?\s*(\(\d+\))?$/i

/** Lê a lista salva: categoria escolhida de cada carta (pelo nome) e as cartas do maybeboard */
export function readDecklistText(text: string): { categories: Map<string, string>; maybe: TextLine[] } {
  const categories = new Map<string, string>()
  const maybe: TextLine[] = []
  let inMaybe = false
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('#')) continue
    if (MAYBE_SECTION.test(line)) {
      inMaybe = true
      continue
    }
    if (OTHER_SECTION.test(line)) {
      inMaybe = false
      continue
    }
    const m = TEXT_LINE.exec(line)
    if (!m) continue
    const cats = (m[5] ?? '').split(',').map((c) => c.replace(/\{[^}]*\}/g, '').trim()).filter(Boolean)
    const entry = { qty: Number(m[1] ?? 1), name: m[2].trim(), set: m[3] ?? '', number: m[4] ?? '', category: cats[0] ?? '' }
    if (inMaybe || cats.some((c) => /^(maybeboard|considering)$/i.test(c))) maybe.push(entry)
    else if (entry.category && !/^commander$/i.test(entry.category)) categories.set(entry.name, entry.category)
  }
  return { categories, maybe }
}

/** Carta do nosso banco (API) no formato do deckbuilder, na mesma edição */
export const fromApiCard = (c: Card): BuilderCard => ({
  id: c.scryfall_id,
  oracleId: c.oracle_id ?? '',
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

/** Deck da pool (API) para o formato do deckbuilder, com a mesma edição de cada carta */
export function fromSavedDeck(d: DeckDetail): BuilderDeck {
  const conv = fromApiCard
  const { categories } = readDecklistText(d.decklist_text ?? '')
  return {
    name: d.name,
    commanders: d.commanders.map((dc) => conv(dc.card)),
    cards: d.sections.flatMap((s) =>
      s.cards.map((dc) => {
        const category = categoryKey(categories.get(dc.card.name) ?? '')
        return { card: conv(dc.card), qty: dc.quantity, ...(category ? { category } : {}) }
      }),
    ),
    maybe: [],
  }
}

/** Cartas do maybeboard salvo (só o texto): busca no Scryfall, pela edição ou pelo nome */
export async function fetchMaybe(lines: TextLine[]): Promise<DeckEntry[]> {
  const out: DeckEntry[] = []
  for (let i = 0; i < lines.length; i += 75) {
    const batch = lines.slice(i, i + 75)
    const r = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        identifiers: batch.map((l) => (l.set && l.number ? { set: l.set.toLowerCase(), collector_number: l.number } : { name: l.name })),
      }),
    })
    if (!r.ok) continue
    const d: { data?: ScryCard[] } = await r.json()
    for (const c of d.data ?? []) {
      const card = fromScryfall(c)
      const line = batch.find((l) => l.name === card.name || (l.set === card.set && l.number === card.number))
      const category = categoryKey(line?.category ?? '')
      out.push({ card, qty: line?.qty ?? 1, ...(category ? { category } : {}) })
    }
  }
  return out
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

// ---- função das cartas (ramp, compra, remoção...) ---------------------------------------------

/** Categorias por função, na ordem de exibição (como os "Categories" do Archidekt) */
export const ROLES = [
  'ramp', 'draw', 'tutor', 'removal', 'board_wipe', 'counterspell', 'protection', 'recursion',
  'tokens', 'sac_outlet', 'drain', 'anthem', 'blink', 'self_mill', 'graveyard_hate', 'discard', 'lifegain',
  'land', 'other',
] as const
export type Role = (typeof ROLES)[number]
/** Nome que vai para o texto da lista: "1 Sol Ring (C21) 263 [Ramp]" */
export const ROLE_TEXT: Record<Role, string> = {
  ramp: 'Ramp', draw: 'Draw', tutor: 'Tutor', removal: 'Removal', board_wipe: 'Board Wipe',
  counterspell: 'Counterspell', protection: 'Protection', recursion: 'Recursion', tokens: 'Tokens',
  sac_outlet: 'Sac Outlet', drain: 'Drain', anthem: 'Anthem', blink: 'Blink', self_mill: 'Self-Mill',
  graveyard_hate: 'Graveyard Hate', discard: 'Discard', lifegain: 'Lifegain', land: 'Land', other: 'Other',
}

/** Categoria do texto ("Ramp", "board wipe", "Lands") para a chave; o que não reconhece fica de fora */
export function categoryKey(text: string): Role | undefined {
  const t = text.trim().toLowerCase().replace(/s$/, '').replace(/[\s-]+/g, '_')
  const alias: Record<string, Role> = {
    card_draw: 'draw', wipe: 'board_wipe', counter: 'counterspell', mana: 'ramp', token: 'tokens',
    sacrifice_outlet: 'sac_outlet', flicker: 'blink', mill: 'self_mill', life_gain: 'lifegain', aristocrat: 'drain',
  }
  if (alias[t]) return alias[t]
  return (ROLES as readonly string[]).includes(t) ? (t as Role) : undefined
}

/** Funções de cada carta (pelo oracle id), vindas do backend (tags do Scryfall) */
export type RoleMap = Record<string, string[]>

/** Quando a carta tem várias funções, a mais específica vence (Wrath of God é board wipe, não remoção) */
// As funções principais vêm antes das de tema (fichas, sacrifício...): Skullclamp fica em compra
const ROLE_PRIORITY: Role[] = [
  'board_wipe', 'counterspell', 'tutor', 'ramp', 'removal', 'draw', 'protection', 'recursion',
  'sac_outlet', 'drain', 'tokens', 'anthem', 'blink', 'self_mill', 'graveyard_hate', 'discard', 'lifegain',
]

/** Categoria principal: a escolhida à mão; senão terreno; senão a função mais específica (ROLE_PRIORITY) */
export function roleOf(e: DeckEntry, roles: RoleMap): Role {
  if (e.category && (ROLES as readonly string[]).includes(e.category)) return e.category as Role
  if (/\bLand\b/.test(e.card.typeLine.split(' // ')[0])) return 'land'
  const tags = new Set(roles[e.card.oracleId] ?? [])
  if (tags.has('fast_mana')) tags.add('ramp')
  return ROLE_PRIORITY.find((r) => tags.has(r)) ?? 'other'
}

// ---- cores: símbolos de mana pedidos × fontes de cada cor ---------------------------------------

/**
 * Por cor: quantos símbolos de mana as mágicas pedem (custo) e quantas cartas geram aquela cor
 * (terrenos e outras fontes, pelo "Add {G}" do texto; "mana of any color" conta para todas).
 */
export function colorBalance(d: BuilderDeck): Record<(typeof COLORS)[number], { pips: number; sources: number }> {
  const out = Object.fromEntries(COLORS.map((c) => [c, { pips: 0, sources: 0 }])) as Record<
    (typeof COLORS)[number],
    { pips: number; sources: number }
  >
  const identity = deckIdentity(d)
  const all = [...d.commanders.map((card) => ({ card, qty: 1 })), ...d.cards]
  for (const { card, qty } of all) {
    const front = card.manaCost.split(' // ')[0]
    for (const sym of front.match(/\{[^}]+\}/g) ?? [])
      for (const c of COLORS) if (sym.includes(c)) out[c].pips += qty
    const adds = [...card.oracle.matchAll(/Add ([^.]*)/g)].map((m) => m[1])
    if (!adds.length) continue
    const made = new Set<string>()
    for (const a of adds) {
      if (/any color|any one color|mana of any type/i.test(a)) identity.forEach((c) => made.add(c))
      for (const c of COLORS) if (a.includes(`{${c}}`)) made.add(c)
    }
    for (const c of made) out[c as (typeof COLORS)[number]].sources += qty
  }
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

const withCategory = (e: DeckEntry) =>
  line(e.qty, e.card) + (e.category && ROLE_TEXT[e.category as Role] ? ` [${ROLE_TEXT[e.category as Role]}]` : '')

/**
 * Lista no formato que a importação entende: comandantes, linha em branco, o resto (com a
 * categoria escolhida à mão, como no Archidekt) e o maybeboard numa seção que fica fora do deck.
 */
export function toDecklist(d: BuilderDeck): string {
  const lines = [...d.commanders.map((c) => line(1, c)), '', ...d.cards.map(withCategory)]
  if (d.maybe.length) lines.push('', 'Maybeboard', ...d.maybe.map(withCategory))
  return lines.join('\n')
}

// ---- rascunho no navegador ------------------------------------------------------------------

const draftKey = (id?: string) => `precon-draft:builder:${id ?? 'new'}`
export const loadDraft = (id?: string) => {
  const d = readJSON<BuilderDeck | null>(draftKey(id), null)
  // Rascunhos de antes do maybeboard e do oracle id
  return d ? { ...d, maybe: d.maybe ?? [] } : null
}
export const saveDraft = (d: BuilderDeck, id?: string) => writeJSON(draftKey(id), d)
export const clearDraft = (id?: string) => writeJSON(draftKey(id), null)
