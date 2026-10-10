import type { Card, DeckCard, DeckDetail } from './types'

export type ExportFormat = 'archidekt' | 'moxfield' | 'plaintext'

// label e hint em inglês: traduzidos com t() na hora de renderizar (ExportMenu)
export const EXPORT_FORMATS: { value: ExportFormat; label: string; hint: string; importUrl?: string }[] = [
  {
    value: 'archidekt',
    label: 'Archidekt',
    hint: 'On Archidekt: create a deck, use "Import" → paste the text.',
    importUrl: 'https://archidekt.com/',
  },
  {
    value: 'moxfield',
    label: 'Moxfield',
    hint: 'On Moxfield: "Create Deck" → "Import" → paste the text.',
    importUrl: 'https://moxfield.com/',
  },
  { value: 'plaintext', label: 'Plain text', hint: 'One card per line, accepted by most sites and apps.' },
]

// Cartas divididas usam o nome completo ("Fire // Ice"); as de duas faces, só a frente.
const FULL_NAME_LAYOUTS = new Set(['split', 'aftermath'])

export function exportName(card: Card): string {
  if (FULL_NAME_LAYOUTS.has(card.layout) || !card.name.includes(' // ')) return card.name
  return card.name.split(' // ')[0]
}

function printing(card: Card, lower = false) {
  if (!card.set_code) return ''
  const set = lower ? card.set_code.toLowerCase() : card.set_code.toUpperCase()
  return ` (${set})${card.collector_number ? ` ${card.collector_number}` : ''}`
}

function mainCards(deck: DeckDetail): DeckCard[] {
  return deck.sections.flatMap((s) => s.cards)
}

export function exportDeck(deck: DeckDetail, format: ExportFormat): string {
  const commanders = deck.commanders
  const main = mainCards(deck)

  switch (format) {
    case 'archidekt': {
      // 1x Sol Ring (cmr) 472 [Commander{top}]
      const line = ({ quantity, card }: DeckCard, category?: string) =>
        `${quantity}x ${exportName(card)}${printing(card, true)}${category ? ` [${category}]` : ''}`
      return [...commanders.map((dc) => line(dc, 'Commander{top}')), ...main.map((dc) => line(dc))].join('\n')
    }
    case 'moxfield': {
      // Formato com seções, igual ao exportado pelo próprio Moxfield/MTG Arena
      const line = ({ quantity, card }: DeckCard) => `${quantity} ${exportName(card)}${printing(card)}`
      return ['Commander', ...commanders.map(line), '', 'Deck', ...main.map(line)].join('\n')
    }
    case 'plaintext': {
      const line = ({ quantity, card }: DeckCard) => `${quantity} ${exportName(card)}`
      return [...commanders.map(line), '', ...main.map(line)].join('\n')
    }
  }
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
