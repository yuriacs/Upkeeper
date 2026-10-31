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

/** Uma linha da lista com a carta achada no Scryfall */
export type FoundLine = { line: TextLine; card: BuilderCard }

/**
 * As cartas das linhas no Scryfall (/cards/collection, 75 por vez), pela edição indicada ou pelo
 * nome. O Scryfall devolve na ordem pedida, sem as não encontradas: assim cada carta volta para a
 * sua linha mesmo quando o nome muda ("Delver of Secrets" → "Delver of Secrets // Insectile
 * Aberration"). A edição que não existe é procurada de novo só pelo nome.
 */
export async function fetchLines(lines: TextLine[], signal?: AbortSignal): Promise<{ found: FoundLine[]; missing: TextLine[] }> {
  type Ident = { set: string; collector_number: string } | { name: string }
  const ident = (l: TextLine, byName: boolean): Ident =>
    !byName && l.set && l.number ? { set: l.set.toLowerCase(), collector_number: l.number } : { name: l.name }
  const key = (i: Ident) => ('name' in i ? `n:${i.name.toLowerCase()}` : `s:${i.set}/${i.collector_number}`.toLowerCase())
  const found: FoundLine[] = []
  let missing: TextLine[] = []
  const run = async (list: TextLine[], byName: boolean) => {
    // Cada carta uma vez só por consulta (a mesma carta em duas linhas): o resultado volta pela chave
    const unique = new Map<string, Ident>()
    for (const l of list) unique.set(key(ident(l, byName)), ident(l, byName))
    const keys = [...unique.keys()]
    const got = new Map<string, BuilderCard>()
    for (let i = 0; i < keys.length; i += 75) {
      if (i) await new Promise((r) => setTimeout(r, 100)) // o Scryfall pede um respiro entre consultas
      const batch = keys.slice(i, i + 75)
      const r = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ identifiers: batch.map((k) => unique.get(k)) }),
        signal,
      })
      if (!r.ok) throw new Error(`Scryfall ${r.status}`)
      const d: { data?: ScryCard[]; not_found?: Ident[] } = await r.json()
      const lost = new Set((d.not_found ?? []).map(key))
      const cards = d.data ?? []
      let next = 0
      for (const k of batch) if (!lost.has(k) && next < cards.length) got.set(k, fromScryfall(cards[next++]))
    }
    const notFound: TextLine[] = []
    for (const line of list) {
      const card = got.get(key(ident(line, byName)))
      if (card) found.push({ line, card })
      else notFound.push(line)
    }
    return notFound
  }
  const lost = await run(lines, false)
  const retry = lost.filter((l) => l.set && l.number)
  missing = lost.filter((l) => !(l.set && l.number))
  if (retry.length) missing.push(...(await run(retry, true)))
  return { found, missing }
}

/** Cartas do maybeboard salvo (só o texto): busca no Scryfall, pela edição ou pelo nome */
export async function fetchMaybe(lines: TextLine[]): Promise<DeckEntry[]> {
  const { found } = await fetchLines(lines).catch(() => ({ found: [] as FoundLine[] }))
  return found.map(({ line, card }) => {
    const category = categoryKey(line.category)
    return { card, qty: line.qty, ...(category ? { category } : {}) }
  })
}

// ---- lista colada → deck ------------------------------------------------------------------------

/**
 * A lista lida como o servidor lê (backend pools/services/decklist.py), para a prévia da importação:
 * seções, comentários, "SB:", categorias do Archidekt, *CMDR*, o sideboard no último bloco e o
 * comandante no primeiro bloco (export do Moxfield).
 */
export type ParsedList = { commanders: TextLine[]; cards: TextLine[]; maybe: TextLine[]; bad: string[] }

const IGNORED = /^(sideboard|token|tokens)$/i
const COMMANDER_SECTION = /^(commanders?|comandantes?)$/i
const SECTION = /^(commanders?|comandantes?|companion|deck|main(?:board)?|sideboard|maybeboard|considering|tokens?)\s*:?\s*(?:\(\d+\))?$/i

export function parseDecklist(text: string): ParsedList {
  type Line = TextLine & { commander: boolean; block: number }
  let section = 'deck'
  let hasSections = false
  let block = 0
  const lines: Line[] = []
  const maybe: TextLine[] = []
  const bad: string[] = []
  ;(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line) {
      if (lines.length && lines[lines.length - 1].block === block) block++
      return
    }
    if (line.startsWith('//') || line.startsWith('#')) {
      const header = SECTION.exec(line.replace(/^[/#]+/, '').trim())
      if (header) {
        section = header[1].toLowerCase()
        hasSections = true
      }
      return
    }
    if (/^SB:\s*/i.test(line)) return
    const header = SECTION.exec(line)
    if (header) {
      section = header[1].toLowerCase()
      hasSections = true
      return
    }
    if (IGNORED.test(section)) return
    const m = TEXT_LINE.exec(line)
    if (!m || !m[2].trim()) {
      bad.push(`${i + 1}: ${line}`)
      return
    }
    const rawCats = (m[5] ?? '').toLowerCase()
    const cats = rawCats.split(',').map((c) => c.replace(/\{[^}]*\}/g, '').trim()).filter(Boolean)
    const entry: TextLine = {
      qty: Number(m[1] ?? 1),
      name: m[2].trim(),
      set: m[3] ?? '',
      number: m[4] ?? '',
      category: (m[5] ?? '').split(',')[0]?.replace(/\{[^}]*\}/g, '').trim() ?? '',
    }
    if (/^(maybeboard|considering)$/.test(section) || cats.some((c) => /^(maybeboard|considering)$/.test(c))) {
      maybe.push(entry)
      return
    }
    if (rawCats.includes('{nodeck}') || cats.some((c) => IGNORED.test(c))) return
    const commander = COMMANDER_SECTION.test(section) || cats.includes('commander') || /\*CMDR\*/i.test(line)
    lines.push({ ...entry, commander, block })
  })
  let parsed = lines
  if (!hasSections && parsed.length) {
    // Sem títulos: o último bloco que faz passar de 100 cartas é o sideboard (export MTGO)
    const blocks = [...new Set(parsed.map((l) => l.block))]
    if (blocks.length > 1) {
      const lastBlock = blocks[blocks.length - 1]
      const total = parsed.reduce((n, l) => n + l.qty, 0)
      const last = parsed.filter((l) => l.block === lastBlock)
      const extra = last.reduce((n, l) => n + l.qty, 0)
      if (total > DECK_SIZE && total - extra <= DECK_SIZE && extra <= 15 && !last.some((l) => l.commander))
        parsed = parsed.filter((l) => l.block !== lastBlock)
    }
    if (!parsed.some((l) => l.commander)) {
      // Export do Moxfield: 1–2 cartas no primeiro bloco são o(s) comandante(s); senão, a primeira carta
      const first = parsed.filter((l) => l.block === parsed[0].block)
      if (parsed.length > first.length && first.length <= 2 && first.every((l) => l.qty === 1)) first.forEach((l) => (l.commander = true))
      else parsed[0].commander = true
    }
  }
  const strip = ({ commander: _c, block: _b, ...l }: Line): TextLine => l
  return {
    commanders: parsed.filter((l) => l.commander).map(strip),
    cards: parsed.filter((l) => !l.commander).map(strip),
    maybe,
    bad,
  }
}

/** A lista inteira no formato do deckbuilder; `missing`: linhas que o Scryfall não conhece */
export async function deckFromList(
  name: string,
  list: ParsedList,
  signal?: AbortSignal,
): Promise<{ deck: BuilderDeck; missing: TextLine[]; lineName: Map<string, string> }> {
  const tagged = [
    ...list.commanders.map((l) => ({ l, where: 'commander' as const })),
    ...list.cards.map((l) => ({ l, where: 'deck' as const })),
    ...list.maybe.map((l) => ({ l, where: 'maybe' as const })),
  ]
  const { found, missing } = await fetchLines(tagged.map((x) => x.l), signal)
  const where = new Map(tagged.map((x) => [x.l, x.where]))
  const deck: BuilderDeck = { name, commanders: [], cards: [], maybe: [] }
  // Nome escrito na lista de cada carta: é por ele que o servidor acha o comandante escolhido
  const lineName = new Map<string, string>()
  for (const { line, card } of found) {
    lineName.set(card.id, line.name)
    const category = categoryKey(line.category)
    const entry: DeckEntry = { card, qty: line.qty, ...(category ? { category } : {}) }
    const w = where.get(line)
    if (w === 'commander') deck.commanders.push(card)
    else if (w === 'maybe') deck.maybe.push(entry)
    else deck.cards.push(entry)
  }
  return { deck, missing, lineName }
}

/** O deck com outros comandantes (pelo id da carta): os antigos voltam para a lista principal */
export function withCommanders(d: BuilderDeck, ids: string[]): BuilderDeck {
  const all = [...d.commanders.map((card) => ({ card, qty: 1 }) as DeckEntry), ...d.cards]
  const commanders = ids.map((id) => all.find((e) => e.card.id === id)?.card).filter((c): c is BuilderCard => !!c)
  const cards: DeckEntry[] = []
  for (const e of all) {
    const taken = commanders.some((c) => c.id === e.card.id)
    if (!taken) cards.push(e)
    else if (e.qty > 1) cards.push({ ...e, qty: e.qty - 1 })
  }
  return { ...d, commanders, cards }
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
