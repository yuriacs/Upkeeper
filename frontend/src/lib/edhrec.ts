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

type RawCard = { name: string; synergy?: number; num_decks?: number; potential_decks?: number }
type RawPage = { container?: { json_dict?: { cardlists?: { header: string; tag: string; cardviews: RawCard[] }[] } } }

async function fetchPage(slug: string): Promise<EdhrecPage | null> {
  const r = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`, { headers: { Accept: 'application/json' } })
  if (!r.ok) return null
  const d: RawPage = await r.json()
  const raw = d.container?.json_dict?.cardlists ?? []
  const lists = raw
    .filter((l) => l.tag !== 'newcards')
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
  if (!lists.length) return null
  return { slug, total: Math.max(0, ...lists.flatMap((l) => l.cards.map((c) => c.of))), lists }
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
