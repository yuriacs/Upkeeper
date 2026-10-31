/*
 * Sugestões de cartas para o deckbuilder, pelos dados públicos do EDHREC (json.edhrec.com: o mesmo
 * JSON que o site deles usa; não é uma API oficial e pode mudar). Para cada comandante, as cartas
 * mais jogadas, com a sinergia (quanto aparecem mais nos decks dele do que nos decks das mesmas
 * cores) e em quantos decks estão.
 */
import { NO_PHYREXIAN, searchCards, type BuilderCard } from './deckbuilder'

export type EdhrecCard = {
  name: string
  /** 0 a 1: quanto a carta aparece mais com este comandante do que nos decks das mesmas cores */
  synergy: number
  /** Em quantos decks do comandante ela está, de quantos */
  decks: number
  of: number
}
export type EdhrecList = { tag: string; header: string; cards: EdhrecCard[] }
export type EdhrecPage = { slug: string; total: number; lists: EdhrecList[] }

/** Nome no formato da URL do EDHREC: "Atraxa, Praetors' Voice" → "atraxa-praetors-voice" */
export function edhrecSlug(name: string): string {
  return name
    .split(' // ')[0]
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
}

type RawCard = { name: string; url?: string; synergy?: number; num_decks?: number; potential_decks?: number }
type RawList = { header: string; tag: string; cardviews: RawCard[] }
/** Médias de cartas por tipo nos decks da página (terrenos, básicos, criaturas...) */
const AVERAGE_KEYS = ['land', 'basic', 'nonbasic', 'creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'battle'] as const
export type AverageKey = (typeof AVERAGE_KEYS)[number]
type RawPage = Partial<Record<AverageKey, number>> & {
  container?: { json_dict?: { cardlists?: RawList[]; card?: { num_decks?: number } } }
  panels?: { taglinks?: { slug: string; value: string; count: number }[]; mana_curve?: Record<string, number> }
}

/** Uma página qualquer do JSON do EDHREC ("commanders/atraxa-praetors-voice/infect/budget"); null se não existir */
async function fetchRaw(path: string, signal?: AbortSignal): Promise<RawPage | null> {
  const r = await fetch(`https://json.edhrec.com/pages/${path}.json`, { headers: { Accept: 'application/json' }, signal })
  if (!r.ok) return null
  return r.json()
}

/** Listas de cartas (sem as listas de comandantes das páginas de tema e sem as novidades) */
function cardLists(d: RawPage): EdhrecList[] {
  return (d.container?.json_dict?.cardlists ?? [])
    .filter((l) => l.tag !== 'newcards' && !/commanders$/.test(l.tag))
    .map((l) => ({
      tag: l.tag,
      header: l.header,
      cards: l.cardviews.map((c) => ({
        name: c.name,
        synergy: c.synergy ?? 0,
        decks: c.num_decks ?? 0,
        of: c.potential_decks ?? 0,
      })),
    }))
    .filter((l) => l.cards.length)
}

async function fetchPage(slug: string): Promise<EdhrecPage | null> {
  const d = await fetchRaw(`commanders/${slug}`)
  const lists = d ? cardLists(d) : []
  if (!lists.length) return null
  return { slug, total: Math.max(0, ...lists.flatMap((l) => l.cards.map((c) => c.of))), lists }
}

/** Tema de deck do EDHREC ("+1/+1 Counters", slug "plus-1-plus-1-counters") e em quantos decks aparece */
export type EdhrecTheme = { slug: string; name: string; decks: number }

/** Página do EDHREC com o que o gerador de decks usa além das cartas */
export type EdhrecData = EdhrecPage & {
  /** Decks por trás da página (do comandante, do tema, do bracket...) */
  decks: number
  /** Temas do comandante, dos mais jogados para os menos (só na página principal dele) */
  themes: EdhrecTheme[]
  averages: Partial<Record<AverageKey, number>>
  /** Curva média: quantas cartas por valor de mana ("7" = 7 ou mais) */
  curve: Record<string, number>
}

/**
 * Página para o gerador: "commanders/<slug>", com "/<tema>", "/<bracket>" ou "/budget" no fim (o EDHREC
 * não junta tema e bracket na mesma página). null se não existir ou não tiver cartas.
 */
export async function fetchEdhrec(path: string, signal?: AbortSignal): Promise<EdhrecData | null> {
  const d = await fetchRaw(path, signal)
  const lists = d ? cardLists(d) : []
  if (!d || !lists.length) return null
  const total = Math.max(0, ...lists.flatMap((l) => l.cards.map((c) => c.of)))
  const averages: EdhrecData['averages'] = {}
  for (const key of AVERAGE_KEYS) if (typeof d[key] === 'number') averages[key] = d[key]
  return {
    slug: path,
    total,
    lists,
    decks: d.container?.json_dict?.card?.num_decks ?? total,
    themes: (d.panels?.taglinks ?? []).map((t) => ({ slug: t.slug, name: t.value, decks: t.count })),
    averages,
    curve: d.panels?.mana_curve ?? {},
  }
}

/** Identidade de cor (WUBRG, "" = incolor) no nome que o EDHREC usa nos endereços */
export const COLOR_SLUGS: Record<string, string> = {
  '': 'colorless', W: 'mono-white', U: 'mono-blue', B: 'mono-black', R: 'mono-red', G: 'mono-green',
  WU: 'azorius', UB: 'dimir', BR: 'rakdos', RG: 'gruul', WG: 'selesnya', WB: 'orzhov', UR: 'izzet', BG: 'golgari',
  WR: 'boros', UG: 'simic', WUB: 'esper', UBR: 'grixis', BRG: 'jund', WRG: 'naya', WUG: 'bant', WBG: 'abzan',
  WUR: 'jeskai', UBG: 'sultai', WBR: 'mardu', URG: 'temur', WUBR: 'yore-tiller', UBRG: 'glint-eye',
  WBRG: 'dune-brood', WURG: 'ink-treader', WUBG: 'witch-maw', WUBRG: 'five-color',
}

/** Todos os temas do EDHREC, dos mais jogados para os menos */
export async function fetchAllThemes(signal?: AbortSignal): Promise<EdhrecTheme[]> {
  const d = await fetchRaw('tags', signal)
  const list = d?.container?.json_dict?.cardlists?.[0]?.cardviews ?? []
  return list
    .map((c) => ({ slug: (c.url ?? '').replace(/^\/tags\//, ''), name: c.name, decks: c.num_decks ?? 0 }))
    .filter((t) => t.slug && !t.slug.includes('/'))
}

export type EdhrecCommander = { name: string; decks: number }

/**
 * Comandantes mais jogados de uma página: "tags/dragons/rakdos" (tema nessas cores), "tags/dragons",
 * "commanders/rakdos" (cores) ou "commanders/year" (os mais jogados dos últimos 2 anos).
 */
export async function fetchCommanders(path: string, signal?: AbortSignal): Promise<EdhrecCommander[]> {
  const d = await fetchRaw(path, signal)
  const lists = d?.container?.json_dict?.cardlists ?? []
  const list = lists.find((l) => /commanders$/.test(l.tag) && l.tag !== 'newcommanders') ?? lists[0]
  return (list?.cardviews ?? []).map((c) => ({ name: c.name, decks: c.num_decks ?? 0 }))
}

/** Página do comandante (ou da dupla de comandantes; se a dupla não tiver página, a do primeiro) */
export async function fetchSuggestions(commanders: string[]): Promise<EdhrecPage | null> {
  const slugs = commanders.map(edhrecSlug).filter(Boolean)
  if (!slugs.length) return null
  if (slugs.length > 1) {
    const pair = await fetchPage([...slugs].sort().join('-'))
    if (pair) return pair
  }
  return fetchPage(slugs[0])
}

/** As cartas de várias listas numa só, sem repetir, das de maior sinergia para as de menor */
export function bySynergy(lists: EdhrecList[]): EdhrecCard[] {
  const seen = new Map<string, EdhrecCard>()
  for (const l of lists) for (const c of l.cards) if (!seen.has(c.name)) seen.set(c.name, c)
  return [...seen.values()].sort((a, b) => b.synergy - a.synergy)
}

/** Nomes por busca no Scryfall ("!"A" or !"B" ..."): cabe na URL */
const NAMES_PER_QUERY = 12

/**
 * As cartas sugeridas no formato do deckbuilder (imagem, preço, oracle id), na edição mais barata
 * de cada uma. Buscas de 12 nomes por vez, uma depois da outra (a busca do Scryfall pede calma).
 */
export async function resolveCards(names: string[], signal?: AbortSignal): Promise<Map<string, BuilderCard>> {
  const out = new Map<string, BuilderCard>()
  for (let i = 0; i < names.length; i += NAMES_PER_QUERY) {
    const batch = names.slice(i, i + NAMES_PER_QUERY)
    const q = `(${batch.map((n) => `!"${n.replace(/"/g, '')}"`).join(' or ')}) prefer:usd-low ${NO_PHYREXIAN}`
    const page = await searchCards(q, signal).catch(() => null)
    for (const c of page?.cards ?? []) out.set(c.name, c)
    // Cartas de duas faces: o EDHREC às vezes usa só o nome da frente
    for (const c of page?.cards ?? []) out.set(c.name.split(' // ')[0], c)
    if (i + NAMES_PER_QUERY < names.length) await new Promise((r) => setTimeout(r, 300))
  }
  return out
}
