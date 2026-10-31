/*
 * "Descreva seu deck" sem a IA: lê na frase as cores, o orçamento, o nível de poder, os temas (pelos
 * nomes do EDHREC e alguns apelidos em português) e as palavras que podem ser o nome do comandante.
 * Com a IA ligada (backend pools/generator.py), quem lê a frase é ela; isto fica de reserva.
 */
import { COLORS, searchCards, type BuilderCard } from './deckbuilder'
import { COLOR_SLUGS, type EdhrecTheme } from './edhrec'

const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

const COLOR_WORDS: [RegExp, string][] = [
  [/\b(white|brancos?|brancas?)\b/, 'W'],
  [/\b(blue|azul|azuis)\b/, 'U'],
  [/\b(black|pretos?|pretas?|negros?|negras?)\b/, 'B'],
  [/\b(red|vermelhos?|vermelhas?)\b/, 'R'],
  [/\b(green|verdes?)\b/, 'G'],
]

/** Apelidos em português dos temas mais comuns → nome do tema no EDHREC */
const PT_THEMES: [RegExp, string][] = [
  [/\bfichas?\b/, 'Tokens'],
  [/\baristocrat/, 'Aristocrats'],
  [/\bsacrific/, 'Sacrifice'],
  [/\+1\/\+1/, '+1/+1 Counters'],
  [/\bmagicas?\b|\bfeiticos?\b|\binstantaneas?\b/, 'Spellslinger'],
  [/\bdragao\b|\bdragoes\b/, 'Dragons'],
  [/\belfos?\b/, 'Elves'],
  [/\bzumbis?\b/, 'Zombies'],
  [/\bvampiros?\b/, 'Vampires'],
  [/\banjos?\b/, 'Angels'],
  [/\bdemonios?\b/, 'Demons'],
  [/\bpiratas?\b/, 'Pirates'],
  [/\bdinossauros?\b|\bdinos\b/, 'Dinosaurs'],
  [/\bgatos?\b/, 'Cats'],
  [/\bcachorros?\b|\bcaes\b/, 'Dogs'],
  [/\bsoldados?\b/, 'Soldiers'],
  [/\bguerreiros?\b/, 'Warriors'],
  [/\bmagos?\b/, 'Wizards'],
  [/\bladinos?\b/, 'Rogues'],
  [/\bespiritos?\b/, 'Spirits'],
  [/\bhumanos?\b/, 'Humans'],
  [/\bcavaleiros?\b/, 'Knights'],
  [/\bpassaros?\b|\baves\b/, 'Birds'],
  [/\bratos?\b/, 'Rats'],
  [/\besquilos?\b/, 'Squirrels'],
  [/\bsapos?\b/, 'Frogs'],
  [/\bcoelhos?\b/, 'Rabbits'],
  [/\bhidras?\b/, 'Hydras'],
  [/\bganh(o|ar) de vida\b|\bganhar vida\b/, 'Lifegain'],
  [/\breanima|\bcemiterio\b/, 'Reanimator'],
  [/\bartefatos?\b/, 'Artifacts'],
  [/\bencantamentos?\b/, 'Enchantress'],
  [/\bequipamentos?\b/, 'Equipment'],
  [/\bterrenos?\b/, 'Landfall'],
  [/\bcontrole\b/, 'Control'],
  [/\bmoer\b|\bmoinho\b/, 'Mill'],
  [/\bveneno\b/, 'Infect'],
  [/\btesouros?\b/, 'Treasure'],
  [/\bclones?\b|\bcopias?\b/, 'Clones'],
  [/\bvoadores?\b|\bvoar\b/, 'Flying'],
  [/\bdescarte\b/, 'Discard'],
  [/\bpolitica\b/, 'Politics'],
  [/\btribal\b/, 'Tribal'],
]

/** Cotação aproximada para quem escreve o orçamento em reais (o site mostra os preços em US$) */
const BRL_PER_USD = 5.5

export type ReadDescription = {
  colors: string[] | null
  themes: EdhrecTheme[]
  budget: number | null | undefined
  bracket: number | null
  /** Palavras que podem ser o nome do comandante (para buscar no Scryfall) */
  words: string[]
}

const STOP = new Set(
  'quero queria gostaria preciso deck decks commander comandante para com sem uma umas uns que mais muito muita bem bom boa jogar jogo cartas carta cores want would like need with without that this some very good play cards build make please'.split(' '),
)

/** Lê a frase (inglês ou português). `budget` undefined = a frase não falou de orçamento */
export function readDescription(text: string, allThemes: EdhrecTheme[]): ReadDescription {
  const t = plain(text)
  let colors: string[] | null = null
  const found = new Set<string>()
  for (const [re, c] of COLOR_WORDS) if (re.test(t)) found.add(c)
  for (const [key, slug] of Object.entries(COLOR_SLUGS))
    if (slug.length > 4 && !slug.startsWith('mono') && new RegExp(`\\b${escape(slug)}\\b`).test(t)) for (const c of key) found.add(c)
  if (found.size) colors = COLORS.filter((c) => found.has(c))
  else if (/\b(colorless|incolor|incolores)\b/.test(t)) colors = []

  let budget: number | null | undefined
  const usd = /(?:us\$|\$|usd)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:dolares|dollars|usd|bucks)\b/.exec(t)
  const brl = /r\$\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:reais|brl)\b/.exec(t)
  const num = (m: RegExpExecArray) => Number((m[1] ?? m[2]).replace(',', '.'))
  if (brl) budget = Math.max(20, Math.round(num(brl) / BRL_PER_USD / 10) * 10)
  else if (usd) budget = Math.max(20, Math.round(num(usd)))
  else if (/\b(sem limite|sem orcamento|no budget|no limit|unlimited|caro|expensive)\b/.test(t)) budget = null
  else if (/\b(barato|baratinho|budget|economico|cheap|pouco dinheiro)\b/.test(t)) budget = 100

  let bracket: number | null = null
  if (/\bcedh\b/.test(t)) bracket = 5
  else if (/\b(high power|alto poder|otimizad|optimized|competitiv|tryhard|forte)/.test(t)) bracket = 4
  else if (/\b(upgraded|melhorad|mid power|medio|intermediari)/.test(t)) bracket = 3
  else if (/\b(casual|precon|iniciante|beginner|leve)/.test(t)) bracket = 2
  else if (/\b(jank|tematic|thematic|exhibition|zoeira|so pela diversao|just for fun)/.test(t)) bracket = 1

  const byName = new Map(allThemes.map((th) => [plain(th.name), th]))
  const themes = new Map<string, EdhrecTheme>()
  // Nomes do EDHREC (os mais longos antes: "+1/+1 Counters" ganha de "Counters"), no singular ou plural
  for (const th of [...allThemes].sort((a, b) => b.name.length - a.name.length)) {
    const name = plain(th.name)
    if (name.length < 4) continue
    const stem = name.replace(/s$/, '')
    if (new RegExp(`(^|[^a-z])${escape(stem)}s?($|[^a-z])`).test(t) && ![...themes.keys()].some((k) => k.includes(name)))
      themes.set(name, th)
  }
  for (const [re, en] of PT_THEMES) {
    const th = byName.get(plain(en))
    if (th && re.test(t)) themes.set(plain(en), th)
  }

  // Comandante: palavras com maiúscula (fora o começo da frase) e as que vêm depois de "deck da/do", "with"...
  const words: string[] = []
  const tokens = text.split(/\s+/)
  tokens.forEach((w, i) => {
    const clean = w.replace(/[^\p{L}'-]/gu, '')
    if (clean.length < 4 || STOP.has(plain(clean))) return
    const after = i > 0 && /^(da|do|de|dos|das|with|of|commander|comandante)$/i.test(tokens[i - 1])
    if ((i > 0 && /^\p{Lu}/u.test(clean)) || after) words.push(clean)
  })
  return {
    colors,
    themes: [...themes.values()].sort((a, b) => b.decks - a.decks).slice(0, 3),
    budget,
    bracket,
    words: [...new Set(words)].slice(0, 3),
  }
}

/** Tema do EDHREC pelo nome que a IA escreveu ("Dragon", "tokens", "+1/+1 counters"); undefined se não houver */
export function themeByName(name: string, allThemes: EdhrecTheme[]): EdhrecTheme | undefined {
  const want = plain(name).replace(/s$/, '')
  return allThemes.find((th) => plain(th.name).replace(/s$/, '') === want)
}

/** O comandante mais jogado cujo nome tem a palavra ("atraxa" → Atraxa, Praetors' Voice); null se nenhuma bater */
export async function findCommander(words: string[], colors: string[] | null, signal?: AbortSignal): Promise<BuilderCard | null> {
  for (const w of words) {
    const id = colors === null ? '' : ` id=${colors.join('').toLowerCase() || 'c'}`
    const page = await searchCards(`is:commander legal:commander name:"${w.replace(/"/g, '')}"${id}`, signal).catch(() => null)
    if (page?.cards[0]) return page.cards[0]
  }
  return null
}
