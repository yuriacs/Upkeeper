import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import DeckRow, { WinRate } from '../components/DeckRow'
import LoadError from '../components/LoadError'
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
        <li key={r.deck.slug} className="flex items-center gap-3">
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

export default function RankingPage() {
  const t = useT()
  useTitle(t('Ranking'))
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats })

  if (stats.isPending) return <p className="text-center text-parchment/60">{t('Counting the wins…')}</p>
  if (stats.isError) return <LoadError error={stats.error} onRetry={() => stats.refetch()} retrying={stats.isFetching} />
  const s = stats.data
  const min = t('At least {n} games.', { n: s.min_games })

  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl text-parchment sm:text-4xl">{t('Ranking')}</h1>
        <p className="mx-auto max-w-xl text-parchment/70">
          {t('After each game, someone at the table marks who won. Everything marked counts here:')}{' '}
          <strong className="text-parchment">{s.games}</strong> {s.games === 1 ? t('game so far.') : t('games so far.')}
        </p>
      </div>

      {s.games === 0 ? (
        <div className="mx-auto max-w-md space-y-4 rounded-lg border border-line bg-surface/60 p-6 text-center">
          <Trophy className="mx-auto size-10 text-gold/60" />
          <p className="text-parchment/70">
            {t('No results yet. Deal the decks, play, and at the end mark the winner on the deal page or in the room.')}
          </p>
          <Link to="/sortear" className="inline-block rounded-md btn-ember font-display text-xl tracking-wide px-5 py-2.5 text-ink hover:brightness-110">
            {t('Deal now')}
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Board title={t('Most wins')} hint={t('Precons that won the most games.')} empty={!s.most_wins.length}>
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
          <Board title={t('Players')} hint={`${t('Only players with an account.')} ${min}`} empty={!s.players.length}>
            <ol className="space-y-3">
              {s.players.map((p, i) => (
                <li key={p.username} className="flex items-center gap-3">
                  <span className="w-5 shrink-0 text-right text-sm tabular-nums text-parchment/40">{i + 1}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-medium">
                    {i === 0 && <Trophy className="size-4 shrink-0 text-gold" />}
                    {p.username}
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
