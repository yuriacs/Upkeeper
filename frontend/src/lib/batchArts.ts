/*
 * Artes em lote no deckbuilder: as imagens de uma pasta viram as artes personalizadas das cartas
 * do deck, pelo nome do arquivo. O nome da carta vem antes do primeiro "(" ou "[", com ou sem um
 * número na frente; "[x3]" diz em quantas cópias a imagem vai (uma arte por cópia). Exemplos:
 *   "001 - Sol Ring (Behelit).png"                         → Sol Ring
 *   "046 - Shadowborn Apostle (Soldado) - arte 01 [x2].png" → Shadowborn Apostle, em 2 cópias
 *   "Behelit (Sol Ring).png"                               → Sol Ring (o nome entre parênteses também vale)
 */
import type { BuilderCard, BuilderDeck } from './deckbuilder'

export type ArtFile = { file: File; copies: number | null }
export type ArtMatch = { card: BuilderCard; qty: number; files: ArtFile[] }

/** Nome comparável: sem acento, maiúscula, pontuação e espaços repetidos */
export const normName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Nomes da carta que o arquivo pode estar dizendo (o principal primeiro) e as cópias pedidas */
export function parseArtFileName(fileName: string): { names: string[]; copies: number | null } {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '')
  const tag = base.match(/\[\s*x\s*(\d{1,2})\s*\]/i)
  const copies = tag ? Math.max(1, Number(tag[1])) : null
  const head = base
    .replace(/^\s*\d+\s*[-–_.)]\s*/, '') // "001 - "
    .split(/[([]/)[0]
  const bare = head
    .replace(/\s+[-–]\s+(arte|art|v|var|versao|versão|alt)\s*\d*\s*$/i, '') // "- arte 01" sem parênteses
    .replace(/\s+#?\d+\s*$/, '') // "Swamp 2"
  const inside = [...base.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])
  const names = [head, bare, ...inside].map((n) => n.trim()).filter(Boolean)
  return { names: [...new Set(names)], copies }
}

/**
 * Casa os arquivos com as cartas do deck (comandantes e as 99). Cada carta recebe os arquivos dela
 * na ordem do nome (001, 002...). Devolve também os que não casaram com nenhuma carta.
 */
export function matchArtFiles(files: File[], deck: BuilderDeck): { matches: ArtMatch[]; unmatched: File[] } {
  const entries = [
    ...deck.commanders.map((card) => ({ card, qty: 1 })),
    ...deck.cards.map((e) => ({ card: e.card, qty: e.qty })),
  ].filter((e) => e.card.oracleId)
  const byName = new Map<string, (typeof entries)[number]>()
  for (const e of entries) {
    const faces = [e.card.name, ...e.card.name.split(' // ')]
    for (const n of faces) if (!byName.has(normName(n))) byName.set(normName(n), e)
  }
  const found = new Map<string, ArtMatch>()
  const unmatched: File[] = []
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  for (const file of sorted) {
    const { names, copies } = parseArtFileName(file.name)
    const entry = names.map((n) => byName.get(normName(n))).find(Boolean)
    if (!entry) {
      unmatched.push(file)
      continue
    }
    const key = entry.card.oracleId
    const match = found.get(key) ?? { card: entry.card, qty: entry.qty, files: [] }
    match.files.push({ file, copies })
    found.set(key, match)
  }
  return { matches: [...found.values()], unmatched }
}

/**
 * Quantas cópias cada arte ganha, como o servidor faz na mesa (pools/services/card_art.py,
 * split_copies): se a soma pedida bate com o deck, como pedido; senão cada arte aparece ao menos
 * uma vez e o resto segue a proporção. Arquivo sem "[xN]" conta como 1.
 */
export function splitCopies(wanted: number[], quantity: number): number[] {
  const asked = wanted.map((n) => Math.max(1, n))
  if (!asked.length || quantity <= 0) return asked.map(() => 0)
  if (asked.reduce((a, b) => a + b, 0) === quantity) return asked
  if (quantity <= asked.length) return asked.map((_, i) => (i < quantity ? 1 : 0))
  const left = quantity - asked.length
  const total = asked.reduce((a, b) => a + b, 0)
  const shares = asked.map((n) => (left * n) / total)
  const extra = shares.map(Math.floor)
  const order = asked.map((_, i) => i).sort((a, b) => extra[a] - shares[a] - (extra[b] - shares[b]) || a - b)
  for (const i of order.slice(0, left - extra.reduce((a, b) => a + b, 0))) extra[i] += 1
  return asked.map((_, i) => 1 + extra[i])
}
