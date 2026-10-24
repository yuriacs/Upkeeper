/*
 * Torneios (/tournaments): os abertos para inscrição, os em andamento e os últimos encerrados, e a
 * janela para criar um (chave 1v1 ou 2x2, ou liga em pods de 4 com pontos por colocação).
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthDialog } from '../components/auth/AuthDialog'
import LoadError from '../components/LoadError'
import Trophy from '../components/Trophy'
import { useTitle } from '../hooks/useTitle'
import { api, ApiError, type TournamentCreate } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n, useT } from '../lib/i18n'
import { money } from '../lib/money'
import { RULE_BRACKETS, RULE_PRICES, RULE_TUTORS } from '../lib/tableRules'
import { kindLabel, statusLabel, tournamentError } from '../lib/tournaments'
import type { TournamentSummary } from '../lib/types'

export default function TournamentsPage() {
  const t = useT()
  useTitle(t('Tournaments'))
  const { user } = useAuth()
  const { openAuth } = useAuthDialog()
  const [creating, setCreating] = useState(false)
  const list = useQuery({ queryKey: ['tournaments'], queryFn: api.tournaments, refetchInterval: 30_000 })
  const create = () => (user ? setCreating(true) : openAuth('login', { onClose: (ok) => ok && setCreating(true) }))
  const rows = list.data?.tournaments ?? []
  const section = (title: string, items: TournamentSummary[]) =>
    items.length > 0 && (
      <section className="space-y-3">
        <h2 className="font-display text-2xl text-parchment">{title}</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((tr) => (
            <li key={tr.id}>
              <TournamentCard item={tr} />
            </li>
          ))}
        </ul>
      </section>
    )

  return (
    <div className="space-y-8">
      <div className="space-y-3 text-center">
        <h1 className="font-display text-3xl text-parchment sm:text-4xl">{t('Tournaments')}</h1>
        <p className="mx-auto max-w-2xl text-parchment/70">
          {t('Knockout brackets (1v1 or 2v2) or a league of 4-player pods. Sign up, and when the organizer starts, each match opens its own table with the right players.')}
        </p>
        <button
          onClick={create}
          className="inline-block rounded-md btn-ember font-display text-xl tracking-wide px-5 py-2.5 text-ink hover:brightness-110"
        >
          {t('Create a tournament')}
        </button>
      </div>
      {list.isPending ? (
        <div className="h-40 animate-pulse rounded-xl border border-line bg-surface" />
      ) : list.isError ? (
        <LoadError error={list.error} onRetry={() => list.refetch()} retrying={list.isFetching} />
      ) : rows.length === 0 ? (
        <div className="mx-auto max-w-md space-y-3 rounded-lg border border-dashed border-line p-8 text-center">
          <Trophy className="mx-auto size-10 text-gold/60" />
          <p className="text-parchment/70">{t('No tournaments yet. Create the first one and invite your group.')}</p>
        </div>
      ) : (
        <>
          {section(t('Open for sign-up'), rows.filter((r) => r.status === 'open'))}
          {section(t('In progress'), rows.filter((r) => r.status === 'running'))}
          {section(t('Finished'), rows.filter((r) => r.status === 'finished'))}
        </>
      )}
      {creating && <NewTournamentDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function TournamentCard({ item }: { item: TournamentSummary }) {
  const t = useT()
  return (
    <Link
      to={`/tournaments/${item.id}`}
      className="block h-full space-y-2 rounded-lg border border-line bg-surface/60 p-4 transition hover:border-gold/60"
    >
      <div className="flex items-start gap-2">
        <h3 className="font-display min-w-0 flex-1 truncate text-xl text-parchment">{item.name}</h3>
        {item.joined && (
          <span className="shrink-0 rounded-full border border-gold/60 px-2 py-0.5 text-xs text-gold">{t('Signed up')}</span>
        )}
      </div>
      <p className="text-sm text-parchment/70">
        {kindLabel(t, item.kind, item.team_size)}
        {item.kind === 'league' && ` · ${t('{n} rounds', { n: item.rounds })}`}
      </p>
      <p className="flex flex-wrap gap-x-3 text-xs text-parchment/50">
        <span>{statusLabel(t, item.status, item.round)}</span>
        <span>{t('{n} signed up', { n: item.entries })}</span>
        {item.organizer && <span>{t('by {name}', { name: item.organizer })}</span>}
        {item.friends_only && <span>{t('Friends only')}</span>}
      </p>
    </Link>
  )
}

type Form = Required<Omit<TournamentCreate, 'team_size'>> & { team_size: 1 | 2 }

function NewTournamentDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { locale } = useI18n()
  const navigate = useNavigate()
  const [form, setForm] = useState<Form>({
    name: '',
    kind: 'bracket',
    team_size: 1,
    rounds: 3,
    friends_only: false,
    max_bracket: null,
    max_tutors: null,
    max_price: null,
  })
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const save = useMutation({
    mutationFn: () => api.createTournament({ ...form, name: form.name.trim() }),
    onSuccess: ({ id }) => navigate(`/tournaments/${id}`),
  })
  const seg = (active: boolean) =>
    `flex-1 px-3 py-2 text-sm font-semibold transition ${
      active ? 'bg-gold text-ink' : 'text-parchment/70 hover:bg-parchment/10 hover:text-parchment'
    }`
  const label = 'text-xs font-semibold tracking-wide text-parchment/60 uppercase'
  const choice = <K extends keyof Form>(key: K, value: Form[K], text: string) => (
    <button key={String(value)} type="button" aria-pressed={form[key] === value} onClick={() => set({ [key]: value } as Partial<Form>)} className={seg(form[key] === value)}>
      {text}
    </button>
  )
  const ruleRow = (
    title: string,
    key: 'max_bracket' | 'max_tutors' | 'max_price',
    options: readonly number[],
    text: (n: number) => string,
  ) => (
    <div className="grid items-center gap-1.5 sm:grid-cols-[7rem_minmax(0,1fr)]">
      <span className="text-sm text-parchment/80">{title}</span>
      <div className="flex overflow-hidden rounded-md border border-line">
        {[null, ...options].map((n) => choice(key, n, n === null ? t('Any') : text(n)))}
      </div>
    </div>
  )
  const mode = form.kind === 'league' ? 'league' : form.team_size === 2 ? 'pairs' : 'duel'

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-label={t('New tournament')}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (form.name.trim()) save.mutate()
        }}
        className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-y-auto rounded-xl border border-line bg-ink"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 className="font-display text-3xl">{t('New tournament')}</h2>
          <button type="button" onClick={onClose} className="ml-auto rounded-md px-2 py-1 text-parchment/60 hover:text-gold" aria-label={t('Close')}>
            ✕
          </button>
        </div>
        <div className="space-y-6 px-5 py-5">
          <label className="block space-y-1.5">
            <span className={label}>{t('Tournament name')}</span>
            <input
              autoFocus
              required
              value={form.name}
              onChange={(e) => set({ name: e.target.value.slice(0, 60) })}
              maxLength={60}
              placeholder={t('e.g. Saturday Cup')}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 focus:border-gold focus:outline-none"
            />
          </label>
          <fieldset className="space-y-2">
            <legend className={label}>{t('Format')}</legend>
            <div className="flex flex-wrap overflow-hidden rounded-md border border-line sm:flex-nowrap">
              <button type="button" aria-pressed={mode === 'duel'} onClick={() => set({ kind: 'bracket', team_size: 1 })} className={seg(mode === 'duel')}>
                {t('Bracket 1v1')}
              </button>
              <button type="button" aria-pressed={mode === 'pairs'} onClick={() => set({ kind: 'bracket', team_size: 2 })} className={seg(mode === 'pairs')}>
                {t('Bracket 2v2')}
              </button>
              <button type="button" aria-pressed={mode === 'league'} onClick={() => set({ kind: 'league', team_size: 1 })} className={seg(mode === 'league')}>
                {t('League (pods of 4)')}
              </button>
            </div>
            <p className="text-sm text-parchment/60">
              {mode === 'duel'
                ? t('Knockout: the draw sets the bracket (byes when the number doesn’t fit) and the winner of each match moves on until there is a champion.')
                : mode === 'pairs'
                  ? t('Knockout in pairs: everyone signs up alone and the pairs are drawn at the start (even number of players).')
                  : t('Each round draws pods of 4 (or 3, to make the numbers fit). At the end of each game, the finishing order scores 3/2/1/0 points.')}
            </p>
          </fieldset>
          {form.kind === 'league' && (
            <fieldset className="space-y-2">
              <legend className={label}>{t('Rounds')}</legend>
              <div className="flex overflow-hidden rounded-md border border-line">
                {[1, 2, 3, 4, 5, 6].map((n) => choice('rounds', n, String(n)))}
              </div>
              <p className="text-sm text-parchment/60">{t('Each player plays one game per round.')}</p>
            </fieldset>
          )}
          <fieldset className="space-y-2">
            <legend className={label}>{t('Deck rules')}</legend>
            {ruleRow(t('Bracket'), 'max_bracket', RULE_BRACKETS, (n) => t('up to {n}', { n }))}
            {ruleRow(t('Tutors'), 'max_tutors', RULE_TUTORS, (n) => (n === 0 ? t('none') : t('up to {n}', { n })))}
            {ruleRow(t('Deck value'), 'max_price', RULE_PRICES, (n) => t('up to {price}', { price: money(n, 'USD', locale, true) ?? '' }))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className={label}>{t('Sign-up')}</legend>
            <div className="flex overflow-hidden rounded-md border border-line">
              {choice('friends_only', false, t('Anyone'))}
              {choice('friends_only', true, t('Friends only'))}
            </div>
            <p className="text-sm text-parchment/60">
              {form.friends_only
                ? t('Only your friends see the tournament in the list and can sign up.')
                : t('Anyone with an account can sign up until you start the tournament.')}
            </p>
          </fieldset>
          {save.isError && (
            <p role="alert" className="text-sm text-red-300">
              {save.error instanceof ApiError ? tournamentError(t, save.error.message) : t('Something went wrong. Try again.')}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40">
            {t('Cancel')}
          </button>
          <button
            type="submit"
            disabled={!form.name.trim() || save.isPending}
            className="rounded-md btn-ember px-4 py-1.5 text-sm font-semibold text-ink disabled:opacity-40"
          >
            {t('Create')}
          </button>
        </div>
      </form>
    </div>
  )
}
