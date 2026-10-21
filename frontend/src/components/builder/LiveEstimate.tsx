import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDown, LoaderCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDebounce } from '../../hooks/useDebounce'
import { fmtPower } from '../../lib/analysis'
import { api } from '../../lib/api'
import { BRACKET_NAMES } from '../../lib/brackets'
import { setBuilderHover } from '../../lib/builderHover'
import type { BuilderCard, BuilderDeck } from '../../lib/deckbuilder'
import { useI18n } from '../../lib/i18n'
import { BracketBadge, BracketPanel } from '../Bracket'
import DeckAnalysis from '../DeckAnalysis'

const isLand = (c: BuilderCard) => /\bLand\b/.test(c.typeLine.split(' // ')[0])

/**
 * Bracket e nível de poder enquanto o deck é montado: um pouco depois de cada mudança, a lista vai
 * para o servidor (que pergunta ao Commander Spellbook, como no deck salvo). Mostra um resumo e,
 * aberto, a mesma análise da página do deck.
 */
export function LiveEstimate({ deck }: { deck: BuilderDeck }) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const cards = useMemo(
    () => [
      ...deck.commanders.map((c) => ({ c, qty: 1, commander: true })),
      ...deck.cards.map((e) => ({ c: e.card, qty: e.qty, commander: false })),
    ],
    [deck.commanders, deck.cards],
  )
  const payload = JSON.stringify(
    cards.map(({ c, qty, commander }) => ({
      name: c.name,
      oracle_id: c.oracleId || null,
      qty,
      cmc: c.cmc,
      land: isLand(c),
      commander,
    })),
  )
  const key = useDebounce(payload, 1200)
  const estimate = useQuery({
    queryKey: ['deck-estimate', key],
    queryFn: () => api.deckEstimate(JSON.parse(key)),
    enabled: cards.length > 0 && key !== '[]',
    staleTime: Infinity,
    retry: false,
    placeholderData: keepPreviousData,
  })
  if (!cards.length) return null

  const data = estimate.data
  const updating = estimate.isFetching || key !== payload
  return (
    <section className="rounded-lg border border-line bg-surface/60">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left"
      >
        <span className="text-xs font-semibold tracking-wide text-gold uppercase">{t('Power level')}</span>
        {data ? (
          <>
            <span className="font-display text-2xl text-gold tabular-nums">{fmtPower(data.analysis.power, locale)}</span>
            <span className="text-sm text-parchment/70">{t(data.analysis.label)}</span>
            {data.bracket ? (
              <span className="flex items-center gap-1.5 text-sm text-parchment/70">
                <BracketBadge bracket={data.bracket} />
                {BRACKET_NAMES[data.bracket]}
              </span>
            ) : (
              <span className="text-xs text-parchment/40">{t('Bracket unavailable right now')}</span>
            )}
          </>
        ) : (
          <span className="text-sm text-parchment/50">{estimate.isError ? t('Could not estimate now.') : t('Estimating…')}</span>
        )}
        {updating && <LoaderCircle className="h-4 w-4 animate-spin text-parchment/40" aria-label={t('Updating…')} />}
        <span className="ml-auto flex items-center gap-1 text-xs text-parchment/50">
          {open ? t('Hide details') : t('Details')}
          <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
        </span>
      </button>
      {open && data && (
        <div className="space-y-4 border-t border-line p-3">
          <DeckAnalysis
            analysis={data.analysis}
            bracket={data.bracket}
            onCard={(name) => {
              const found = cards.find(({ c }) => c.name === name || c.name.split(' // ')[0] === name)
              if (found) setBuilderHover(found.c)
            }}
          />
          <BracketPanel bracket={data.bracket} details={data.bracket_details} />
        </div>
      )}
    </section>
  )
}
