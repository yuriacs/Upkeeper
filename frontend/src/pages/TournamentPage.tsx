/*
 * Página de um torneio (/tournaments/:id): inscrição, a chave (eliminatória) ou a classificação e
 * as rodadas da liga, e o link para a mesa de cada partida. O organizador começa o torneio, tira
 * inscritos (W.O. na chave) e marca ou corrige resultados.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuthDialog } from '../components/auth/AuthDialog'
import LoadError from '../components/LoadError'
import Trophy from '../components/Trophy'
import { useTitle } from '../hooks/useTitle'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n, useT } from '../lib/i18n'
import { ruleChips } from '../lib/tableRules'
import { kindLabel, placeLabel, roundName, statusLabel, tournamentError } from '../lib/tournaments'
import type { TournamentDetail, TournamentEntry, TournamentMatch } from '../lib/types'

const btn = 'rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40 disabled:opacity-40'
const primary = 'rounded-md btn-ember px-4 py-1.5 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-40'

export default function TournamentPage() {
  const { id = '' } = useParams()
  const t = useT()
  const { locale } = useI18n()
  const { user } = useAuth()
  const { openAuth } = useAuthDialog()
  const navigate = useNavigate()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['tournament', id], queryFn: () => api.tournament(id), refetchInterval: 15_000 })
  const tr = query.data
  useTitle(tr?.name ?? t('Tournaments'))
  const [editing, setEditing] = useState<TournamentMatch | null>(null)
  const act = useMutation({
    mutationFn: (run: () => Promise<TournamentDetail>) => run(),
    onSuccess: (data) => {
      client.setQueryData(['tournament', id], data)
      client.invalidateQueries({ queryKey: ['tournaments'] })
    },
  })
  const remove = useMutation({
    mutationFn: (pk: number) => api.deleteTournament(pk),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['tournaments'] })
      navigate('/tournaments')
    },
  })

  if (query.isPending) return <p className="text-center text-parchment/60">{t('Loading the tournament…')}</p>
  if (query.isError || !tr) return <LoadError error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />

  const byId = new Map(tr.entries.map((e) => [e.id, e]))
  const champion = tr.champion != null ? byId.get(tr.champion) : undefined
  const chips = [
    kindLabel(t, tr.kind, tr.team_size),
    tr.kind === 'league' ? t('{n} rounds', { n: tr.rounds }) : '',
    tr.friends_only ? t('Friends only') : '',
    ...ruleChips(t, tr.rules, locale),
  ].filter(Boolean)
  const run = (fn: () => Promise<TournamentDetail>) => act.mutate(fn)
  const error = act.error ?? remove.error

  return (
    <div className="space-y-8">
      <div className="space-y-3 text-center">
        <Link to="/tournaments" className="text-sm text-parchment/50 hover:text-gold">
          ← {t('Tournaments')}
        </Link>
        <h1 className="font-display text-3xl text-parchment sm:text-4xl">{tr.name}</h1>
        <p className="flex flex-wrap justify-center gap-2">
          {chips.map((c) => (
            <span key={c} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-parchment/70">
              {c}
            </span>
          ))}
        </p>
        <p className="text-sm text-parchment/60">
          {tr.status === 'running' && tr.kind === 'bracket' ? roundName(t, tr.round, tr.rounds) : statusLabel(t, tr.status, tr.round)}
          {tr.organizer && ` · ${t('organized by {name}', { name: tr.organizer })}`}
        </p>
      </div>

      {champion && (
        <div className="mx-auto flex max-w-md items-center justify-center gap-3 rounded-xl border border-gold/60 bg-gold/10 p-4">
          <Trophy className="size-8 text-gold" />
          <div>
            <p className="text-xs tracking-wide text-gold uppercase">{t('Champion')}</p>
            <p className="font-display text-2xl text-parchment">{champion.name}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {tr.your_match && (
          <Link to={`/table/${tr.your_match}`} className="rounded-md btn-ember font-display text-xl tracking-wide px-5 py-2.5 text-ink hover:brightness-110">
            {t('Play your match')}
          </Link>
        )}
        {tr.status === 'open' && !tr.you && (
          <button
            className={primary}
            disabled={act.isPending || (!!user && !tr.can_join)}
            onClick={() => (user ? run(() => api.tournamentAction(tr.id, 'join')) : openAuth('login'))}
          >
            {t('Sign up')}
          </button>
        )}
        {tr.you != null && tr.status !== 'finished' && !byId.get(tr.you)?.dropped && (
          <button
            className={btn}
            disabled={act.isPending}
            onClick={() =>
              (tr.status === 'open' || confirm(t('Leave the tournament? Your open match counts as a loss.'))) &&
              run(() => api.tournamentAction(tr.id, 'leave'))
            }
          >
            {tr.status === 'open' ? t('Cancel sign-up') : t('Leave the tournament')}
          </button>
        )}
        {tr.can_manage && tr.status === 'open' && (
          <button className={primary} disabled={act.isPending} onClick={() => run(() => api.tournamentAction(tr.id, 'start'))}>
            {t('Start the tournament')}
          </button>
        )}
        {tr.can_manage && (
          <button
            className={`${btn} hover:border-red-400/60 hover:text-red-300`}
            disabled={remove.isPending}
            onClick={() => confirm(t('Delete this tournament for everyone?')) && remove.mutate(tr.id)}
          >
            {t('Delete')}
          </button>
        )}
      </div>
      {tr.status === 'open' && user && !tr.you && !tr.can_join && (
        <p className="text-center text-sm text-parchment/60">{t('Only friends of the organizer can sign up.')}</p>
      )}
      {error && (
        <p role="alert" className="text-center text-sm text-red-300">
          {error instanceof ApiError ? tournamentError(t, error.message) : t('Something went wrong. Try again.')}
        </p>
      )}

      {tr.status === 'open' ? (
        <Entries tr={tr} onDrop={(e) => run(() => api.dropEntry(tr.id, e.id))} />
      ) : tr.kind === 'bracket' ? (
        <Bracket tr={tr} byId={byId} onEdit={setEditing} />
      ) : (
        <League tr={tr} byId={byId} onEdit={setEditing} />
      )}
      {tr.status !== 'open' && (
        <Entries tr={tr} onDrop={(e) => confirm(t('Remove {name} from the tournament?', { name: e.name })) && run(() => api.dropEntry(tr.id, e.id))} />
      )}

      {editing && (
        <ResultDialog
          tr={tr}
          match={editing}
          byId={byId}
          onClose={() => setEditing(null)}
          onSave={(order) => {
            run(() => api.matchResult(tr.id, editing.id, order))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function Entries({ tr, onDrop }: { tr: TournamentDetail; onDrop: (e: TournamentEntry) => void }) {
  const t = useT()
  return (
    <section className="mx-auto max-w-3xl space-y-3 rounded-lg border border-line bg-surface/60 p-4">
      <h2 className="font-display text-xl text-parchment">
        {tr.team_size === 2 && tr.status !== 'open' ? t('Pairs') : t('Players')} ({tr.entries.length})
      </h2>
      {tr.status === 'open' && (
        <p className="text-xs text-parchment/50">
          {tr.kind === 'league'
            ? t('When the organizer starts, the first round’s pods are drawn.')
            : tr.team_size === 2
              ? t('When the organizer starts, the pairs and the bracket are drawn.')
              : t('When the organizer starts, the bracket is drawn.')}
        </p>
      )}
      {tr.entries.length === 0 ? (
        <p className="py-2 text-sm text-parchment/40">{t('Nobody signed up yet.')}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {tr.entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm">
              <span className={`min-w-0 flex-1 truncate ${e.dropped ? 'text-parchment/40 line-through' : ''} ${e.you ? 'text-gold' : ''}`}>
                {e.name}
              </span>
              {e.dropped && <span className="text-xs text-parchment/40">{t('left')}</span>}
              {tr.can_manage && !e.dropped && tr.status !== 'finished' && (
                <button onClick={() => onDrop(e)} className="text-xs text-parchment/50 hover:text-red-300" aria-label={t('Remove {name} from the tournament?', { name: e.name })}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Link para a mesa da partida: jogar (quem está nela) ou assistir */
function TableLink({ tr, match }: { tr: TournamentDetail; match: TournamentMatch }) {
  const t = useT()
  if (!match.code || match.done || tr.status !== 'running') return null
  const mine = tr.you != null && match.seats.some((s) => s.entry === tr.you)
  return (
    <Link
      to={mine ? `/table/${match.code}` : `/table/${match.code}?watch`}
      className={mine ? 'text-xs font-semibold text-gold hover:underline' : 'text-xs text-parchment/60 hover:text-gold'}
    >
      {mine ? t('Play') : t('Watch')}
    </Link>
  )
}

function Bracket({
  tr,
  byId,
  onEdit,
}: {
  tr: TournamentDetail
  byId: Map<number, TournamentEntry>
  onEdit: (m: TournamentMatch) => void
}) {
  const t = useT()
  const rounds = Array.from({ length: tr.rounds }, (_, i) => tr.matches.filter((m) => m.round === i + 1))
  return (
    <section className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-6">
        {rounds.map((matches, i) => (
          <div key={i} className="flex w-60 flex-col">
            <h3 className="mb-3 text-center text-xs font-semibold tracking-wide text-parchment/60 uppercase">
              {roundName(t, i + 1, tr.rounds)}
            </h3>
            <ul className="flex flex-1 flex-col justify-around gap-3">
              {matches.map((m) => {
                const side = (n: number) => m.seats.find((s) => s.side === n)
                const row = (n: number) => {
                  const seat = side(n)
                  const entry = seat ? byId.get(seat.entry) : undefined
                  const won = m.done && seat && m.winner === seat.entry
                  return (
                    <div className={`flex items-center gap-2 px-3 py-1.5 text-sm ${won ? 'font-semibold text-gold' : m.done ? 'text-parchment/45' : ''}`}>
                      <span className={`min-w-0 flex-1 truncate ${entry?.you ? 'underline decoration-gold/60' : ''}`}>
                        {entry ? entry.name : m.bye ? t('bye') : '—'}
                      </span>
                      {won && <Trophy className="size-3.5 shrink-0" />}
                    </div>
                  )
                }
                return (
                  <li key={m.id} className="rounded-lg border border-line bg-surface/60">
                    {row(0)}
                    <div className="border-t border-line/60" />
                    {row(1)}
                    {!m.bye && (m.code || m.done) && (
                      <div className="flex items-center gap-3 border-t border-line/60 px-3 py-1">
                        <TableLink tr={tr} match={m} />
                        {tr.can_manage && m.seats.length === 2 && (
                          <button onClick={() => onEdit(m)} className="ml-auto text-xs text-parchment/50 hover:text-gold">
                            {m.done ? t('Change result') : t('Set result')}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

function League({
  tr,
  byId,
  onEdit,
}: {
  tr: TournamentDetail
  byId: Map<number, TournamentEntry>
  onEdit: (m: TournamentMatch) => void
}) {
  const t = useT()
  const rounds = [...new Set(tr.matches.map((m) => m.round))].sort((a, b) => b - a)
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="space-y-3 rounded-lg border border-line bg-surface/60 p-4">
        <div>
          <h2 className="font-display text-xl text-parchment">{t('Standings')}</h2>
          <p className="text-xs text-parchment/50">
            {t('Points per game: 1st {a}, 2nd {b}, 3rd {c}, 4th 0. Ties: more wins, then fewer games.', {
              a: tr.points[0],
              b: tr.points[1],
              c: tr.points[2],
            })}
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-parchment/50">
            <tr>
              <th className="w-6 py-1 text-right font-normal">#</th>
              <th className="py-1 pl-3 text-left font-normal">{t('Player')}</th>
              <th className="py-1 text-right font-normal">{t('Pts')}</th>
              <th className="py-1 text-right font-normal">{t('Wins')}</th>
              <th className="py-1 text-right font-normal">{t('Games')}</th>
            </tr>
          </thead>
          <tbody>
            {(tr.standings ?? []).map((row, i) => {
              const e = byId.get(row.entry)
              return (
                <tr key={row.entry} className="border-t border-line/60">
                  <td className="py-1.5 text-right tabular-nums text-parchment/40">{i + 1}</td>
                  <td className={`truncate py-1.5 pl-3 ${e?.you ? 'text-gold' : ''} ${e?.dropped ? 'text-parchment/40 line-through' : ''}`}>
                    {e?.name}
                  </td>
                  <td className="py-1.5 text-right font-semibold tabular-nums text-gold">{row.points}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.wins}</td>
                  <td className="py-1.5 text-right tabular-nums text-parchment/60">{row.games}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
      <section className="space-y-5">
        {rounds.map((r) => (
          <div key={r} className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide text-parchment/60 uppercase">
              {t('Round {n}', { n: r })} / {tr.rounds}
            </h3>
            <ul className="grid gap-3 sm:grid-cols-2">
              {tr.matches
                .filter((m) => m.round === r)
                .map((m) => {
                  const seats = [...m.seats].sort((a, b) => (a.place ?? 99) - (b.place ?? 99) || a.side - b.side)
                  return (
                    <li key={m.id} className="rounded-lg border border-line bg-surface/60">
                      <p className="px-3 pt-2 text-xs text-parchment/50">{t('Pod {n}', { n: m.slot + 1 })}</p>
                      <ol className="px-3 py-1.5">
                        {seats.map((s) => {
                          const e = byId.get(s.entry)
                          return (
                            <li key={s.entry} className={`flex items-center gap-2 py-0.5 text-sm ${s.place === 1 ? 'font-semibold text-gold' : ''}`}>
                              <span className="w-8 shrink-0 text-xs text-parchment/50">
                                {m.done ? (s.place ? placeLabel(t, s.place) : '—') : ''}
                              </span>
                              <span className={`min-w-0 flex-1 truncate ${e?.you ? 'underline decoration-gold/60' : ''}`}>{e?.name}</span>
                              {m.done && <span className="text-xs tabular-nums text-parchment/50">+{s.place ? (tr.points[s.place - 1] ?? 0) : 0}</span>}
                            </li>
                          )
                        })}
                      </ol>
                      <div className="flex items-center gap-3 border-t border-line/60 px-3 py-1">
                        <TableLink tr={tr} match={m} />
                        {m.done && !tr.can_manage && <span className="text-xs text-parchment/40">{t('Finished')}</span>}
                        {tr.can_manage && (
                          <button onClick={() => onEdit(m)} className="ml-auto text-xs text-parchment/50 hover:text-gold">
                            {m.done ? t('Change result') : t('Set result')}
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}

/**
 * Organizador: resultado da partida. Chave: quem venceu. Liga: clicar nos jogadores na ordem de
 * chegada (quem ficar de fora não apareceu e não pontua).
 */
function ResultDialog({
  tr,
  match,
  byId,
  onSave,
  onClose,
}: {
  tr: TournamentDetail
  match: TournamentMatch
  byId: Map<number, TournamentEntry>
  onSave: (order: number[]) => void
  onClose: () => void
}) {
  const t = useT()
  const league = tr.kind === 'league'
  const [order, setOrder] = useState<number[]>([])
  const toggle = (id: number) =>
    setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : league ? [...o, id] : [id]))
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('Set result')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-xl border border-line bg-ink p-5"
      >
        <h2 className="font-display text-2xl">{t('Set result')}</h2>
        <p className="text-sm text-parchment/60">
          {league
            ? t('Click the players in finishing order, starting with the winner. Anyone left out didn’t show up and scores nothing.')
            : t('Who won? A player who didn’t show up loses by walkover.')}
        </p>
        <ul className="space-y-2">
          {match.seats.map((s) => {
            const at = order.indexOf(s.entry)
            return (
              <li key={s.entry}>
                <button
                  onClick={() => toggle(s.entry)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                    at >= 0 ? 'border-gold bg-gold/10' : 'border-line hover:border-parchment/40'
                  }`}
                >
                  <span className="w-8 text-sm text-gold">{at >= 0 ? (league ? placeLabel(t, at + 1) : '🏆') : ''}</span>
                  <span className="font-semibold">{byId.get(s.entry)?.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btn}>
            {t('Cancel')}
          </button>
          <button disabled={order.length === 0} onClick={() => onSave(order)} className={primary}>
            {t('Save result')}
          </button>
        </div>
      </div>
    </div>
  )
}
