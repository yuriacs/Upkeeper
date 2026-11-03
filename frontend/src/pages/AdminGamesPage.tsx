import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, Eye, Flag, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import LoadError from '../components/LoadError'
import { AuthGate } from '../components/RequireAuth'
import { useDebounce } from '../hooks/useDebounce'
import { useTitle } from '../hooks/useTitle'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n, useT } from '../lib/i18n'
import type { AdminGame, AdminGameSource, AdminTable } from '../lib/types'

function Panel({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gold/70">{title}</h2>
        {note && <span className="text-xs text-parchment/45">{note}</span>}
      </div>
      {children}
    </section>
  )
}

function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'gold' | 'sky' | 'red' }) {
  const tones = {
    muted: 'bg-parchment/5 text-parchment/60',
    gold: 'bg-gold/10 text-gold',
    sky: 'bg-sky-400/10 text-sky-300',
    red: 'bg-red-500/15 text-red-300',
  }
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tones[tone]}`}>{children}</span>
}

const errorText = (t: (s: string) => string, err: unknown) => {
  const code = err instanceof ApiError ? err.message : ''
  const known: Record<string, string> = {
    not_found: 'This table is already closed.',
    bad_winner: 'That player is no longer at the table.',
    league_table: 'League tables need everyone’s placing: record the result on the tournament page.',
    finishing: 'The players are already ending this game.',
  }
  return t(known[code] ?? 'Something went wrong. Try again.')
}

/** Uma mesa aberta: quem está nela e as ações do admin (assistir, encerrar com vencedor, fechar). */
function LiveTable({ table }: { table: AdminTable }) {
  const t = useT()
  const queryClient = useQueryClient()
  const [ending, setEnding] = useState(false)
  const [winner, setWinner] = useState<number | null>(null)
  const end = useMutation({
    mutationFn: (body: Parameters<typeof api.adminEndTable>[1]) => api.adminEndTable(table.code, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tables'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'games'] })
    },
  })
  const minutes = Math.ceil(table.idle_left / 60)
  const canFinish = !table.practice && table.players.length > 0 && !table.finished
  return (
    <li className="space-y-2 rounded-lg border border-line bg-ink/40 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-sm text-parchment">{table.code}</span>
        {table.title && <span className="truncate text-sm text-parchment/70">· {table.title}</span>}
        {table.friends_only && <Badge tone="sky">{t('friends only')}</Badge>}
        {!table.allow_watch && <Badge>{t('no spectators')}</Badge>}
        {table.practice && <Badge>{t('practice')}</Badge>}
        {table.tournament && <Badge tone="gold">{t(table.tournament === 'league' ? 'league' : 'tournament')}</Badge>}
        {table.from_draw && <Badge>{t('from a deal')}</Badge>}
        {table.finished && <Badge tone="gold">{t('finished')}</Badge>}
        {!table.in_memory && <Badge>{t('saved, nobody connected')}</Badge>}
      </div>
      <p className="text-xs text-parchment/50">
        {table.started ? t('Turn {n}', { n: table.turn }) : t('Not started yet')} ·{' '}
        {t('{n} watching', { n: table.spectators })} · {t('closes in {n} min if idle', { n: minutes })}
      </p>
      {table.end_request && (
        <p className="rounded bg-gold/10 px-2 py-1 text-xs text-gold">
          {table.end_request.winner_name
            ? t('{who} asked to end the game: {winner} won', { who: table.end_request.name, winner: table.end_request.winner_name })
            : t('{who} asked to end the game with no winner', { who: table.end_request.name })}
        </p>
      )}
      <ul className="grid gap-1 sm:grid-cols-2">
        {table.players.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            {ending ? (
              <input
                type="radio"
                name={`winner-${table.code}`}
                checked={winner === p.id}
                onChange={() => setWinner(p.id)}
                aria-label={t('{name} won', { name: p.name })}
                className="accent-[#e4572e]"
              />
            ) : (
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${p.online ? 'bg-emerald-400' : 'bg-parchment/20'}`}
                title={p.online ? t('online') : t('offline')}
              />
            )}
            <Link to={`/u/${encodeURIComponent(p.name)}`} className="truncate font-medium hover:text-gold">
              {p.name}
            </Link>
            <span className="min-w-0 flex-1 truncate text-xs text-parchment/50">{p.deck ?? t('no deck yet')}</span>
            {p.life !== null && <span className="tabular-nums text-parchment/70">♥ {p.life}</span>}
          </li>
        ))}
      </ul>
      {ending ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2 text-sm">
          <label className="flex items-center gap-1.5 text-parchment/70">
            <input
              type="radio"
              name={`winner-${table.code}`}
              checked={winner === null}
              onChange={() => setWinner(null)}
              className="accent-[#e4572e]"
            />
            {t('No winner')}
          </label>
          <span className="flex-1" />
          <button
            onClick={() => {
              setEnding(false)
              end.reset()
            }}
            className="rounded-lg border border-line px-3 py-1 text-parchment/60 hover:border-parchment/40"
          >
            {t('Cancel')}
          </button>
          <button
            onClick={() => end.mutate({ action: 'finish', winner })}
            disabled={end.isPending}
            className="rounded-lg btn-ember px-3 py-1 font-semibold text-ink disabled:opacity-50"
          >
            {winner === null
              ? t('End with no winner')
              : t('End: {name} won', { name: table.players.find((p) => p.id === winner)?.name ?? '' })}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-line pt-2 text-sm">
          <Link
            to={`/table/${table.code}?watch`}
            target="_blank"
            className="flex items-center gap-1.5 rounded-lg border border-sky-400/50 px-3 py-1 text-sky-300 hover:bg-sky-400/10"
          >
            <Eye className="h-4 w-4" aria-hidden />
            {t('Watch')}
          </Link>
          {canFinish && (
            <button
              onClick={() => setEnding(true)}
              className="flex items-center gap-1.5 rounded-lg border border-gold/50 px-3 py-1 text-gold hover:bg-gold/10"
            >
              <Flag className="h-4 w-4" aria-hidden />
              {t('End the game…')}
            </button>
          )}
          <button
            onClick={() =>
              window.confirm(
                t('Close table {code} for everyone without recording a result? The players can restore the game from their history.', {
                  code: table.code,
                }),
              ) && end.mutate({ action: 'close' })
            }
            disabled={end.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1 text-parchment/60 hover:border-red-400/50 hover:text-red-300 disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden />
            {t('Close the table')}
          </button>
        </div>
      )}
      {end.isError && <p className="text-xs text-red-300">{errorText(t, end.error)}</p>}
    </li>
  )
}

function LiveTables() {
  const t = useT()
  const tables = useQuery({ queryKey: ['admin', 'tables'], queryFn: api.adminTables, refetchInterval: 10_000 })
  return (
    <Panel title={t('Open tables now')} note={t('Updates every 10 seconds.')}>
      {tables.isError ? (
        <LoadError error={tables.error} onRetry={() => tables.refetch()} retrying={tables.isFetching} />
      ) : tables.isPending ? (
        <p className="text-sm text-parchment/50">{t('Loading…')}</p>
      ) : tables.data.tables.length === 0 ? (
        <p className="text-sm text-parchment/50">{t('No open tables right now.')}</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {tables.data.tables.map((table) => (
            <LiveTable key={table.code} table={table} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Uma partida encerrada: quem jogou, com qual deck, quem ganhou; trocar o vencedor ou anular. */
function GameRow({ game }: { game: AdminGame }) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const done = () => {
    setEditing(false)
    queryClient.invalidateQueries({ queryKey: ['admin', 'games'] })
  }
  const setWinner = useMutation({ mutationFn: (entry: number) => api.adminSetWinner(game, entry), onSuccess: done })
  const annul = useMutation({ mutationFn: () => api.adminAnnulGame(game), onSuccess: done })
  const when = new Date(game.finished_at).toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <li className="space-y-1.5 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-parchment/50">
        <span>{when}</span>
        {game.turns !== null && <span>· {t('{n} turns', { n: game.turns })}</span>}
        {game.code && <span className="font-mono">· {game.code}</span>}
        <span className="flex-1" />
        <button onClick={() => setEditing((e) => !e)} className="text-gold/80 hover:text-gold">
          {editing ? t('Cancel') : t('Change winner')}
        </button>
        <button
          onClick={() =>
            window.confirm(
              t(
                game.source === 'tables'
                  ? 'Annul this game? It leaves the ranking and the players’ stats.'
                  : 'Clear the winner of this deal? It leaves the ranking and the players’ stats.',
              ),
            ) && annul.mutate()
          }
          disabled={annul.isPending}
          className="text-parchment/40 hover:text-red-300 disabled:opacity-50"
        >
          {t('Annul')}
        </button>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {game.players.map((p) => (
          <li key={p.entry}>
            <button
              disabled={!editing || p.won || setWinner.isPending}
              onClick={() => setWinner.mutate(p.entry)}
              title={editing && !p.won ? t('Make {name} the winner', { name: p.name ?? t('deleted account') }) : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm transition ${
                p.won ? 'border-gold/60 bg-gold/10 text-gold' : 'border-line text-parchment/80'
              } ${editing && !p.won ? 'cursor-pointer hover:border-gold hover:text-gold' : ''}`}
            >
              {p.won && <Crown className="h-3.5 w-3.5" aria-label={t('winner')} />}
              <span className="font-medium">{p.name ?? t('deleted account')}</span>
              {p.deck && <span className="max-w-[14rem] truncate text-xs text-parchment/50">{p.deck}</span>}
            </button>
          </li>
        ))}
      </ul>
      {editing && <p className="text-xs text-parchment/45">{t('Click the player who actually won.')}</p>}
    </li>
  )
}

function FinishedGames() {
  const { t, locale } = useI18n()
  const [source, setSource] = useState<AdminGameSource>('tables')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const q = useDebounce(search.trim(), 350)
  const games = useQuery({
    queryKey: ['admin', 'games', source, q, page],
    queryFn: () => api.adminGames(source, q, page),
    placeholderData: keepPreviousData,
  })
  const pages = games.data ? Math.max(1, Math.ceil(games.data.count / 30)) : 1
  const tab = (value: AdminGameSource, label: string) => (
    <button
      role="tab"
      aria-selected={source === value}
      onClick={() => {
        setSource(value)
        setPage(1)
      }}
      className={`rounded-full px-3 py-1 text-sm ${source === value ? 'bg-gold/15 text-gold' : 'text-parchment/60 hover:text-parchment'}`}
    >
      {t(label)}
    </button>
  )
  return (
    <Panel title={t('Finished games')}>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex gap-1">
          {tab('tables', 'Table games')}
          {tab('draws', 'Deals with a winner')}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder={t('Search by player…')}
          aria-label={t('Search by player')}
          className="min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-2 text-sm focus:border-gold focus:outline-none"
        />
      </div>
      {games.isError ? (
        <LoadError error={games.error} onRetry={() => games.refetch()} retrying={games.isFetching} />
      ) : games.isPending ? (
        <p className="text-sm text-parchment/50">{t('Loading…')}</p>
      ) : games.data.count === 0 ? (
        <p className="text-sm text-parchment/50">{t('No games found.')}</p>
      ) : (
        <ul className={`divide-y divide-line transition-opacity ${games.isPlaceholderData ? 'opacity-60' : ''}`}>
          {games.data.results.map((g) => (
            <GameRow key={`${g.source}-${g.id}`} game={g} />
          ))}
        </ul>
      )}
      {games.data && games.data.count > 0 && (
        <div className="flex items-center justify-between text-sm text-parchment/60">
          <span>{t(games.data.count === 1 ? '{n} game' : '{n} games', { n: games.data.count.toLocaleString(locale) })}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page <= 1}
              className="rounded border border-line px-2.5 py-1 hover:border-parchment/40 disabled:opacity-30"
            >
              ← {t('Previous')}
            </button>
            <span className="tabular-nums">
              {page}/{pages}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!games.data.next}
              className="rounded border border-line px-2.5 py-1 hover:border-parchment/40 disabled:opacity-30"
            >
              {t('Next')} →
            </button>
          </div>
        </div>
      )}
    </Panel>
  )
}

export default function AdminGamesPage() {
  const t = useT()
  useTitle(t('Tables and games'))
  const { user, ready } = useAuth()
  if (!ready) return null
  if (!user) return <AuthGate />
  if (!user.is_admin)
    return (
      <div className="space-y-3 py-10 text-center">
        <p className="text-parchment/70">{t('This page is only for the site’s admins.')}</p>
        <Link to="/" className="text-gold hover:underline">
          {t('Back to home')}
        </Link>
      </div>
    )
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link to="/admin" className="text-sm text-parchment/60 hover:text-gold">
          ← {t('Admin')}
        </Link>
        <h1 className="font-display text-3xl text-parchment">{t('Tables and games')}</h1>
        <p className="text-sm text-parchment/60">
          {t('Watch any table, end a game with the right winner, and fix or annul results.')}
        </p>
      </div>
      <LiveTables />
      <FinishedGames />
    </div>
  )
}
