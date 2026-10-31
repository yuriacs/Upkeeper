import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { monthLabel } from '../lib/duration'
import { useI18n } from '../lib/i18n'
import SupporterBadge from './SupporterBadge'
import Trophy from './Trophy'
import { WinRate } from './DeckRow'

/**
 * Temporada do mês no Ranking: quem mais ganhou partidas no mês (sorteios e mesas, todos os
 * tamanhos) e os campeões dos meses anteriores, que também aparecem no perfil.
 */
export default function SeasonBoard() {
  const { t, locale } = useI18n()
  const season = useQuery({ queryKey: ['season'], queryFn: () => api.season() })
  if (!season.data) return null
  const s = season.data
  const last = s.champions[0]
  return (
    <section className="space-y-4 rounded-lg border border-gold/30 bg-gold/[0.04] p-4 text-left">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-xl text-parchment">
            {t('Season of {month}', { month: monthLabel(s.month, locale) })}
          </h2>
          <p className="text-xs text-parchment/50">
            {t('Wins this month, adding deals and tables. At the end of the month, whoever won the most (at least {n} wins) becomes the champion, shown on their profile.', { n: s.min_wins })}
          </p>
        </div>
        {last && (
          <p className="flex items-center gap-1.5 text-sm text-parchment/70">
            <Trophy className="size-4 text-gold" />
            {t('Champion of {month}:', { month: monthLabel(last.month, locale) })}{' '}
            <Link to={`/u/${encodeURIComponent(last.username)}`} className="font-semibold text-gold hover:underline">
              {last.username}
            </Link>
            <span className="text-parchment/45">({t('{n} wins', { n: last.wins })})</span>
          </p>
        )}
      </div>
      {s.players.length === 0 ? (
        <p className="py-2 text-center text-sm text-parchment/40">{t('No wins this month yet.')}</p>
      ) : (
        <ol className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {s.players.slice(0, 6).map((p, i) => (
            <li key={p.username} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-right text-sm text-parchment/40 tabular-nums">{i + 1}</span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-medium">
                <Link to={`/u/${encodeURIComponent(p.username)}`} className={`truncate hover:text-gold ${p.supporter ? 'text-gold' : ''}`}>
                  {p.username}
                </Link>
                {p.supporter && <SupporterBadge />}
              </span>
              <WinRate rate={p.win_rate} games={p.games} wins={p.wins} />
            </li>
          ))}
        </ol>
      )}
      {s.champions.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-parchment/55 hover:text-parchment">{t('Past champions')}</summary>
          <ul className="mt-2 space-y-1">
            {s.champions.map((c) => (
              <li key={c.month} className="flex items-center gap-2 text-parchment/70">
                <span className="w-40 shrink-0 capitalize text-parchment/50">{monthLabel(c.month, locale)}</span>
                <Link to={`/u/${encodeURIComponent(c.username)}`} className="truncate hover:text-gold">
                  {c.username}
                </Link>
                <span className="ml-auto text-xs text-parchment/45 tabular-nums">{t('{n} wins', { n: c.wins })}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
