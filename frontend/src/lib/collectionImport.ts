/*
 * Lê a coleção exportada de outros serviços e devolve as linhas para o servidor
 * (/api/me/collection/import/, em lotes). Reconhece o CSV pelo cabeçalho, então qualquer serviço
 * com colunas de nome e quantidade funciona; os conhecidos:
 *   ManaBox:      Name, Set code, Collector number, Foil, Quantity, Scryfall ID...
 *   Moxfield:     Count, Name, Edition, Foil, Collector Number...
 *   Archidekt:    Quantity, Name, Finish, Edition Code, Scryfall ID, Collector Number...
 *   Deckbox:      Count, Name, Edition, Card Number, Foil...
 *   Dragon Shield: Quantity, Card Name, Set Code, Card Number, Printing...
 * Sem cabeçalho reconhecível: lista de texto, uma carta por linha ("2 Sol Ring (CMM) 410 *F*").
 */

export type CollectionRow = {
  quantity: number
  name: string
  set?: string
  number?: string
  scryfall_id?: string
  foil?: boolean
}

export type ParsedCollection = {
  rows: CollectionRow[]
  /** De onde parece ter vindo (só para mostrar) */
  source: 'manabox' | 'moxfield' | 'archidekt' | 'deckbox' | 'dragonshield' | 'csv' | 'text'
  /** Linhas que não deu para ler */
  skipped: number
  /** Cópias somadas */
  copies: number
}

const ALIASES: Record<keyof CollectionRow | 'finish', string[]> = {
  quantity: ['quantity', 'count', 'qty', 'amount', 'copies', 'have'],
  name: ['name', 'card name', 'card', 'cardname', 'card_name'],
  set: ['set code', 'edition code', 'set', 'setcode', 'set_code', 'edition', 'expansion code'],
  number: ['collector number', 'card number', 'collector_number', 'number', 'cn', 'collector #', 'col #'],
  scryfall_id: ['scryfall id', 'scryfall_id', 'scryfallid', 'scryfall uuid'],
  foil: ['foil', 'is foil', 'foil/etched'],
  finish: ['finish', 'printing', 'treatment'],
}

/** Separa uma linha de CSV respeitando aspas ("Nome, com vírgula") */
function splitCsv(line: string, sep: string): string[] {
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

/** Linhas do CSV (campos com quebra de linha entre aspas ficam juntos) */
function csvLines(text: string): string[] {
  const lines: string[] = []
  let cur = ''
  let quotes = 0
  for (const raw of text.split(/\r?\n/)) {
    cur = cur ? `${cur}\n${raw}` : raw
    quotes += (raw.match(/"/g) ?? []).length
    if (quotes % 2 === 0) {
      lines.push(cur)
      cur = ''
      quotes = 0
    }
  }
  if (cur) lines.push(cur)
  return lines.filter((l) => l.trim())
}

const truthy = (v: string) => /^(1|true|yes|sim|foil|etched|y)$/i.test(v.trim())

function detectSource(headers: string[]): ParsedCollection['source'] {
  const h = new Set(headers)
  if (h.has('manabox id') || (h.has('set code') && h.has('scryfall id') && h.has('purchase price currency'))) return 'manabox'
  if (h.has('tradelist count') && h.has('card number')) return 'deckbox'
  if (h.has('tradelist count')) return 'moxfield'
  if (h.has('edition code') || (h.has('finish') && h.has('scryfall id'))) return 'archidekt'
  if (h.has('card name') && h.has('printing')) return 'dragonshield'
  return 'csv'
}

function parseCsv(lines: string[]): ParsedCollection | null {
  // Algumas exportações (Dragon Shield) trazem uma linha "sep=," antes do cabeçalho
  let start = 0
  let sep = ','
  const m = /^sep=(.)$/i.exec(lines[0]?.trim() ?? '')
  if (m) {
    sep = m[1]
    start = 1
  } else {
    const first = lines[0] ?? ''
    const counts = [',', ';', '\t'].map((s) => [s, splitCsv(first, s).length] as const)
    sep = counts.sort((a, b) => b[1] - a[1])[0][0]
  }
  const headers = splitCsv(lines[start] ?? '', sep).map((h) => h.toLowerCase().replace(/^﻿/, '').trim())
  const col = (key: keyof typeof ALIASES) => {
    for (const alias of ALIASES[key]) {
      const i = headers.indexOf(alias)
      if (i >= 0) return i
    }
    return -1
  }
  const iName = col('name')
  if (iName < 0) return null
  const iQty = col('quantity')
  const iSet = col('set')
  const iNum = col('number')
  const iId = col('scryfall_id')
  const iFoil = col('foil')
  const iFinish = col('finish')
  const rows: CollectionRow[] = []
  let skipped = 0
  for (const line of lines.slice(start + 1)) {
    const f = splitCsv(line, sep)
    const name = (f[iName] ?? '').trim()
    if (!name) {
      skipped++
      continue
    }
    const qty = iQty >= 0 ? Number.parseInt(f[iQty] ?? '', 10) : 1
    if (!Number.isFinite(qty) || qty <= 0) {
      skipped++
      continue
    }
    const finish = iFinish >= 0 ? (f[iFinish] ?? '') : ''
    const setRaw = iSet >= 0 ? (f[iSet] ?? '').trim() : ''
    rows.push({
      quantity: qty,
      name,
      // "Edition" às vezes é o nome da edição (Deckbox): só vale como código se for curto
      set: setRaw && setRaw.length <= 6 && !setRaw.includes(' ') ? setRaw : undefined,
      number: iNum >= 0 ? (f[iNum] ?? '').trim() || undefined : undefined,
      scryfall_id: iId >= 0 ? (f[iId] ?? '').trim() || undefined : undefined,
      foil: (iFoil >= 0 && truthy(f[iFoil] ?? '')) || /foil|etched/i.test(finish),
    })
  }
  return { rows, source: detectSource(headers), skipped, copies: 0 }
}

// "2 Sol Ring", "2x Sol Ring (CMM) 410", "Sol Ring [CMM]", "1 Sol Ring (CMM) 410 *F*"
const TEXT_LINE = /^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+[([]([A-Za-z0-9]{2,6})[)\]](?:\s+([A-Za-z0-9★-]+))?)?(\s+\*[FE]\*)?\s*$/

function parseText(lines: string[]): ParsedCollection {
  const rows: CollectionRow[] = []
  let skipped = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || /^(\/\/|#)/.test(line) || /^(sideboard|deck|commander|maybeboard)\b:?$/i.test(line)) continue
    const m = TEXT_LINE.exec(line)
    if (!m) {
      skipped++
      continue
    }
    rows.push({
      quantity: m[1] ? Number.parseInt(m[1], 10) : 1,
      name: m[2].trim(),
      set: m[3]?.toLowerCase(),
      number: m[4],
      foil: !!m[5],
    })
  }
  return { rows, source: 'text', skipped, copies: 0 }
}

/** Junta linhas iguais (mesma impressão e acabamento) e soma as cópias */
function merge(rows: CollectionRow[]): CollectionRow[] {
  const by = new Map<string, CollectionRow>()
  for (const r of rows) {
    const key = [r.scryfall_id ?? '', r.set ?? '', r.number ?? '', r.name.toLowerCase(), r.foil ? 'f' : ''].join('|')
    const prev = by.get(key)
    if (prev) prev.quantity += r.quantity
    else by.set(key, { ...r })
  }
  return [...by.values()]
}

export function parseCollection(text: string): ParsedCollection {
  const lines = csvLines(text)
  const header = /^sep=.$/i.test(lines[0]?.trim() ?? '') ? (lines[1] ?? '') : (lines[0] ?? '')
  const looksCsv = lines.length > 1 && /[,;\t]/.test(header) && /name|card/i.test(header)
  const parsed = (looksCsv && parseCsv(lines)) || parseText(lines)
  const rows = merge(parsed.rows)
  return { ...parsed, rows, copies: rows.reduce((n, r) => n + r.quantity, 0) }
}

export const SOURCE_LABEL: Record<ParsedCollection['source'], string> = {
  manabox: 'ManaBox',
  moxfield: 'Moxfield',
  archidekt: 'Archidekt',
  deckbox: 'Deckbox',
  dragonshield: 'Dragon Shield',
  csv: 'CSV',
  text: 'Text',
}

/** Lotes que o servidor aceita por pedido */
export const IMPORT_BATCH = 400
