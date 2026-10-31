/*
 * Arquivo de deck → lista em texto (a mesma que a pessoa colaria). Lê no navegador, sem enviar nada:
 * - .txt / .dec / .dck / .mwDeck: texto ("1 Sol Ring"); o "SB:" do Magic Workstation fica de fora no servidor
 * - .dek: XML do MTGO (<Cards Quantity="1" Sideboard="false" Name="Sol Ring" />)
 * - .cod: XML do Cockatrice (<zone name="main"><card number="1" name="Sol Ring"/>)
 * - .csv: exports com colunas de quantidade e nome (ManaBox, Moxfield, Archidekt, Deckbox...)
 */

export const DECK_FILE_ACCEPT = '.txt,.dec,.dck,.dek,.cod,.csv,.mwdeck,text/plain,text/csv'
export const MAX_DECK_FILE = 512 * 1024

export type DeckFile = { name: string; decklist: string }

export async function readDeckFile(file: File): Promise<DeckFile> {
  if (file.size > MAX_DECK_FILE) throw new Error('too_big')
  const text = await file.text()
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 100)
  const trimmed = text.trimStart()
  let decklist: string
  if (ext === 'dek' || (trimmed.startsWith('<') && /<Cards\b/i.test(text))) decklist = fromMtgo(text)
  else if (ext === 'cod' || (trimmed.startsWith('<') && /<zone\b/i.test(text))) decklist = fromCockatrice(text)
  else if (ext === 'csv') decklist = fromCsv(text)
  else decklist = text.replace(/\r\n?/g, '\n').trim()
  if (!decklist.trim()) throw new Error('empty')
  return { name: base, decklist }
}

function xml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('unreadable')
  return doc
}

function fromMtgo(text: string): string {
  const main: string[] = []
  for (const c of xml(text).querySelectorAll('Cards')) {
    if (c.getAttribute('Sideboard') === 'true') continue
    const name = c.getAttribute('Name')?.trim()
    const qty = Number(c.getAttribute('Quantity') ?? 1) || 1
    if (name) main.push(`${qty} ${name}`)
  }
  return main.join('\n')
}

function fromCockatrice(text: string): string {
  const doc = xml(text)
  const deckName = doc.querySelector('deckname')?.textContent?.trim()
  const zone = (z: string) =>
    [...doc.querySelectorAll(`zone[name="${z}"] card`)].map((c) => `${Number(c.getAttribute('number') ?? 1) || 1} ${c.getAttribute('name') ?? ''}`.trim())
  // O Cockatrice guarda o comandante na zona "side" em muitos decks: não dá para saber; a prévia confere
  const parts = ['Deck', ...zone('main')]
  return (deckName ? `// ${deckName}\n` : '') + parts.join('\n')
}

/** Uma linha de CSV com aspas ("Fire // Ice", "Jace, the Mind Sculptor") */
function csvRow(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function fromCsv(text: string): string {
  const rows = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim())
  if (!rows.length) return ''
  const sep = (rows[0].match(/;/g)?.length ?? 0) > (rows[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const head = csvRow(rows[0], sep).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''))
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h))
  const qtyCol = col('count', 'quantity', 'qty', 'amount', 'quantidade')
  const nameCol = col('name', 'cardname', 'card', 'nome')
  const setCol = col('setcode', 'edition', 'set', 'editioncode')
  const numCol = col('collectornumber', 'cardnumber', 'number', 'cn')
  const boardCol = col('board', 'section', 'category', 'categories', 'zone')
  // Sem cabeçalho reconhecível: cada linha é "quantidade,nome" ou só o nome
  if (nameCol < 0) return rows.map((r) => csvRow(r, sep).filter(Boolean).join(' ')).join('\n')
  const commanders: string[] = []
  const deck: string[] = []
  const maybe: string[] = []
  for (const r of rows.slice(1)) {
    const cells = csvRow(r, sep)
    const name = cells[nameCol]
    if (!name) continue
    const qty = Number(cells[qtyCol] ?? 1) || 1
    const set = setCol >= 0 ? cells[setCol] : ''
    const num = numCol >= 0 ? cells[numCol] : ''
    // Código de edição de verdade (2 a 6 letras/números), não o nome da edição ("Commander 2021")
    const line = `${qty} ${name}` + (set && num && /^[A-Za-z0-9]{2,6}$/.test(set) ? ` (${set.toUpperCase()}) ${num}` : '')
    const board = (boardCol >= 0 ? cells[boardCol] : '').toLowerCase()
    if (/commander/.test(board)) commanders.push(line)
    else if (/maybe|consider/.test(board)) maybe.push(line)
    else if (/side|token/.test(board)) continue
    else deck.push(line)
  }
  const parts = commanders.length ? ['Commander', ...commanders, '', 'Deck', ...deck] : deck
  return [...parts, ...(maybe.length ? ['', 'Maybeboard', ...maybe] : [])].join('\n')
}
