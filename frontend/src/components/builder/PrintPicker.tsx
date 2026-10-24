import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchPrints, type BuilderCard } from '../../lib/deckbuilder'
import { useI18n } from '../../lib/i18n'
import { money } from '../../lib/money'

/**
 * Escolher a edição (print) de uma carta: todas as edições em inglês, da mais barata para a mais
 * cara, com o preço de cada uma. A edição atual fica marcada.
 */
export default function PrintPicker({
  card,
  title,
  onPick,
  onClose,
}: {
  card: BuilderCard
  /** O que a escolha faz ("Adicionar ao deck", "Trocar a edição"...) */
  title: string
  onPick: (c: BuilderCard) => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const [filter, setFilter] = useState('')
  const prints = useQuery({
    queryKey: ['prints', card.oracleId],
    queryFn: ({ signal }) => fetchPrints(card.oracleId, signal),
    enabled: !!card.oracleId,
    staleTime: 10 * 60_000,
  })
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const all = prints.data ?? []
  const cheapest = all.find((c) => c.priceUsd != null)?.id
  const q = filter.trim().toLowerCase()
  const shown = q
    ? all.filter((c) => `${c.set} ${c.setName ?? ''} ${c.number}`.toLowerCase().includes(q))
    : all

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-4xl flex-col rounded-xl border border-line bg-ink"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
          <h2 className="font-display text-2xl">{title}</h2>
          <span className="min-w-0 truncate text-sm text-parchment/60">{card.name}</span>
          <button onClick={onClose} aria-label={t('Close')} className="ml-auto rounded p-1 text-parchment/60 hover:text-parchment">
            <X className="h-5 w-5" aria-hidden />
          </button>
          {all.length > 12 && (
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('Filter by set')}
              aria-label={t('Filter by set')}
              className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm focus:border-gold focus:outline-none"
            />
          )}
        </div>

        <div className="min-h-0 overflow-y-auto p-4">
          {prints.isPending && <p className="text-sm text-parchment/50">{t('Loading…')}</p>}
          {prints.isError && <p className="text-sm text-red-300">{t('Could not reach Scryfall. Try again in a moment.')}</p>}
          {prints.data && shown.length === 0 && <p className="text-sm text-parchment/50">{t('No printings found.')}</p>}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
            {shown.map((c) => {
              const current = c.id === card.id
              return (
                <li key={c.id}>
                  <button
                    onClick={() => onPick(c)}
                    title={c.setName ? `${c.setName} (${c.set}) #${c.number}` : `${c.set} #${c.number}`}
                    className={`block w-full overflow-hidden rounded-[4.5%] ring-2 transition ${
                      current ? 'ring-gold' : 'ring-transparent hover:ring-parchment/40'
                    }`}
                  >
                    <img src={c.small} alt={c.name} loading="lazy" className="aspect-[488/680] w-full bg-surface" />
                  </button>
                  <div className="mt-1 flex items-baseline gap-1 text-xs">
                    <span className="min-w-0 flex-1 truncate text-parchment/70">
                      {c.set} #{c.number}
                    </span>
                    <span className="shrink-0 font-semibold text-emerald-300 tabular-nums">
                      {c.priceUsd != null ? money(c.priceUsd, 'USD', locale) : '—'}
                    </span>
                  </div>
                  <p className="truncate text-[0.7rem] text-parchment/45">
                    {current ? <span className="text-gold">{t('Current')}</span> : c.id === cheapest ? t('Cheapest printing') : c.setName}
                  </p>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
