/*
 * Gerador de decks (página /my-pool/generate). Com o comandante, os temas, o orçamento e o bracket,
 * monta um deck de 100 cartas a partir do que a comunidade joga com aquele comandante (EDHREC). Cada
 * carta é conferida no Scryfall (existe, é legal em Commander, cabe nas cores, preço da edição mais
 * barata, Game Changer) e a função dela (ramp, compra, remoção...) vem do nosso servidor; o bracket do
 * deck pronto é conferido no Commander Spellbook, como no deckbuilder.
 *
 * Roda no navegador, como o deckbuilder. O servidor só responde a função das cartas, o bracket, as
 * cartas que o jogador tem e, com a IA ligada, a leitura da frase do "Descreva seu deck" e o guia de
 * jogo (backend pools/generator.py).
 */
import { api } from './api'
import {
  COLORS,
  NO_PHYREXIAN,
  canCommand,
  fromApiCard,
  searchCards,
  type BuilderCard,
  type BuilderDeck,
  type DeckEntry,
  type RoleMap,
} from './deckbuilder'
import {
  COLOR_SLUGS,
  edhrecSlug,
  fetchCommanders,
  fetchEdhrec,
  type EdhrecCommander,
  type EdhrecData,
  type EdhrecTheme,
} from './edhrec'
import { readJSON, writeJSON } from './storage'
import type { BracketDetails, PlayGuide } from './types'

// ---- respostas do passo a passo --------------------------------------------------------------

/** Os quatro jeitos de começar: descrever, ser guiado, partir do comandante ou só com as suas cartas */
export type Lane = 'describe' | 'guide' | 'commander' | 'collection'
export type StepKey = 'start' | 'describe' | 'colors' | 'commander' | 'themes' | 'budget' | 'power' | 'details' | 'review'
export type Theme = EdhrecTheme

export type Answers = {
  lane: Lane | null
  description: string
  /** Cores pedidas antes do comandante ("Me guie"): null = qualquer; [] = incolor */
  colors: string[] | null
  commanders: BuilderCard[]
  themes: Theme[]
  /** Sem tema escolhido: usa os temas mais jogados com o comandante */
  surprise: boolean
  /** Total em US$ (a edição mais barata de cada carta); null = sem limite */
  budget: number | null
  bracket: number
  /** Só cartas que o jogador tem (precons marcados e decks montados) */
  owned: boolean
  /** Cartas que têm de entrar / ficar de fora (nomes escolhidos na busca, ou lidos na frase) */
  include: string[]
  exclude: string[]
  name: string
  /** Comandantes sugeridos a partir da frase do "Descreva seu deck" */
  suggestions: string[]
}

export const NEW_ANSWERS: Answers = {
  lane: null,
  description: '',
  colors: null,
  commanders: [],
  themes: [],
  surprise: false,
  budget: 100,
  bracket: 3,
  owned: false,
  include: [],
  exclude: [],
  name: '',
  suggestions: [],
}

export const MAX_THEMES = 3
/** Cartas obrigatórias (e proibidas) no máximo */
export const MAX_PICKED = 30
/** Orçamentos prontos (US$); o campo aceita qualquer valor */
export const BUDGETS = [50, 100, 250, 500]
export const BRACKET_SLUGS: Record<number, string> = { 1: 'exhibition', 2: 'core', 3: 'upgraded', 4: 'optimized', 5: 'cedh' }

/** Os passos de cada caminho, na ordem (sem orçamento quando o deck é só com as suas cartas) */
export function stepsFor(lane: Lane | null): StepKey[] {
  switch (lane) {
    case 'describe':
      return ['start', 'describe', 'commander', 'themes', 'budget', 'power', 'details', 'review']
    case 'guide':
      // Cores e logo o comandante (só dessas cores); os temas vêm depois, os do comandante escolhido
      return ['start', 'colors', 'commander', 'themes', 'budget', 'power', 'details', 'review']
    case 'commander':
      return ['start', 'commander', 'themes', 'budget', 'power', 'details', 'review']
    case 'collection':
      return ['start', 'commander', 'themes', 'power', 'details', 'review']
    default:
      return ['start']
  }
}

/** Identidade de cor dos comandantes, na ordem WUBRG */
export const identityOf = (commanders: BuilderCard[]) => COLORS.filter((c) => commanders.some((cmd) => cmd.identity.includes(c)))

/** As mesmas cores, em qualquer ordem ([] = incolor) */
export const sameColors = (a: string[], b: string[]) => a.length === b.length && a.every((c) => b.includes(c))

/** Nomes de cartas sem repetir e sem vazios, no máximo MAX_PICKED */
const cleanNames = (names: string[]) => [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, MAX_PICKED)

/**
 * Respostas guardadas por uma versão anterior da página (as cartas eram um texto, uma por linha:
 * "1 Sol Ring", "Sol Ring (C21) 263"...) no formato de agora, com os campos que faltarem.
 */
export function upgradeAnswers(saved: Partial<Omit<Answers, 'include' | 'exclude'>> & { include?: unknown; exclude?: unknown }): Answers {
  const list = (v: unknown): string[] =>
    Array.isArray(v)
      ? cleanNames(v.filter((x): x is string => typeof x === 'string'))
      : typeof v === 'string'
        ? cleanNames(v.split(/\r?\n|;/).map((l) => l.replace(/^\s*\d+\s*x?\s+/i, '').replace(/\s+\([A-Za-z0-9]{2,6}\).*$/, '').replace(/\s*\[.*$/, '')))
        : []
  return { ...NEW_ANSWERS, ...saved, include: list(saved.include), exclude: list(saved.exclude) }
}

// ---- o que fica salvo no navegador ---------------------------------------------------------------

const WIZARD_KEY = 'precon-draft:generator'
const HISTORY_KEY = 'precon-draft:generated'
const HISTORY_MAX = 8

export type WizardState = { answers: Answers; step: StepKey }
/** Respostas em andamento: voltam se a página for recarregada */
export const loadWizard = () => readJSON<WizardState | null>(WIZARD_KEY, null)
export const saveWizard = (s: WizardState) => writeJSON(WIZARD_KEY, s)
export const clearWizard = () => writeJSON(WIZARD_KEY, null)

/** Os últimos decks gerados (só neste navegador), o mais novo primeiro */
export const loadHistory = () => readJSON<GenResult[]>(HISTORY_KEY, [])
export function saveToHistory(r: GenResult) {
  writeJSON(HISTORY_KEY, [r, ...loadHistory().filter((x) => x.id !== r.id)].slice(0, HISTORY_MAX))
}
export function removeFromHistory(id: string) {
  writeJSON(HISTORY_KEY, loadHistory().filter((x) => x.id !== id))
}

// ---- cartas ----------------------------------------------------------------------------------

const front = (name: string) => name.split(' // ')[0]
/** Chave de uma carta pelo nome: a frente, sem maiúsculas ("Fire // Ice" e "fire" batem) */
export const cardKey = (name: string) => front(name).toLowerCase()
export const isLand = (c: BuilderCard) => /\bLand\b/.test(c.typeLine.split(' // ')[0])
const isBasicLand = (c: BuilderCard) => /\bBasic\b/.test(c.typeLine) && isLand(c)
const BASICS: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest', C: 'Wastes' }

const abortError = (signal: AbortSignal) => signal.reason ?? new DOMException('Aborted', 'AbortError')

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError(signal))
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(abortError(signal))
      },
      { once: true },
    )
  })
}

/** Falha de rede vira null; cancelar continua cancelando */
async function safe<T>(p: Promise<T>, signal: AbortSignal): Promise<T | null> {
  try {
    return await p
  } catch {
    if (signal.aborted) throw abortError(signal)
    return null
  }
}

/** Pedidos feitos por uma geração (o registro de uso do painel do admin mostra as médias) */
export type Meter = { scryfall: number; edhrec: number; server: number }
export const newMeter = (): Meter => ({ scryfall: 0, edhrec: 0, server: 0 })

/** Nomes por busca no Scryfall ("!"A" or !"B" ..."): cabe na URL */
const NAMES_PER_QUERY = 18

/**
 * Cartas pelo nome, na edição mais barata de cada uma (o preço que entra no valor do deck), em buscas
 * de 18 nomes, uma depois da outra (a busca do Scryfall pede calma). Chave: cardKey(nome).
 */
export async function resolveByName(
  names: string[],
  signal: AbortSignal,
  onBatch?: (done: number, total: number) => void,
  meter?: Meter,
): Promise<Map<string, BuilderCard>> {
  const out = new Map<string, BuilderCard>()
  const list = [...new Set(names.filter(Boolean))]
  for (let i = 0; i < list.length; i += NAMES_PER_QUERY) {
    const batch = list.slice(i, i + NAMES_PER_QUERY)
    const q = `(${batch.map((n) => `!"${n.replace(/"/g, '')}"`).join(' or ')}) prefer:usd-low ${NO_PHYREXIAN}`
    if (meter) meter.scryfall++
    const page = await safe(searchCards(q, signal), signal)
    for (const c of page?.cards ?? []) out.set(cardKey(c.name), c)
    onBatch?.(Math.min(i + NAMES_PER_QUERY, list.length), list.length)
    if (i + NAMES_PER_QUERY < list.length) await wait(350, signal)
  }
  return out
}

/** Sem dados do EDHREC (comandante novo demais): as cartas mais jogadas nessas cores, pelo Scryfall */
async function popularInColors(identity: string[], signal: AbortSignal, meter: Meter): Promise<BuilderCard[]> {
  const q = `id<=${identity.join('').toLowerCase() || 'c'} legal:commander game:paper -t:basic prefer:usd-low ${NO_PHYREXIAN}`
  meter.scryfall++
  const first = await safe(searchCards(q, signal), signal)
  if (!first) return []
  if (!first.next) return first.cards
  await wait(350, signal)
  meter.scryfall++
  const second = await safe(searchCards(q, signal, first.next), signal)
  return [...first.cards, ...(second?.cards ?? [])]
}

/**
 * Comandantes para quem ainda não escolheu: os mais jogados nos temas escolhidos (nessas cores) ou,
 * sem tema, nas cores; sem nada, os mais jogados dos últimos dois anos. Quem aparece em mais temas vem antes.
 */
export async function suggestCommanders(
  a: { colors: string[] | null; themes: Theme[] },
  signal?: AbortSignal,
): Promise<EdhrecCommander[]> {
  const colors = a.colors === null ? null : COLOR_SLUGS[COLORS.filter((c) => a.colors!.includes(c)).join('')]
  const paths = a.themes.length
    ? a.themes.map((th) => (colors ? `tags/${th.slug}/${colors}` : `tags/${th.slug}`))
    : [colors ? `commanders/${colors}` : 'commanders/year']
  const lists = await Promise.all(paths.map((p) => fetchCommanders(p, signal).catch(() => [] as EdhrecCommander[])))
  const merged = new Map<string, EdhrecCommander & { hits: number }>()
  for (const list of lists)
    for (const c of list) {
      const prev = merged.get(c.name)
      merged.set(c.name, { name: c.name, decks: (prev?.decks ?? 0) + c.decks, hits: (prev?.hits ?? 0) + 1 })
    }
  return [...merged.values()].sort((x, y) => y.hits - x.hits || y.decks - x.decks).slice(0, 18)
}

/** Página principal do comandante no EDHREC: a da dupla, se existir; senão a do primeiro */
export async function mainPage(
  commanders: BuilderCard[],
  signal: AbortSignal,
  meter?: Meter,
): Promise<{ slug: string; page: EdhrecData } | null> {
  const slugs = commanders.map((c) => edhrecSlug(c.name)).filter(Boolean)
  for (const slug of slugs.length > 1 ? [[...slugs].sort().join('-'), slugs[0]] : slugs) {
    if (meter) meter.edhrec++
    const page = await safe(fetchEdhrec(`commanders/${slug}`, signal), signal)
    if (page) return { slug, page }
  }
  return null
}

/** Comandantes pelo nome (sugeridos pelo EDHREC ou pela IA), conferidos: só os que podem comandar */
export async function commandersByName(names: string[], signal: AbortSignal): Promise<BuilderCard[]> {
  const found = await resolveByName(names, signal)
  return names
    .map((n) => found.get(cardKey(n)))
    .filter((c): c is BuilderCard => !!c && canCommand(c) && c.legal !== false)
}

// ---- a montagem ---------------------------------------------------------------------------------

export type Phase = 'commander' | 'community' | 'plan' | 'spells' | 'lands' | 'budget' | 'power'
export const PHASES: Phase[] = ['commander', 'community', 'plan', 'spells', 'lands', 'budget', 'power']

/** Texto em inglês (traduzido com t() na tela) e os valores dele */
export type Note = { text: string; vars?: Record<string, string | number> }

export type Progress = {
  phase: Phase
  /** Cartas escolhidas até agora (de 100): o quadro de vagas */
  chosen: number
  note: Note | null
  /** Segundos desde o início em que cada fase terminou */
  done: Partial<Record<Phase, number>>
}

export type QuotaKey = 'ramp' | 'draw' | 'removal' | 'board_wipe' | 'land'
export type Quota = { key: QuotaKey; target: number; have: number }

export type GenResult = {
  id: string
  createdAt: number
  answers: Answers
  deck: BuilderDeck
  /** Temas usados: os escolhidos ou, com "me surpreenda", os mais jogados com o comandante */
  themes: Theme[]
  price: number
  quotas: Quota[]
  /** Funções das cartas (oracle id → tags), para a lista por função */
  roles: RoleMap
  /** Bracket estimado pelo Commander Spellbook (null: não respondeu) */
  bracket: number | null
  bracketDetails: BracketDetails
  /** As cartas que mais definem o deck (as mais ligadas aos temas ou ao comandante) */
  keyCards: string[]
  /** Só com as suas cartas: as que entraram sem você ter */
  missing: string[]
  notes: Note[]
  /** Decks do EDHREC por trás da escolha */
  sampleDecks: number
  guide?: PlayGuide
  /** Quanto a geração levou e quantos pedidos fez (ausente nas gerações antigas do histórico) */
  cost?: Meter & { ms: number }
}

export class GenError extends Error {
  code: 'no_commander' | 'no_data' | 'scryfall' | 'pool'
  constructor(code: GenError['code']) {
    super(code)
    this.code = code
  }
}

type RoleKey = Exclude<QuotaKey, 'land'>
/** Mínimo de cartas de cada função por bracket (contando só as que não são terreno) */
const ROLE_TARGETS: Record<number, Record<RoleKey, number>> = {
  1: { ramp: 9, draw: 8, removal: 6, board_wipe: 2 },
  2: { ramp: 10, draw: 9, removal: 7, board_wipe: 2 },
  3: { ramp: 10, draw: 10, removal: 8, board_wipe: 2 },
  4: { ramp: 12, draw: 11, removal: 9, board_wipe: 3 },
  5: { ramp: 14, draw: 12, removal: 10, board_wipe: 2 },
}
const ROLE_ORDER: RoleKey[] = ['ramp', 'draw', 'removal', 'board_wipe']
const ROLE_NOTES: Record<RoleKey, string> = {
  ramp: 'Ramp is in: {cards}',
  draw: 'Card draw is in: {cards}',
  removal: 'Removal is in: {cards}',
  board_wipe: 'Board wipes: {cards}',
}
/** Preço máximo (US$) de cada carta que completa um deck feito com as cartas do jogador */
const OWNED_FILL_CAP = 3
/** Até este orçamento (US$) o gerador parte dos decks baratos do comandante no EDHREC */
const LOW_BUDGET = 60
/** Parte do orçamento que uma carta sozinha pode custar */
const CARD_SHARE = 0.35
/** Game Changers permitidos por bracket */
const GAME_CHANGERS: Record<number, number> = { 1: 0, 2: 0, 3: 3, 4: Infinity, 5: Infinity }

/** Quantas vezes a carta aparece nos decks da página (0 a 1) e a sinergia com o comandante */
type Stat = { name: string; base: number; theme: number[]; synergy: number; land: boolean }

const LAND_LISTS = new Set(['lands', 'utilitylands'])

function collect(base: EdhrecData | null, themePages: EdhrecData[]): Map<string, Stat> {
  const stats = new Map<string, Stat>()
  const touch = (name: string, land: boolean) => {
    const k = cardKey(name)
    let s = stats.get(k)
    if (!s) {
      s = { name, base: 0, theme: themePages.map(() => 0), synergy: 0, land }
      stats.set(k, s)
    }
    s.land ||= land
    return s
  }
  const rate = (decks: number, of: number) => (of > 0 ? decks / of : 0)
  for (const l of base?.lists ?? [])
    for (const c of l.cards) {
      const s = touch(c.name, LAND_LISTS.has(l.tag))
      s.base = Math.max(s.base, rate(c.decks, c.of))
      s.synergy = Math.max(s.synergy, c.synergy)
    }
  themePages.forEach((page, i) => {
    for (const l of page.lists)
      for (const c of l.cards) {
        const s = touch(c.name, LAND_LISTS.has(l.tag))
        s.theme[i] = Math.max(s.theme[i], rate(c.decks, c.of))
        s.synergy = Math.max(s.synergy, c.synergy)
      }
  })
  return stats
}

/** Nota da carta: o quanto ela aparece nos decks dos temas e do comandante, mais a sinergia */
function scoreOf(s: Stat): { score: number; theme: number } {
  const syn = Math.max(0, Math.min(1, s.synergy))
  if (!s.theme.length) return { score: 0.75 * s.base + 0.25 * syn, theme: 0 }
  const theme = 0.5 * Math.max(...s.theme) + (0.5 * s.theme.reduce((a, b) => a + b, 0)) / s.theme.length
  return { score: 0.45 * theme + 0.35 * s.base + 0.2 * syn, theme }
}

const average = (values: (number | undefined)[]) => {
  const ok = values.filter((n): n is number => typeof n === 'number')
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null
}

/** Símbolos de cada cor nos custos ({W}, {W/U}, {2/W}, {W/P}...) */
function pipsOf(cards: BuilderCard[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of cards)
    for (const sym of c.manaCost.split(' // ')[0].match(/\{[^}]+\}/g) ?? [])
      for (const color of COLORS) if (sym.includes(color)) out[color] = (out[color] ?? 0) + 1
  return out
}

/** Divide os básicos entre as cores pela quantidade de símbolos (toda cor pedida ganha ao menos 1) */
function splitBasics(total: number, colors: string[], pips: Record<string, number>): Record<string, number> {
  if (!colors.length) return { C: total }
  const sum = colors.reduce((n, c) => n + (pips[c] ?? 0), 0)
  const raw = colors.map((c) => (sum ? ((pips[c] ?? 0) / sum) * total : total / colors.length))
  const out: Record<string, number> = Object.fromEntries(colors.map((c, i) => [c, Math.floor(raw[i])]))
  const order = colors.map((c, i) => [c, raw[i] - Math.floor(raw[i])] as const).sort((a, b) => b[1] - a[1])
  let left = total - Object.values(out).reduce((a, b) => a + b, 0)
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i][0]]++
  for (const c of colors)
    if ((pips[c] ?? 0) > 0 && out[c] === 0) {
      const donor = colors.reduce((a, b) => (out[a] >= out[b] ? a : b))
      if (out[donor] > 1) {
        out[donor]--
        out[c]++
      }
    }
  return out
}

/** Uma carta candidata: a nota, se é obrigatória (pedida pelo jogador) e se ele já tem */
type Cand = { card: BuilderCard; score: number; theme: number; synergy: number; forced: boolean; owned: boolean }
type Slot = { cand: Cand; qty: number }

type Options = { signal: AbortSignal; onProgress: (p: Progress) => void; meter?: Meter }

export async function generate(answers: Answers, { signal, onProgress, meter = newMeter() }: Options): Promise<GenResult> {
  const started = performance.now()
  const progress: Progress = { phase: 'commander', chosen: 0, note: null, done: {} }
  const emit = (patch: Partial<Progress>) => {
    Object.assign(progress, patch)
    onProgress({ ...progress, done: { ...progress.done } })
  }
  const finish = (phase: Phase) => {
    progress.done[phase] = Math.round((performance.now() - started) / 1000)
  }
  const notes: Note[] = []

  const commanders = answers.commanders.slice(0, 2)
  if (!commanders.length) throw new GenError('no_commander')
  const identity = identityOf(commanders)
  const bracket = Math.max(1, Math.min(5, answers.bracket))
  const budget = answers.owned ? null : answers.budget
  // Orçamento baixo de verdade: as páginas do EDHREC só com os decks baratos do comandante. Acima disso, os decks
  // de todos os preços, e o ajuste do orçamento troca as cartas caras demais
  const cheap = budget !== null && budget <= LOW_BUDGET
  const names = commanders.map((c) => front(c.name)).join(' + ')

  // 1. O comandante
  emit({ phase: 'commander', chosen: commanders.length, note: { text: 'Reading {name}', vars: { name: names } } })
  await wait(350, signal)
  finish('commander')

  // 2. O que a comunidade joga com ele: a página do bracket (e do orçamento) e a de cada tema
  emit({ phase: 'community', note: { text: 'Looking at what other people play with {name}', vars: { name: names } } })
  const main = await mainPage(commanders, signal, meter)
  const edhrec = (path: string) => {
    meter.edhrec++
    return safe(fetchEdhrec(path, signal), signal)
  }
  let themes = answers.themes.slice(0, MAX_THEMES)
  if (!themes.length && answers.surprise && main) themes = main.page.themes.slice(0, 2)

  let base: EdhrecData | null = null
  if (main) {
    const bslug = BRACKET_SLUGS[bracket]
    for (const path of cheap ? [`${bslug}/budget`, 'budget', bslug] : [bslug]) {
      const page = await edhrec(`commanders/${main.slug}/${path}`)
      if (page && page.decks >= 25) {
        base = page
        break
      }
    }
    base ??= main.page
  }
  const themePages: EdhrecData[] = []
  const usedThemes: Theme[] = []
  for (const th of themes) {
    let page: EdhrecData | null = null
    if (main)
      for (const path of cheap ? [`${th.slug}/budget`, th.slug] : [th.slug]) {
        const got = await edhrec(`commanders/${main.slug}/${path}`)
        if (got && got.decks >= 20) {
          page = got
          break
        }
      }
    // O comandante quase não tem decks com esse tema: as cartas do tema nessas cores
    page ??= await edhrec(`tags/${th.slug}/${COLOR_SLUGS[identity.join('')]}`)
    if (page) {
      themePages.push(page)
      usedThemes.push(th)
    } else notes.push({ text: 'No data for the theme {theme} in these colors: it was left out.', vars: { theme: th.name } })
  }
  let generic: BuilderCard[] = []
  if (!base && !themePages.length) {
    generic = await popularInColors(identity, signal, meter)
    if (!generic.length) throw new GenError('no_data')
    notes.push({ text: 'EDHREC has no decks with this commander yet: the deck uses the most played cards in its colors.' })
  }
  // Para usar o dinheiro que sobra: o que os decks um bracket acima jogam com o comandante (cartas mais
  // fortes, e mais caras). As regras do bracket pedido continuam valendo na hora da troca
  let stronger: EdhrecData | null = null
  if (main && budget !== null && !cheap && bracket < 5) {
    stronger = await edhrec(`commanders/${main.slug}/${BRACKET_SLUGS[bracket + 1]}`)
    if (!stronger || stronger.decks < 25) stronger = main.page
  }
  const sampleDecks = base?.decks ?? 0
  if (sampleDecks) emit({ note: { text: '{n} decks with {name} on EDHREC', vars: { n: sampleDecks, name: names } } })
  finish('community')

  // 3. O plano: terrenos, funções e curva
  emit({ phase: 'plan' })
  const landPages = [base, ...themePages].filter((p): p is EdhrecData => !!p)
  const landAvg = average(landPages.map((p) => p.averages.land)) ?? (bracket === 5 ? 31 : 36)
  const landCount = Math.round(Math.max(bracket === 5 ? 28 : 33, Math.min(40, landAvg)))
  const targets = ROLE_TARGETS[bracket]
  const nonlandSlots = 100 - commanders.length - landCount
  const curve = (base ?? themePages[0])?.curve ?? {}
  const curveTotal = Object.values(curve).reduce((a, b) => a + b, 0)
  const scale = curveTotal ? nonlandSlots / curveTotal : 0
  const at = (n: number) => Number(curve[String(n)] ?? 0)
  // Custos altos: um pouco acima da média dos decks do comandante (dragões custam caro; elfos, não)
  const maxFive = curveTotal ? Math.round((at(5) + at(6) + at(7)) * scale) + 3 : Math.round(nonlandSlots * 0.18)
  const maxSix = curveTotal ? Math.round((at(6) + at(7)) * scale) + 2 : Math.round(nonlandSlots * 0.1)
  emit({
    note: {
      text: 'The plan: {lands} lands, {ramp} ramp, {draw} card draw, {removal} removal and {wipes} board wipes',
      vars: { lands: landCount, ramp: targets.ramp, draw: targets.draw, removal: targets.removal, wipes: targets.board_wipe },
    },
  })
  await wait(500, signal)
  finish('plan')

  // 4. As mágicas: candidatas do EDHREC conferidas no Scryfall, com a função de cada uma
  emit({ phase: 'spells', note: { text: 'Checking the cards on Scryfall' } })
  const exclude = new Set(cleanNames(answers.exclude).map(cardKey))
  for (const c of commanders) exclude.add(cardKey(c.name))
  const include = cleanNames(answers.include).filter((n) => !exclude.has(cardKey(n)))

  let owned: Map<string, { card: BuilderCard; roles: string[] }> | null = null
  if (answers.owned) {
    meter.server++
    const pool = await api.myCardPool(identity.join('')).catch(() => {
      if (signal.aborted) throw abortError(signal)
      throw new GenError('pool')
    })
    if (pool.cards.length) owned = new Map(pool.cards.map((c) => [cardKey(c.name), { card: fromApiCard(c), roles: c.roles }]))
    else notes.push({ text: 'Your pool has no cards in these colors yet, so the deck was built with any card.' })
  }

  const stats = collect(base, themePages)
  const ranked = [...stats.values()]
    .filter((s) => !exclude.has(cardKey(s.name)))
    .map((s) => ({ s, ...scoreOf(s) }))
    .sort((a, b) => b.score - a.score)
  const wanted = new Set<string>(include)
  const spells = ranked.filter((r) => !r.s.land && !owned?.has(cardKey(r.s.name)))
  const lands = ranked.filter((r) => r.s.land && !owned?.has(cardKey(r.s.name)))
  for (const r of spells.slice(0, owned ? 140 : 230)) wanted.add(r.s.name)
  for (const r of lands.slice(0, owned ? 30 : 60)) wanted.add(r.s.name)
  // Quanto cada carta aparece nos decks mais fortes (0 a 1)
  const strong = new Map<string, number>()
  for (const l of stronger?.lists ?? [])
    for (const c of l.cards) strong.set(cardKey(c.name), Math.max(strong.get(cardKey(c.name)) ?? 0, c.of ? c.decks / c.of : 0))
  const strongNames = (stronger?.lists ?? []).flatMap((l) => l.cards).filter((c) => !exclude.has(cardKey(c.name)))
  for (const c of strongNames.sort((a, b) => b.decks / (b.of || 1) - a.decks / (a.of || 1)).slice(0, 90)) wanted.add(c.name)
  for (const c of identity.length ? identity : ['C']) wanted.add(BASICS[c])
  const resolved = await resolveByName([...wanted], signal, (done, total) =>
    emit({ note: { text: 'Checking the cards on Scryfall ({done} of {all})', vars: { done, all: total } } }),
    meter,
  )
  for (const c of generic) if (!resolved.has(cardKey(c.name))) resolved.set(cardKey(c.name), c)

  const fits = (c: BuilderCard) =>
    c.legal !== false && !!c.image && c.identity.every((x) => identity.includes(x as (typeof COLORS)[number])) && !exclude.has(cardKey(c.name))
  const cands = new Map<string, Cand>()
  const add = (card: BuilderCard | undefined, score: number, theme: number, synergy: number) => {
    if (!card || !fits(card) || isBasicLand(card)) return
    const k = cardKey(card.name)
    if (cands.has(k)) return
    const mine = owned?.get(k)
    cands.set(k, { card: mine?.card ?? card, score, theme, synergy, forced: false, owned: !!mine })
  }
  for (const r of ranked) add(owned?.get(cardKey(r.s.name))?.card ?? resolved.get(cardKey(r.s.name)), r.score, r.theme, r.s.synergy)
  generic.forEach((c, i) => add(c, 0.6 * (1 - i / Math.max(1, generic.length)), 0, 0))
  // As dos decks mais fortes que não aparecem nos do bracket nem nos temas: nota 0, só entram nas trocas por dinheiro
  for (const c of strongNames) add(resolved.get(cardKey(c.name)), 0, 0, c.synergy)

  const roles: RoleMap = {}
  for (const o of owned?.values() ?? []) if (o.card.oracleId) roles[o.card.oracleId] = o.roles
  const ask = [...cands.values()].filter((c) => c.card.oracleId && !(c.card.oracleId in roles) && !isLand(c.card))
  for (let i = 0; i < ask.length; i += 300) {
    const batch = ask.slice(i, i + 300).map((c) => ({ oracle_id: c.card.oracleId, name: c.card.name }))
    meter.server++
    const got = await safe(api.cardRoles(batch), signal)
    if (got) Object.assign(roles, got.roles)
    else if (i === 0) notes.push({ text: 'The card functions could not be read now: the ramp, draw and removal counts may be off.' })
  }
  // As suas cartas que o EDHREC não citou ainda podem entrar, depois das citadas
  for (const o of owned?.values() ?? []) {
    const tags = roles[o.card.oracleId] ?? []
    add(o.card, tags.some((t) => ['ramp', 'fast_mana', 'draw', 'removal', 'board_wipe', 'counterspell'].includes(t)) ? 0.05 : 0.02, 0, 0)
  }
  // Pedidas pelo jogador: entram primeiro, sem olhar preço nem bracket
  const left: string[] = []
  for (const n of include) {
    const k = cardKey(n)
    const card = owned?.get(k)?.card ?? resolved.get(k)
    if (!card || !fits(card)) {
      left.push(n)
      continue
    }
    cands.set(k, { card, score: 10, theme: 1, synergy: 1, forced: true, owned: owned?.has(k) ?? false })
  }
  if (left.length) notes.push({ text: 'Left out (not found, not legal or outside the colors): {cards}', vars: { cards: left.join(', ') } })

  const tagsOf = (c: BuilderCard) => new Set(roles[c.oracleId] ?? [])
  const rolesOf = (c: BuilderCard): Set<RoleKey> => {
    const out = new Set<RoleKey>()
    if (isLand(c)) return out
    const tags = tagsOf(c)
    if (tags.has('ramp') || tags.has('fast_mana')) out.add('ramp')
    if (tags.has('draw')) out.add('draw')
    // Como na análise do deck: board wipe conta à parte, não como remoção
    if (tags.has('board_wipe')) out.add('board_wipe')
    else if (tags.has('removal') || tags.has('counterspell')) out.add('removal')
    return out
  }

  // Teto por carta: com orçamento, uma carta só não come o dinheiro do deck; com as suas cartas, as que
  // completam as vagas são baratas (o resto você já tem)
  const priceCap = budget !== null ? Math.max(3, budget * CARD_SHARE) : owned ? OWNED_FILL_CAP : Infinity
  // Com as suas cartas, as que você tem vêm antes; depois a nota
  const pool = [...cands.values()].sort((a, b) => Number(b.forced) - Number(a.forced) || Number(b.owned) - Number(a.owned) || b.score - a.score)
  const nonlandPool = pool.filter((c) => !isLand(c.card))
  const landPool = pool.filter((c) => isLand(c.card))

  // O deck em montagem e as contas que as regras olham
  const slots: Slot[] = []
  const taken = new Set<string>()
  const counts: Record<RoleKey, number> = { ramp: 0, draw: 0, removal: 0, board_wipe: 0 }
  const tally = { gc: 0, tutors: 0, five: 0, six: 0 }
  const track = (c: BuilderCard, sign: 1 | -1) => {
    for (const r of rolesOf(c)) counts[r] += sign
    if (c.gameChanger) tally.gc += sign
    if (!isLand(c) && tagsOf(c).has('tutor')) tally.tutors += sign
    if (!isLand(c) && c.cmc >= 5) tally.five += sign
    if (!isLand(c) && c.cmc >= 6) tally.six += sign
  }
  const put = (cand: Cand, qty = 1) => {
    slots.push({ cand, qty })
    taken.add(cardKey(cand.card.name))
    track(cand.card, 1)
  }
  const drop = (slot: Slot) => {
    slots.splice(slots.indexOf(slot), 1)
    taken.delete(cardKey(slot.cand.card.name))
    track(slot.cand.card, -1)
  }
  const allowed = (c: Cand, strict = true) => {
    if (taken.has(cardKey(c.card.name))) return false
    if (c.forced) return true
    if (!c.owned && (c.card.priceUsd ?? 0) > priceCap) return false
    // Com as suas cartas, terreno que você não tem não entra: o básico completa a mana de graça
    if (owned && !c.owned && isLand(c.card)) return false
    if (c.card.gameChanger && tally.gc >= GAME_CHANGERS[bracket]) return false
    if (bracket <= 2 && tagsOf(c.card).has('tutor') && tally.tutors >= 2) return false
    if (strict && !isLand(c.card) && ((c.card.cmc >= 6 && tally.six >= maxSix) || (c.card.cmc >= 5 && tally.five >= maxFive))) return false
    return true
  }
  const nonlandCount = () => slots.reduce((n, s) => n + (isLand(s.cand.card) ? 0 : s.qty), 0)
  const picked = () => commanders.length + slots.reduce((n, s) => n + s.qty, 0)
  const listNames = (cs: Cand[]) => cs.slice(0, 3).map((c) => front(c.card.name)).join(', ')

  for (const c of nonlandPool) if (c.forced) put(c)
  for (const c of landPool) if (c.forced) put(c)
  emit({ chosen: picked() })

  for (const role of ROLE_ORDER) {
    const got: Cand[] = []
    while (counts[role] < targets[role] && nonlandCount() < nonlandSlots) {
      const next = nonlandPool.find((c) => rolesOf(c.card).has(role) && allowed(c))
      if (!next) break
      put(next)
      got.push(next)
      emit({ chosen: picked() })
      await wait(30, signal)
    }
    if (got.length) emit({ note: { text: ROLE_NOTES[role], vars: { cards: listNames(got) } } })
  }
  const themeName = usedThemes.map((th) => th.name).join(' + ')
  let batch: Cand[] = []
  for (const strict of [true, false])
    for (const c of nonlandPool) {
      if (nonlandCount() >= nonlandSlots) break
      if (!allowed(c, strict)) continue
      put(c)
      batch.push(c)
      if (batch.length === 3) {
        emit({
          note: themeName
            ? { text: 'Now the {theme} cards: {cards}', vars: { theme: themeName, cards: listNames(batch) } }
            : { text: 'Now the cards that fit {name} best: {cards}', vars: { name: names, cards: listNames(batch) } },
        })
        batch = []
      }
      emit({ chosen: picked() })
      await wait(30, signal)
    }
  finish('spells')

  // 5. Os terrenos: os não básicos que a comunidade usa e os básicos pela quantidade de símbolos
  emit({ phase: 'lands', note: { text: 'Building the mana base' } })
  // Sem mágicas suficientes (poucos dados, ou só com as suas cartas): sobra mais espaço para terreno
  const landSlots = 100 - commanders.length - slots.reduce((n, s) => n + s.qty, 0)
  if (nonlandCount() < nonlandSlots)
    notes.push({ text: 'Not enough cards fit the choices: the deck has {n} extra lands.', vars: { n: nonlandSlots - nonlandCount() } })
  const nonbasicAvg = average(landPages.map((p) => p.averages.nonbasic))
  const colorCap = identity.length <= 1 ? 12 : identity.length === 2 ? 18 : 26
  const nonbasicMax = Math.min(colorCap, Math.round(nonbasicAvg ?? (identity.length <= 1 ? 6 : identity.length * 6)), landSlots)
  const landsIn = () => slots.reduce((n, s) => n + (isLand(s.cand.card) ? s.qty : 0), 0)
  for (const c of landPool) {
    if (landsIn() >= nonbasicMax) break
    if (!allowed(c)) continue
    put(c)
    emit({ chosen: picked() })
    await wait(20, signal)
  }
  const basicsNeeded = 100 - commanders.length - slots.reduce((n, s) => n + s.qty, 0)
  const pips = pipsOf([...commanders, ...slots.filter((s) => !isLand(s.cand.card)).map((s) => s.cand.card)])
  const split = splitBasics(basicsNeeded, identity, pips)
  for (const [color, qty] of Object.entries(split)) {
    if (!qty) continue
    const card = resolved.get(cardKey(BASICS[color]))
    if (!card) throw new GenError('scryfall')
    put({ card, score: 0, theme: 0, synergy: 0, forced: false, owned: true }, qty)
  }
  const nonbasics = slots.filter((s) => isLand(s.cand.card) && !isBasicLand(s.cand.card)).length
  emit({
    chosen: picked(),
    note: { text: 'Mana base: {lands} lands, {nonbasic} of them nonbasic', vars: { lands: landsIn(), nonbasic: nonbasics } },
  })
  finish('lands')

  // 6. O orçamento: troca as mais caras por mais baratas que fazem a mesma coisa
  const priceOf = (s: Slot) => (s.cand.card.priceUsd ?? 0) * s.qty
  const total = () => commanders.reduce((n, c) => n + (c.priceUsd ?? 0), 0) + slots.reduce((n, s) => n + priceOf(s), 0)
  /** Mais um básico da cor (a linha dele já existe ou é criada); false se o Scryfall não trouxe o básico */
  const addBasic = (color: string) => {
    const slot = slots.find((s) => isBasicLand(s.cand.card) && cardKey(s.cand.card.name) === cardKey(BASICS[color]))
    if (slot) slot.qty++
    else {
      const card = resolved.get(cardKey(BASICS[color]))
      if (!card) return false
      put({ card, score: 0, theme: 0, synergy: 0, forced: false, owned: true })
    }
    return true
  }
  const mainColor = () => (identity.length ? identity.reduce((a, b) => ((pips[a] ?? 0) >= (pips[b] ?? 0) ? a : b)) : 'C')
  /** Uma carta no lugar da que acabou de sair: com a mesma função se a cota ficou abaixo do mínimo */
  const replacement = (old: Cand, ok: (c: Cand) => boolean) => {
    const needs = [...rolesOf(old.card)].filter((r) => counts[r] < targets[r])
    return nonlandPool.find((c) => ok(c) && allowed(c) && needs.every((r) => rolesOf(c.card).has(r)))
  }
  if (budget !== null) {
    emit({ phase: 'budget', note: { text: 'Fitting the budget of {budget}', vars: { budget } } })
    // O orçamento é um alvo: chegar perto dele sem passar. Passou: sai primeiro a carta que menos rende por
    // dólar (nota baixa e cara) e entra a de nota maior entre as mais baratas que fazem a mesma coisa
    const worth = (s: Slot) => (s.cand.score + 0.02) / Math.max(0.01, priceOf(s))
    const stuck = new Set<string>()
    let swaps = 0
    for (let guard = 0; guard < 200 && total() > budget; guard++) {
      const victim = slots
        .filter((s) => !s.cand.forced && !isBasicLand(s.cand.card) && !stuck.has(cardKey(s.cand.card.name)) && priceOf(s) > 0.25)
        .sort((a, b) => worth(a) - worth(b))[0]
      if (!victim) break
      const old = victim.cand
      const oldPrice = old.card.priceUsd ?? 0
      if (isLand(old.card)) {
        // Terreno caro: vira um básico da cor que mais aparece nos custos
        drop(victim)
        if (!addBasic(mainColor())) {
          put(old)
          stuck.add(cardKey(old.card.name))
          continue
        }
        swaps++
        continue
      }
      const over = total() - budget
      drop(victim)
      // De preferência uma troca que já resolve; senão, uma bem mais barata
      const price = (c: Cand) => c.card.priceUsd ?? 0
      const sub =
        replacement(old, (c) => price(c) <= oldPrice - over) ??
        replacement(old, (c) => price(c) <= Math.min(oldPrice * 0.5, oldPrice - 0.5))
      if (!sub) {
        put(old)
        stuck.add(cardKey(old.card.name))
        continue
      }
      put(sub)
      swaps++
      if (swaps % 4 === 0) emit({ note: { text: 'Swapped {old} for {new}', vars: { old: front(old.card.name), new: front(sub.card.name) } } })
    }
    if (total() > budget)
      notes.push({
        text: 'The deck came out at {cost}, over the budget of {budget}: the cheapest options left would weaken it.',
        vars: { cost: Math.round(total() * 100) / 100, budget },
      })
    if (swaps) emit({ note: { text: '{n} cards swapped for cheaper ones', vars: { n: swaps } } })

    // Sobrou dinheiro: a carta de nota maior que ficou de fora (pelo teto por carta ou pela passada acima) entra
    // no lugar da de nota mais baixa do mesmo tipo (mágica por mágica, terreno por terreno), se couber no que
    // sobrou. Só troca por carta melhor: se as melhores opções forem baratas, o deck fica abaixo do orçamento
    let upgrades = 0
    const tried = new Set<string>()
    for (let guard = 0; guard < 80 && total() < budget * 0.95; guard++) {
      let swapped = false
      for (const c of pool) {
        const k = cardKey(c.card.name)
        if (c.forced || taken.has(k) || tried.has(k)) continue
        tried.add(k)
        const left = budget - total()
        const price = c.card.priceUsd ?? 0
        const out = slots
          .filter(
            (s) =>
              !s.cand.forced &&
              !isBasicLand(s.cand.card) &&
              isLand(s.cand.card) === isLand(c.card) &&
              s.cand.score < c.score &&
              price - (s.cand.card.priceUsd ?? 0) <= left,
          )
          .sort((a, b) => a.cand.score - b.cand.score)
        for (const s of out) {
          drop(s)
          const needs = [...rolesOf(s.cand.card)].filter((r) => counts[r] < targets[r])
          if (allowed(c) && needs.every((r) => rolesOf(c.card).has(r))) {
            put(c)
            swapped = true
            break
          }
          put(s.cand)
        }
        if (swapped) {
          upgrades++
          break
        }
      }
      if (!swapped) break
    }
    // Ainda sobra: troca a carta que os decks mais fortes quase não jogam pela que eles jogam bem mais, se
    // couber no que sobrou. As cartas que definem o tema (muito jogadas nos decks do tema ou de alta sinergia
    // com o comandante) ficam
    if (strong.size) {
      const strengthOf = (c: Cand) => strong.get(cardKey(c.card.name)) ?? 0
      const themed = (c: Cand) => {
        const st = stats.get(cardKey(c.card.name))
        // Sol Ring está em quase todos os decks de qualquer tema: conta o quanto o tema joga a carta a mais
        return !!st && (st.synergy >= 0.25 || (st.theme.length > 0 && Math.max(...st.theme) - st.base >= 0.15))
      }
      const upgradePool = [...cands.values()]
        .filter((c) => !c.forced && strengthOf(c) >= 0.15)
        .sort((a, b) => strengthOf(b) - strengthOf(a))
      const seen = new Set<string>()
      for (let guard = 0; guard < 80 && total() < budget * 0.95; guard++) {
        let swapped = false
        for (const c of upgradePool) {
          const k = cardKey(c.card.name)
          if (taken.has(k) || seen.has(k)) continue
          seen.add(k)
          const left = budget - total()
          const price = c.card.priceUsd ?? 0
          const out = slots
            .filter(
              (s) =>
                !s.cand.forced &&
                !isBasicLand(s.cand.card) &&
                isLand(s.cand.card) === isLand(c.card) &&
                !themed(s.cand) &&
                strengthOf(s.cand) + 0.1 < strengthOf(c) &&
                price - (s.cand.card.priceUsd ?? 0) <= left,
            )
            .sort((a, b) => strengthOf(a.cand) - strengthOf(b.cand) || a.cand.score - b.cand.score)
          for (const s of out) {
            drop(s)
            const needs = [...rolesOf(s.cand.card)].filter((r) => counts[r] < targets[r])
            if (allowed(c) && needs.every((r) => rolesOf(c.card).has(r))) {
              put(c)
              swapped = true
              break
            }
            put(s.cand)
          }
          if (swapped) {
            upgrades++
            break
          }
        }
        if (!swapped) break
      }
    }
    if (upgrades) emit({ note: { text: '{n} cards upgraded with the money left', vars: { n: upgrades } } })
  }
  finish('budget')

  // 7. O bracket: o Commander Spellbook confere Game Changers, combos, turnos extras e destruição de terrenos
  emit({ phase: 'power', note: { text: 'Checking the bracket with Commander Spellbook' } })
  const estimate = async () => {
    const list = [
      ...commanders.map((c) => ({ c, qty: 1, commander: true })),
      ...slots.map((s) => ({ c: s.cand.card, qty: s.qty, commander: false })),
    ].map(({ c, qty, commander }) => ({ name: c.name, oracle_id: c.oracleId || null, qty, cmc: c.cmc, land: isLand(c), commander }))
    meter.server++
    const res = await safe(api.deckEstimate(list), signal)
    return res && res.bracket ? { bracket: res.bracket, details: res.bracket_details ?? {} } : null
  }
  let est = await estimate()
  if (est && bracket <= 3) {
    const d = est.details
    const out = new Set<string>()
    const scoreByName = (n: string) => cands.get(cardKey(n))?.score ?? 0
    // O comandante e as cartas pedidas não saem: no combo, sai a outra peça
    const fixed = (n: string) => commanders.some((c) => cardKey(c.name) === cardKey(n)) || !!cands.get(cardKey(n))?.forced
    for (const n of d.mass_land_denial ?? []) out.add(n)
    if (bracket <= 2) {
      for (const n of [...(d.extra_turns ?? []), ...(d.game_changers ?? [])]) out.add(n)
      // Combo de 2 cartas: sai a peça que menos pesa no deck
      for (const pair of d.two_card_combos ?? [])
        out.add([...pair].sort((a, b) => Number(fixed(a)) - Number(fixed(b)) || scoreByName(a) - scoreByName(b))[0])
    } else {
      for (const n of [...(d.game_changers ?? [])].sort((a, b) => scoreByName(b) - scoreByName(a)).slice(3)) out.add(n)
      for (const n of (d.extra_turns ?? []).slice(2)) out.add(n)
    }
    const kept: string[] = []
    let changed = false
    for (const n of out) {
      const slot = slots.find((s) => cardKey(s.cand.card.name) === cardKey(n))
      if (!slot) {
        if (commanders.some((c) => cardKey(c.name) === cardKey(n))) kept.push(n)
        continue
      }
      if (slot.cand.forced) {
        kept.push(n)
        continue
      }
      drop(slot)
      const banned = new Set([...out].map(cardKey))
      const sub = isLand(slot.cand.card)
        ? undefined
        : replacement(slot.cand, (c) => !banned.has(cardKey(c.card.name)) && (budget === null || total() + (c.card.priceUsd ?? 0) <= budget))
      // Nada que sirva (ou era terreno): um básico no lugar
      if (sub) put(sub)
      else addBasic(mainColor())
      changed = true
    }
    if (kept.length) notes.push({ text: 'Kept although they raise the bracket (you asked for them, or they are the commander): {cards}', vars: { cards: kept.join(', ') } })
    if (changed) est = await estimate()
  }
  if (!est)
    notes.push({
      text:
        bracket <= 3
          ? 'Commander Spellbook did not answer, so the bracket was not checked (the Game Changers were still limited).'
          : 'Commander Spellbook did not answer, so the bracket was not checked.',
    })
  else if (est.bracket > Math.max(2, bracket))
    notes.push({ text: 'The deck came out at bracket {got}, above the {want} you asked for.', vars: { got: est.bracket, want: bracket } })
  finish('power')

  // Pronto: o deck, as cotas e o que mais define o deck
  const final = slots.map((s) => s.cand)
  const deckEntries: DeckEntry[] = slots.map((s) => ({ card: s.cand.card, qty: s.qty }))
  const maybe: DeckEntry[] = nonlandPool
    .filter((c) => !taken.has(cardKey(c.card.name)) && allowed(c, false))
    .slice(0, 10)
    .map((c) => ({ card: c.card, qty: 1 }))
  // As que definem o deck: as de mais sinergia com o comandante e as que os decks do tema jogam bem mais que
  // os outros decks dele (Sol Ring está em quase todos, então não define nada)
  const defining = (c: Cand) => {
    const s = stats.get(cardKey(c.card.name))
    return s ? s.synergy + Math.max(0, (s.theme.length ? Math.max(...s.theme) : 0) - s.base) : -1
  }
  const keyCards = final
    .filter((c) => !isLand(c.card) && !c.forced)
    .sort((a, b) => defining(b) - defining(a) || b.score - a.score)
    .slice(0, 6)
    .map((c) => c.card.name)
  const quotas: Quota[] = [
    ...ROLE_ORDER.map((key) => ({ key, target: targets[key], have: counts[key] })),
    { key: 'land' as const, target: landCount, have: slots.reduce((n, s) => n + (isLand(s.cand.card) ? s.qty : 0), 0) },
  ]
  const defaultName = `${front(commanders[0].name)}${usedThemes[0] ? ` — ${usedThemes[0].name}` : ''}`
  return {
    id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
    createdAt: Date.now(),
    answers,
    deck: { name: (answers.name.trim() || defaultName).slice(0, 100), commanders, cards: deckEntries, maybe },
    themes: usedThemes,
    price: Math.round(total() * 100) / 100,
    quotas,
    roles: Object.fromEntries(
      [...commanders, ...final.map((c) => c.card)].filter((c) => c.oracleId).map((c) => [c.oracleId, roles[c.oracleId] ?? []]),
    ),
    bracket: est?.bracket ?? null,
    bracketDetails: est?.details ?? {},
    keyCards,
    missing: owned ? final.filter((c) => !c.owned && !isBasicLand(c.card)).map((c) => c.card.name) : [],
    notes,
    sampleDecks,
    cost: { ...meter, ms: Math.round(performance.now() - started) },
  }
}
