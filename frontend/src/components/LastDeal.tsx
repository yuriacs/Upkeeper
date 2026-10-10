import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import DeckTile from './DeckTile'

/**
 * Último sorteio feito neste navegador, ao lado do formulário da página inicial.
 * Sem sorteio ainda: mostra os espaços da mesa vazios.
 */
export default function LastDeal({ code }: { code: string | null }) {
  const t = useT()
  const deal = useQuery({
    queryKey: ['draw', code],
    queryFn: () => api.getDraw(code!),
    enabled: !!code,
    staleTime: 60_000,
    retry: false,
  })
  const entries = deal.data?.entries ?? []

  return (
    <section className="space-y-4">
      <h2 className="flex items-baseline justify-between gap-3 border-b-2 border-parchment pb-1.5 font-display text-2xl text-parchment">
        <span>{entries.length ? t('Last deal · #{code}', { code: code!.toUpperCase() }) : t('Dealt')}</span>
        {entries.length > 0 && (
          <Link
            to={`/sorteio/${code}`}
            className="font-sans text-sm font-semibold normal-case text-gold hover:underline"
          >
            {t('Open')}
          </Link>
        )}
      </h2>
      {entries.length ? (
        <div
          className={`grid grid-cols-2 gap-3 ${entries.length === 3 ? 'sm:grid-cols-3' : entries.length === 2 ? '' : 'sm:grid-cols-4'}`}
        >
          {entries.map((e) =>
            e.deck ? (
              <DeckTile key={e.position} deck={e.deck} label={e.player_name} showOwned={false} />
            ) : (
              <div key={e.position} className="aspect-[3/4] rounded-lg border border-dashed border-line" />
            ),
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden>
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="flex aspect-[3/4] flex-col justify-end rounded-lg border border-dashed border-line p-3"
            >
              <span className="font-display text-3xl text-parchment/15">{n}</span>
            </div>
          ))}
          <p className="col-span-full text-sm text-parchment/45">{t('Your deal shows up here.')}</p>
        </div>
      )}
    </section>
  )
}
