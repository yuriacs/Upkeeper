import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { exportDeck } from '../lib/exportDeck'
import { deckPath } from '../lib/paths'
import type { DeckSummary } from '../lib/types'
import ExportMenu from './ExportMenu'
import { useT } from '../lib/i18n'

/** Painel do "seu deck" na sala: copiar a lista em um toque e outras opções de exportação. */
export default function MyDeckPanel({ deck }: { deck: DeckSummary }) {
  const t = useT()
  const detail = useQuery({
    queryKey: ['deck', deck.kind, deck.slug],
    queryFn: () => (deck.kind === 'user' ? api.userDeck(deck.slug) : api.deck(deck.slug)),
    staleTime: Infinity,
  })
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!detail.data) return
    try {
      await navigator.clipboard.writeText(exportDeck(detail.data, 'moxfield'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* sem clipboard: o menu Exportar mostra o texto para copiar à mão */
    }
  }

  return (
    <div className="flip-in space-y-3 rounded-lg border border-parchment/25 bg-parchment/5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-lg text-parchment">{t('Your deck: {name}', { name: deck.name })}</p>
        <Link to={deckPath(deck)} className="text-sm text-parchment/60 hover:text-gold">
          {t('See full list →')}
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={copy}
          disabled={!detail.data}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-50"
        >
          {copied ? t('List copied!') : detail.isPending ? t('Loading list…') : t('Copy list')}
        </button>
        {detail.data && <ExportMenu deck={detail.data} />}
        <span className="text-xs text-parchment/40">{t('"Copy list" uses the Moxfield format.')}</span>
      </div>
    </div>
  )
}
