import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import DeckRow, { WinRate } from '../components/DeckRow'
import LoadError from '../components/LoadError'
import Trophy from '../components/Trophy'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { deckPath } from '../lib/paths'
import { useAuth } from '../lib/auth'
import { useI18n, useT } from '../lib/i18n'
import { useAuthDialog } from '../components/auth/AuthDialog'
import type { MyDraw } from '../lib/types'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line bg-surface/60 px-4 py-3">
      <p className="font-display text-2xl tabular-nums text-parchment">{value}</p>
      <p className="text-xs text-parchment/55">{label}</p>
    </div>
  )
}

function ResultBadge({ result }: { result: MyDraw['result'] }) {
  const t = useT()
  if (result === 'won')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gold px-2.5 py-0.5 text-xs font-semibold text-ink">
        <Trophy className="size-3.5" /> {t('Win')}
      </span>
    )
  if (result === 'lost')
    return <span className="rounded-full border border-parchment/20 px-2.5 py-0.5 text-xs text-parchment/60">{t('Loss')}</span>
  return <span className="rounded-full border border-dashed border-parchment/20 px-2.5 py-0.5 text-xs text-parchment/40">{t('No result')}</span>
}

function DrawItem({ d }: { d: MyDraw }) {
  const { t, locale } = useI18n()
  const dateFmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' })
  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-parchment/50">
        {d.mode === 'table' ? (
          // Partida numa mesa aberta (sem sorteio): não tem página de sorteio
          <span>
            {dateFmt.format(new Date(d.created_at))} · {t('Open-table game')}
          </span>
        ) : (
          <span>
            {dateFmt.format(new Date(d.created_at))} · {d.mode === 'pool' ? t('Deck pool') : t('Precons')} ·{' '}
            <Link to={`/draw/${d.code}`} className="font-mono text-gold/70 hover:underline">
              #{d.code}
            </Link>
          </span>
        )}
        <ResultBadge result={d.result} />
      </div>
      {d.deck ? (
        <DeckRow deck={d.deck} />
      ) : (
        <p className="text-sm text-parchment/50">{t('Deck removed by its owner')}</p>
      )}
      {d.opponents.length > 0 && (
        <p className="text-sm text-parchment/60">
          <span className="text-parchment/40">{t('vs.')} </span>
          {d.opponents.map((o, i) => (
            <span key={`${o.position}-${i}`}>
              {i > 0 && <span className="text-parchment/30"> · </span>}
              <span className={o.player_name === d.winner ? 'text-gold' : ''}>
                {o.player_name}
              </span>
              {o.deck && (
                <span className="text-parchment/40">
                  {' ('}
                  {/* O deck de cada um abre a página dele (lista, análise, exportar) */}
                  <Link to={deckPath(o.deck)} className="underline-offset-2 hover:text-gold hover:underline">
                    {o.deck.name}
                  </Link>
                  {')'}
                </span>
              )}
            </span>
          ))}
        </p>
      )}
    </li>
  )
}

/** Sem conta não há histórico: explica o porquê e convida a entrar. */
function SignedOut() {
  const t = useT()
  const { openAuth } = useAuthDialog()
  useTitle(t('My history'))
  return (
    <div className="mx-auto max-w-lg space-y-6 py-6 text-center">
      <Trophy className="mx-auto size-12 text-gold/60" />
      <div className="space-y-2">
        <h1 className="font-display text-3xl text-parchment">{t('My history')}</h1>
        <p className="text-parchment/70">
          {t(
            'Your history is saved to your account: the decks you were dealt, who you played against, your wins and your best decks.',
          )}
        </p>
      </div>
      <ul className="mx-auto max-w-sm space-y-1.5 text-left text-sm text-parchment/60">
        <li>• {t('Create a free account (just a username, email and password).')}</li>
        <li>• {t('Join online rooms while signed in — every deal counts for you.')}</li>
        <li>• {t('At the end of the game, mark who won so it shows up in the stats.')}</li>
      </ul>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => openAuth('login')}
          className="rounded-md btn-ember font-display text-xl tracking-wide px-5 py-2.5 text-ink hover:brightness-110"
        >
          {t('Sign in or create account')}
        </button>
        <Link to="/ranking" className="rounded-lg border border-parchment/25 px-5 py-2.5 text-gold hover:bg-parchment/5">
          {t('See the ranking')}
        </Link>
      </div>
      <p className="text-xs text-parchment/40">
        {t('Deals made without an account still work and can be shared by link, but they don’t go into anyone’s history.')}
      </p>
    </div>
  )
}

/** Partidas da mesa virtual que dá para rever turno a turno (as mais recentes) */
function Replays() {
  const { t, locale } = useI18n()
  const replays = useQuery({ queryKey: ['my-replays'], queryFn: api.myReplays })
  const rows = replays.data?.replays ?? []
  if (!rows.length) return null
  return (
    <section className="space-y-3">
      <h2 className="text-sm text-parchment/60">{t('Games to replay')}</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface/60">
        {rows.map((r) => (
          <li key={r.id}>
            <Link to={`/replay/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-parchment/[0.04]">
              <span className="min-w-0 flex-1 truncate font-semibold">{r.players.map((p) => p.name).join(' × ')}</span>
              <span className="text-sm text-gold">{r.winner ? t('{name} won', { name: r.winner }) : t('No winner')}</span>
              <span className="text-xs text-parchment/50">
                {new Date(r.finished_at).toLocaleDateString(locale)} · {t('{n} turns', { n: r.turns })} · {r.minutes} min
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function MyDrawsPage() {
  const t = useT()
  const { user, ready } = useAuth()
  if (!ready) return <p className="text-center text-parchment/60">{t('Loading…')}</p>
  return user ? <MyDraws /> : <SignedOut />
}

function MyDraws() {
  const t = useT()
  useTitle(t('My history'))
  const stats = useQuery({ queryKey: ['my-stats'], queryFn: api.myStats })
  const draws = useInfiniteQuery({
    queryKey: ['my-draws'],
    queryFn: ({ pageParam }) => api.myDraws(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.next ? all.length + 1 : undefined),
  })
  const items = draws.data?.pages.flatMap((p) => p.results) ?? []
  const s = stats.data

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="font-display text-3xl text-parchment">{t('My history')}</h1>
        <p className="text-parchment/70">
          {t('Your games at open tables and the decks you’ve been dealt: who you played against and how it ended.')}
        </p>
      </div>

      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('deals')} value={s.draws} />
          <Stat label={t('finished games')} value={s.games} />
          <Stat label={t('wins')} value={s.wins} />
          <Stat label={t('win rate')} value={s.games ? `${Math.round(s.win_rate * 100)}%` : '—'} />
        </div>
      )}

      {s && (s.most_received.length > 0 || s.best_decks.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {s.most_received.length > 0 && (
            <section className="space-y-3 rounded-lg border border-line bg-surface/60 p-4">
              <h2 className="text-sm text-parchment/60">{t('Dealt to you the most')}</h2>
              {s.most_received.map((r) => (
                <DeckRow key={r.deck.slug} deck={r.deck}>
                  <span className="shrink-0 text-sm tabular-nums text-parchment/60">{r.times}×</span>
                </DeckRow>
              ))}
            </section>
          )}
          {s.best_decks.length > 0 && (
            <section className="space-y-3 rounded-lg border border-line bg-surface/60 p-4">
              <h2 className="text-sm text-parchment/60">{t('Your best decks')}</h2>
              {s.best_decks.map((r) => (
                <DeckRow key={r.deck.slug} deck={r.deck}>
                  <WinRate rate={r.win_rate} games={r.games} wins={r.wins} />
                </DeckRow>
              ))}
            </section>
          )}
        </div>
      )}

      <Replays />

      <section className="space-y-3">
        <h2 className="text-sm text-parchment/60">{t('History')}</h2>
        {draws.isPending ? (
          <p className="text-parchment/50">{t('Loading…')}</p>
        ) : draws.isError ? (
          <LoadError error={draws.error} onRetry={() => draws.refetch()} retrying={draws.isFetching} />
        ) : items.length === 0 ? (
          <div className="space-y-3 rounded-lg border border-line bg-surface/60 p-6 text-center text-parchment/60">
            <p>{t('You haven’t been in any deals with your account yet.')}</p>
            <p className="text-sm text-parchment/45">
              {t('Deals show up here when you join a room while signed in.')}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface/60">
            {items.map((d) => (
              <DrawItem key={`${d.code}-${d.position}`} d={d} />
            ))}
          </ul>
        )}
        {draws.hasNextPage && (
          <button
            onClick={() => draws.fetchNextPage()}
            disabled={draws.isFetchingNextPage}
            className="w-full rounded-lg border border-line py-2.5 text-sm text-gold hover:bg-parchment/5 disabled:opacity-50"
          >
            {draws.isFetchingNextPage ? t('Loading…') : t('Load more')}
          </button>
        )}
      </section>
    </div>
  )
}
