import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import DeckRow, { WinRate } from '../components/DeckRow'
import LoadError from '../components/LoadError'
import SupporterBadge from '../components/SupporterBadge'
import Trophy from '../components/Trophy'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import type { DeckRanking } from '../lib/types'

function Board({ title, hint, children, empty }: { title: string; hint: string; children: ReactNode; empty: boolean }) {
  const t = useT()
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface/60 p-4">
      <div>
        <h2 className="font-display text-xl text-parchment">{title}</h2>
        <p className="text-xs text-parchment/50">{hint}</p>
      </div>
      {empty ? <p className="py-4 text-center text-sm text-parchment/40">{t('Not enough games yet.')}</p> : children}
    </section>
  )
}

function DeckList({ rows, show }: { rows: DeckRanking[]; show: 'wins' | 'rate' }) {
  const t = useT()
  return (
    <ol className="space-y-3">
      {rows.map((r, i) => (
        <li key={`${r.deck.kind}-${r.deck.slug}`} className="flex items-center gap-3">
          <span className="w-5 shrink-0 text-right text-sm tabular-nums text-parchment/40">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <DeckRow deck={r.deck}>
              {show === 'wins' ? (
                <p className="w-24 shrink-0 text-right text-sm tabular-nums">
                  <span className="font-semibold text-gold">{r.wins}</span>{' '}
                  <span className="text-xs text-parchment/45">
                    {r.wins === 1 ? t('win') : t('wins')}
                  </span>
                </p>
              ) : (
                <WinRate rate={r.win_rate} games={r.games} wins={r.wins} />
              )}
            </DeckRow>
          </div>
        </li>
      ))}
    </ol>
  )
}

type Source = 'draws' | 'tables'
/** Rankings por quantidade de jogadores na partida (4 = 4 ou mais); null = todas */
const SIZES = [null, 2, 3, 4] as const
type Size = (typeof SIZES)[number]

/**
 * Rankings separados: partidas de decks sorteados (o vencedor é marcado no sorteio, na sala ou
 * na mesa que veio do sorteio) e partidas de mesas abertas sem sorteio ("Encerrar partida").
 */
export default function RankingPage() {
  const t = useT()
  useTitle(t('Ranking'))
  const [params, setParams] = useSearchParams()
  const source: Source = params.get('tipo') === 'mesas' ? 'tables' : 'draws'
  const size: Size = SIZES.find((n) => n !== null && String(n) === params.get('jogadores')) ?? null
  const go = (s: Source, n: Size) =>
    setParams({ ...(s === 'tables' ? { tipo: 'mesas' } : {}), ...(n ? { jogadores: String(n) } : {}) }, { replace: true })
  const setSource = (s: Source) => go(s, size)
  const stats = useQuery({ queryKey: ['stats', source, size], queryFn: () => api.stats(source, size) })
  const sizeChip = (n: Size) => (
    <button
      key={n ?? 'all'}
      role="tab"
      aria-selected={size === n}
      onClick={() => go(source, n)}
      className={`rounded-md px-3 py-1 text-xs font-semibold tracking-wide transition ${
        size === n ? 'bg-parchment/15 text-parchment' : 'text-parchment/50 hover:text-parchment'
      }`}
    >
      {n === null ? t('All games') : t('{n} players', { n: n === 4 ? '4+' : n })}
    </button>
  )
  const tab = (s: Source, label: string) => (
    <button
      role="tab"
      aria-selected={source === s}
      onClick={() => setSource(s)}
      className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
        source === s ? 'border-gold bg-gold/15 text-gold' : 'border-line text-parchment/60 hover:text-parchment'
      }`}
    >
      {label}
    </button>
  )
  const header = (
    <div className="space-y-4 text-center">
      <h1 className="font-display text-3xl text-parchment sm:text-4xl">{t('Ranking')}</h1>
      <div role="tablist" aria-label={t('Ranking')} className="flex flex-wrap justify-center gap-2">
        {tab('draws', t('Dealt decks'))}
        {tab('tables', t('Table games'))}
      </div>
      <div
        role="tablist"
        aria-label={t('Players per game')}
        className="mx-auto flex w-fit flex-wrap justify-center gap-1 rounded-lg border border-line bg-surface/60 p-1"
      >
        {SIZES.map(sizeChip)}
      </div>
    </div>
  )

  if (stats.isPending)
    return (
      <div className="space-y-8">
        {header}
        <p className="text-center text-parchment/60">{t('Counting the wins…')}</p>
      </div>
    )
  if (stats.isError) return <LoadError error={stats.error} onRetry={() => stats.refetch()} retrying={stats.isFetching} />
  const s = stats.data
  const min = t('At least {n} games.', { n: s.min_games })

  return (
    <div className="space-y-8">
      {header}
      <p className="mx-auto max-w-xl text-center text-parchment/70">
        {source === 'tables'
          ? t('Games at tables opened without a deal. Whoever ends the game marks the winner. Games counted:')
          : t('After each game, someone at the table marks who won. Everything marked counts here:')}{' '}
        <strong className="text-parchment">{s.games}</strong> {s.games === 1 ? t('game so far.') : t('games so far.')}
      </p>

      {s.games === 0 ? (
        <div className="mx-auto max-w-md space-y-4 rounded-lg border border-line bg-surface/60 p-6 text-center">
          <Trophy className="mx-auto size-10 text-gold/60" />
          {source === 'tables' ? (
            <>
              <p className="text-parchment/70">
                {t('No results yet. Open a table, play, and at the end use “End game” to mark the winner.')}
              </p>
              <Link to="/?nova=1" className="inline-block rounded-md btn-ember font-display text-xl tracking-wide px-5 py-2.5 text-ink hover:brightness-110">
                {t('Open a new table')}
              </Link>
            </>
          ) : (
            <>
              <p className="text-parchment/70">
                {t('No results yet. Deal the decks, play, and at the end mark the winner on the deal page or in the room.')}
              </p>
              <Link to="/draw" className="inline-block rounded-md btn-ember font-display text-xl tracking-wide px-5 py-2.5 text-ink hover:brightness-110">
                {t('Deal now')}
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Board title={t('Most wins')} hint={t('Precons and pool decks that won the most games.')} empty={!s.most_wins.length}>
            <DeckList rows={s.most_wins} show="wins" />
          </Board>
          <Board title={t('Best win rate')} hint={`${t('Most wins per game played.')} ${min}`} empty={!s.best_rate.length}>
            <DeckList rows={s.best_rate} show="rate" />
          </Board>
          <Board
            title={t('Unluckiest')}
            hint={`${t('Below the table’s average win rate.')} ${min}`}
            empty={!s.unlucky.length}
          >
            <DeckList rows={s.unlucky} show="rate" />
          </Board>
          <Board title={t('Players')} hint={`${t('Only players with an account.')} ${t('Ordered by wins.')}`} empty={!s.players.length}>
            <ol className="space-y-3">
              {s.players.map((p, i) => (
                <li key={p.username} className="flex items-center gap-3">
                  <span className="w-5 shrink-0 text-right text-sm tabular-nums text-parchment/40">{i + 1}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-medium">
                    {i === 0 && <Trophy className="size-4 shrink-0 text-gold" />}
                    <Link
                      to={`/u/${encodeURIComponent(p.username)}`}
                      className={`truncate hover:text-gold ${p.supporter ? 'text-gold' : ''}`}
                    >
                      {p.username}
                    </Link>
                    {p.supporter && <SupporterBadge />}
                  </span>
                  <WinRate rate={p.win_rate} games={p.games} wins={p.wins} />
                </li>
              ))}
            </ol>
          </Board>
        </div>
      )}
    </div>
  )
}
