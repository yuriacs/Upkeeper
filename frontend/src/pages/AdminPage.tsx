import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AuthGate } from '../components/RequireAuth'
import { FounderBadge } from '../components/SupporterBadge'
import DayBars from '../components/DayBars'
import LoadError from '../components/LoadError'
import { useDebounce } from '../hooks/useDebounce'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n, useT, type Vars } from '../lib/i18n'
import { formatReais, parseReais } from '../lib/pix'
import type { AdminDonation, AdminReport, AdminSupporter, AdminUser, AdminUserOrdering } from '../lib/types'

function ago(iso: string | null, locale: string, t: (text: string, vars?: Vars) => string): string {
  if (!iso) return t('never')
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000)
  if (days === 0) return t('today')
  if (Math.abs(days) < 30) return rtf.format(days, 'day')
  if (Math.abs(days) < 365) return rtf.format(Math.round(days / 30), 'month')
  return rtf.format(Math.round(days / 365), 'year')
}

function Tile({ label, value, note }: { label: string; value: number; note?: ReactNode }) {
  const { locale } = useI18n()
  return (
    <div className="rounded-lg border border-line bg-surface/60 px-4 py-3">
      <p className="font-display text-3xl tabular-nums text-parchment">{value.toLocaleString(locale)}</p>
      <p className="text-sm text-parchment/70">{label}</p>
      {note && <p className="mt-0.5 text-xs text-parchment/45">{note}</p>}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gold/70">{title}</h2>
      {children}
    </section>
  )
}

const ORDER_OPTIONS: { value: AdminUserOrdering; label: string }[] = [
  { value: 'recent', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'last_login', label: 'Last seen' },
  { value: 'username', label: 'Name (A–Z)' },
  { value: 'draws', label: 'Most deals' },
  { value: 'wins', label: 'Most wins' },
  { value: 'pool', label: 'Largest deck pool' },
]

function UserRow({ u }: { u: AdminUser }) {
  const { t, locale } = useI18n()
  const dateFmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' })
  return (
    <tr className="align-top">
      <td className="px-3 py-2.5">
        <p className="font-medium">
          {u.username}
          {u.is_admin && <span className="ml-1.5 rounded bg-parchment/5 px-1.5 py-0.5 text-[10px] text-gold">admin</span>}
        </p>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-parchment/70">{dateFmt.format(new Date(u.date_joined))}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-parchment/70" title={u.last_login ?? undefined}>
        {ago(u.last_login, locale, t)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums" title={t('{precons} marked precons, {decks} imported decks', { precons: u.precons, decks: u.decks })}>
        {u.precons + u.decks}
        <span className="block text-[11px] text-parchment/40">
          {t('{precons}p · {decks}i', { precons: u.precons, decks: u.decks })}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{u.draws}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {u.games ? (
          <>
            {u.wins}/{u.games}
            <span className="block text-[11px] text-parchment/40">{Math.round((u.wins / u.games) * 100)}%</span>
          </>
        ) : (
          <span className="text-parchment/30">—</span>
        )}
      </td>
    </tr>
  )
}

function Users() {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState('')
  const [ordering, setOrdering] = useState<AdminUserOrdering>('recent')
  const [page, setPage] = useState(1)
  const q = useDebounce(search.trim(), 350)
  const users = useQuery({
    queryKey: ['admin', 'users', q, ordering, page],
    queryFn: () => api.adminUsers(q, ordering, page),
    placeholderData: keepPreviousData,
  })
  const pages = users.data ? Math.max(1, Math.ceil(users.data.count / 25)) : 1

  return (
    <Panel title={t('Accounts')}>
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder={t('Search by username…')}
          aria-label={t('Search accounts')}
          className="min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-2 text-sm focus:border-gold focus:outline-none"
        />
        <select
          value={ordering}
          onChange={(e) => {
            setOrdering(e.target.value as AdminUserOrdering)
            setPage(1)
          }}
          aria-label={t('Sort accounts')}
          className="rounded-lg border border-line bg-ink px-3 py-2 text-sm focus:border-gold focus:outline-none"
        >
          {ORDER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
      </div>

      {users.isError ? (
        <LoadError error={users.error} onRetry={() => users.refetch()} retrying={users.isFetching} />
      ) : (
        <div className={`overflow-x-auto transition-opacity ${users.isPlaceholderData ? 'opacity-60' : ''}`}>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-parchment/45">
              <tr className="border-b border-line">
                <th className="px-3 py-2 font-normal">{t('Account')}</th>
                <th className="px-3 py-2 font-normal">{t('Created')}</th>
                <th className="px-3 py-2 font-normal">{t('Last seen')}</th>
                <th className="px-3 py-2 text-right font-normal">{t('Deck pool')}</th>
                <th className="px-3 py-2 text-right font-normal">{t('Deals')}</th>
                <th className="px-3 py-2 text-right font-normal">{t('Wins')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.data?.results.map((u) => <UserRow key={u.id} u={u} />)}
            </tbody>
          </table>
          {users.isPending && <p className="py-6 text-center text-parchment/50">{t('Loading…')}</p>}
          {users.data?.count === 0 && <p className="py-6 text-center text-parchment/50">{t('No accounts found.')}</p>}
        </div>
      )}

      {users.data && users.data.count > 0 && (
        <div className="flex items-center justify-between text-sm text-parchment/60">
          <span>
            {t(users.data.count === 1 ? '{n} account' : '{n} accounts', { n: users.data.count.toLocaleString(locale) })}
          </span>
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
              disabled={!users.data.next}
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

/** Uma imagem denunciada: esconder (com ou sem bloquear novos envios da conta) ou descartar. */
function ReportRow({ r }: { r: AdminReport }) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const [block, setBlock] = useState(false)
  const done = () => queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] })
  const resolve = useMutation({
    mutationFn: (action: 'hide' | 'dismiss') => api.resolveReport(r.key, action, action === 'hide' && block),
    onSuccess: done,
  })
  const unblock = useMutation({ mutationFn: () => api.unblockUploads(r.owner), onSuccess: done })
  const btn = 'rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50'
  return (
    <li className="flex flex-wrap items-start gap-4 py-3">
      <a href={r.url} target="_blank" rel="noreferrer" className="shrink-0">
        <img
          src={r.url}
          alt=""
          className={
            r.kind === 'avatar'
              ? 'h-20 w-20 rounded-full object-cover'
              : r.kind === 'playmat'
                ? 'aspect-video h-24 rounded-md object-cover'
                : 'h-28 rounded-[4.75%]'
          }
        />
      </a>
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p>
          <span className="text-parchment/60">
            {r.kind === 'avatar'
              ? t('Profile photo')
              : r.kind === 'playmat'
                ? t('Battlefield background')
                : r.kind === 'sleeve'
                  ? t('Sleeve with your image')
                  : t('Custom art')}
          </span>
          {' · '}
          <Link to={`/u/${encodeURIComponent(r.owner)}`} className="font-medium hover:text-gold">
            {r.owner}
          </Link>
          {r.owner_blocked && (
            <span className="ml-1.5 rounded bg-red-400/10 px-1.5 py-0.5 text-[10px] text-red-300">{t('uploads blocked')}</span>
          )}
        </p>
        <p className="text-parchment/60">
          {t(r.count === 1 ? '{n} report' : '{n} reports', { n: r.count })} · {ago(r.last_at, locale, t)}
        </p>
        <label className="flex items-center gap-2 text-parchment/70">
          <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} className="accent-gold" />
          {t('Also block new uploads from this account')}
        </label>
        {(resolve.isError || unblock.isError) && (
          <p className="text-red-400">{(resolve.error ?? unblock.error)?.message}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => resolve.mutate('hide')}
          disabled={resolve.isPending}
          className={`${btn} border-red-400/40 text-red-300 hover:border-red-400/70`}
        >
          {t('Hide image')}
        </button>
        <button
          onClick={() => resolve.mutate('dismiss')}
          disabled={resolve.isPending}
          className={`${btn} border-line text-parchment/70 hover:border-parchment/40`}
        >
          {t('Dismiss')}
        </button>
        {r.owner_blocked && (
          <button
            onClick={() => unblock.mutate()}
            disabled={unblock.isPending}
            className={`${btn} border-line text-parchment/70 hover:border-parchment/40`}
          >
            {t('Allow uploads again')}
          </button>
        )}
      </div>
    </li>
  )
}

function Reports() {
  const t = useT()
  const reports = useQuery({ queryKey: ['admin', 'reports'], queryFn: api.adminReports, refetchInterval: 60_000 })
  return (
    <Panel title={t('Reported images')}>
      {reports.isError ? (
        <LoadError error={reports.error} onRetry={() => reports.refetch()} retrying={reports.isFetching} />
      ) : reports.isPending ? (
        <p className="text-sm text-parchment/50">{t('Loading…')}</p>
      ) : reports.data.reports.length === 0 ? (
        <p className="text-sm text-parchment/50">{t('No reports waiting for review.')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {reports.data.reports.map((r) => (
            <ReportRow key={r.key} r={r} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function SupporterRow({ s }: { s: AdminSupporter }) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const done = () => queryClient.invalidateQueries({ queryKey: ['admin', 'supporters'] })
  const renew = useMutation({ mutationFn: () => api.grantSupporter(s.username), onSuccess: done })
  const revoke = useMutation({ mutationFn: () => api.revokeSupporter(s.username), onSuccess: done })
  const until = new Date(s.until).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <li className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <Link
        to={`/u/${encodeURIComponent(s.username)}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-medium hover:text-gold"
      >
        <span className="truncate">{s.username}</span>
        {s.founder && <FounderBadge />}
      </Link>
      {s.total_cents > 0 && <span className="text-parchment/60 tabular-nums">{formatReais(s.total_cents, locale)}</span>}
      <span className={s.active ? 'text-emerald-300' : 'text-parchment/45'}>
        {s.active ? t('until {date}', { date: until }) : t('expired on {date}', { date: until })}
      </span>
      <span className="text-parchment/45">{t(s.times === 1 ? '{n} time' : '{n} times', { n: s.times })}</span>
      <button
        onClick={() => renew.mutate()}
        disabled={renew.isPending}
        className="rounded-lg border border-gold/50 px-3 py-1 text-gold hover:bg-gold/10 disabled:opacity-50"
      >
        {t('+30 days')}
      </button>
      {s.active && (
        <button
          onClick={() => window.confirm(t('End the perks of {name} now?', { name: s.username })) && revoke.mutate()}
          disabled={revoke.isPending}
          className="rounded-lg border border-line px-3 py-1 text-parchment/60 hover:border-red-400/50 hover:text-red-300 disabled:opacity-50"
        >
          {t('End')}
        </button>
      )}
    </li>
  )
}

function DonationRow({ d }: { d: AdminDonation }) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const [value, setValue] = useState('')
  const amount = parseReais(value)
  const resolve = useMutation({
    mutationFn: (action: 'grant' | 'reject') => api.resolveDonation(d.id, action, amount ?? 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'donations'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'supporters'] })
    },
  })
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <li className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <span className="rounded-md bg-gold/15 px-2 py-0.5 font-mono font-semibold text-gold tabular-nums">
        ,{String(d.cents).padStart(2, '0')}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <Link to={`/u/${encodeURIComponent(d.username)}`} className="font-medium hover:text-gold">
          {d.username}
        </Link>
        {d.gift && (
          <span className="text-parchment/60">
            {' '}
            → {t('gift for')}{' '}
            <Link to={`/u/${encodeURIComponent(d.gift)}`} className="font-medium text-parchment hover:text-gold">
              {d.gift}
            </Link>
          </span>
        )}
      </span>
      <span
        className="text-parchment/45"
        title={t('Cents reserved on {date}', { date: when(d.reserved_at) })}
      >
        {t('notice on {date}', { date: when(d.claimed_at) })}
      </span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={`R$ 10,${String(d.cents).padStart(2, '0')}`}
        aria-label={t('Amount in the bank statement')}
        inputMode="decimal"
        className={`w-28 rounded-lg border bg-ink px-2 py-1 tabular-nums focus:outline-none ${
          amount === null ? 'border-red-400/60' : 'border-line focus:border-gold'
        }`}
      />
      <button
        onClick={() => resolve.mutate('grant')}
        disabled={resolve.isPending || amount === null}
        className="rounded-lg bg-gold px-3 py-1 font-semibold text-ink hover:brightness-110 disabled:opacity-50"
      >
        {t('Activate {n} days', { n: 30 })}
      </button>
      <button
        onClick={() => window.confirm(t('Reject the notice from {name}?', { name: d.username })) && resolve.mutate('reject')}
        disabled={resolve.isPending}
        className="rounded-lg border border-line px-3 py-1 text-parchment/60 hover:border-red-400/50 hover:text-red-300 disabled:opacity-50"
      >
        {t('Reject')}
      </button>
    </li>
  )
}

/**
 * Avisos "Já doei" do Pix: o admin procura no extrato um Pix com aqueles centavos, perto do horário
 * do aviso, e ativa (para quem pagou ou para o presenteado) ou recusa.
 */
function Donations() {
  const t = useT()
  const list = useQuery({ queryKey: ['admin', 'donations'], queryFn: api.adminDonations, refetchInterval: 60_000 })
  if (list.isError) return <LoadError error={list.error} onRetry={() => list.refetch()} retrying={list.isFetching} />
  if (!list.data?.donations.length) return null
  return (
    <div className="space-y-2 rounded-lg border border-gold/30 bg-gold/5 p-3">
      <p className="text-sm font-semibold text-parchment">
        {t('Pix notices waiting ({n})', { n: list.data.donations.length })}
      </p>
      <p className="text-xs text-parchment/50">
        {t('Find a Pix with these cents in your bank statement, close to the notice time. Notices expire in {n} days.', {
          n: list.data.days,
        })}
      </p>
      <ul className="divide-y divide-line">
        {list.data.donations.map((d) => (
          <DonationRow key={d.id} d={d} />
        ))}
      </ul>
    </div>
  )
}

/**
 * Apoiadores: os avisos "Já doei" do Pix chegam numa fila; no Ko-fi (ou sem aviso), o admin cola o
 * nome de usuário da mensagem e ativa (ou renova) 30 dias de enfeites com um clique.
 */
function Supporters() {
  const t = useT()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const amount = parseReais(value)
  const list = useQuery({ queryKey: ['admin', 'supporters'], queryFn: api.adminSupporters })
  const grant = useMutation({
    mutationFn: () => api.grantSupporter(name.trim(), amount ?? 0),
    onSuccess: () => {
      setName('')
      setValue('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'supporters'] })
    },
  })
  return (
    <Panel title={t('Supporters')}>
      <Donations />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) grant.mutate()
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            grant.reset()
          }}
          placeholder={t('Username from the donation message')}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-2 text-sm focus:border-gold focus:outline-none"
        />
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            grant.reset()
          }}
          placeholder={t('Amount (R$)')}
          inputMode="decimal"
          className={`w-32 rounded-lg border bg-ink px-3 py-2 text-sm tabular-nums focus:outline-none ${
            amount === null ? 'border-red-400/60' : 'border-line focus:border-gold'
          }`}
        />
        <button
          disabled={!name.trim() || grant.isPending || amount === null}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-40"
        >
          {t('Activate {n} days', { n: list.data?.days ?? 30 })}
        </button>
      </form>
      {grant.isError && (
        <p className="text-sm text-red-400">
          {grant.error.message === 'not_found' ? t('No account with that username.') : grant.error.message}
        </p>
      )}
      {grant.isSuccess && (
        <p className="text-sm text-emerald-300">{t('Perks active for {name}.', { name: grant.data.username })}</p>
      )}
      {list.isError ? (
        <LoadError error={list.error} onRetry={() => list.refetch()} retrying={list.isFetching} />
      ) : list.isPending ? (
        <p className="text-sm text-parchment/50">{t('Loading…')}</p>
      ) : list.data.supporters.length === 0 ? (
        <p className="text-sm text-parchment/50">{t('No supporters yet.')}</p>
      ) : (
        <>
          <p className="text-xs text-parchment/50">
            {t('{n} active. Expired in the last 60 days also show up, to renew.', { n: list.data.active })}
          </p>
          <ul className="divide-y divide-line">
            {list.data.supporters.map((s) => (
              <SupporterRow key={s.username} s={s} />
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

/**
 * Gerador de decks: quanto cada geração custa. A maior parte roda no navegador de quem joga (Scryfall e
 * EDHREC); para o site contam os pedidos ao servidor e, com a IA ligada, os tokens do Gemini.
 */
function GeneratorUsage() {
  const { t, locale } = useI18n()
  const usage = useQuery({ queryKey: ['admin', 'generator'], queryFn: api.generatorUsage, refetchInterval: 60_000 })
  if (!usage.data) return null
  const u = usage.data
  const total = u.totals
  const num = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 1 })
  // Custos de IA são pequenos (US$ 0,0004 por pedido): mais casas decimais abaixo de 1 dólar
  const usd = (n: number | null) =>
    n === null ? '—' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 }).format(n)
  const showAi = u.ai.enabled || total.ai_calls + total.ai_failed > 0
  return (
    <Panel title={t('Deck generator · {n} days', { n: u.days })}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label={t('decks generated')}
          value={total.done}
          note={t('{failed} failed · {cancelled} cancelled · {saved} saved to a pool', {
            failed: total.failed,
            cancelled: total.cancelled,
            saved: total.saved,
          })}
        />
        <Tile
          label={t('seconds per deck')}
          value={u.per_generation.seconds}
          note={t('in the player’s browser: {scryfall} Scryfall searches and {edhrec} EDHREC pages', {
            scryfall: num(u.per_generation.scryfall),
            edhrec: num(u.per_generation.edhrec),
          })}
        />
        <Tile
          label={t('requests to our server per deck')}
          value={u.per_generation.server}
          note={t('card functions, bracket check and, with “my cards”, the card pool')}
        />
        <Tile
          label={t('AI requests')}
          value={total.ai_calls}
          note={showAi ? t('estimated cost: {cost}', { cost: usd(total.ai_cost) }) : t('AI is off')}
        />
      </div>
      <DayBars data={u.by_day.map((d) => ({ date: d.date, count: d.done }))} unit={['{n} deck', '{n} decks']} />
      <div className="space-y-1 text-sm text-parchment/70">
        {showAi ? (
          <>
            <p>
              {t('AI ({model}) · sentences read: {describe} · play guides: {guide} · failures: {failed}', {
                model: u.ai.model,
                describe: total.ai_describe,
                guide: total.ai_guide,
                failed: total.ai_failed,
              })}
            </p>
            <p>
              {t('Tokens: {input} in and {output} out; per request, {perIn} in, {perOut} out and {seconds} s waiting.', {
                input: num(total.tokens_in),
                output: num(total.tokens_out),
                perIn: num(u.per_ai_call.tokens_in),
                perOut: num(u.per_ai_call.tokens_out),
                seconds: num(u.per_ai_call.seconds),
              })}
            </p>
            <p>
              {u.ai.prices_set
                ? t('Estimated AI cost: {total} in {n} days, {each} per request.', {
                    total: usd(total.ai_cost),
                    n: u.days,
                    each: usd(u.per_ai_call.cost),
                  })
                : t('To see the cost in dollars, set GEMINI_PRICE_INPUT and GEMINI_PRICE_OUTPUT on the server (US$ per million tokens of the model).')}
            </p>
          </>
        ) : (
          <p>{t('The generator’s AI is off (no GEMINI_API_KEY on the server), so generating decks costs no AI.')}</p>
        )}
        <p className="text-xs text-parchment/45">
          {t('Only daily totals are kept, without accounts. Scryfall and EDHREC are called from the player’s browser and cost the site nothing.')}
        </p>
      </div>
    </Panel>
  )
}

function Dashboard() {
  const t = useT()
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: api.adminOverview, refetchInterval: 60_000 })
  if (overview.isPending) return <p className="text-center text-parchment/60">{t('Loading the dashboard…')}</p>
  if (overview.isError)
    return <LoadError error={overview.error} onRetry={() => overview.refetch()} retrying={overview.isFetching} />
  const o = overview.data
  const pct = (n: number) => (o.users.total ? t('{pct}% of accounts', { pct: Math.round((n / o.users.total) * 100) }) : '')

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label={t('accounts')}
          value={o.users.total}
          note={t('+{week} in 7 days · +{month} in 30', { week: o.users.new_7d, month: o.users.new_30d })}
        />
        <Tile label={t('active in 30 days')} value={o.users.active_30d} note={pct(o.users.active_30d)} />
        <Tile label={t('with a deck pool')} value={o.users.with_pool} note={pct(o.users.with_pool)} />
        <Tile
          label={t('deals')}
          value={o.content.draws}
          note={t('{week} in 7 days · {rooms} in rooms', { week: o.content.draws_7d, rooms: o.content.room_draws })}
        />
        <Tile label={t('games with a winner')} value={o.content.games} />
        <Tile label={t('marked precons')} value={o.content.owned_precons} />
        <Tile label={t('imported decks')} value={o.content.imported_decks} />
        <Tile label={t('open rooms')} value={o.content.open_rooms} />
      </div>

      <Reports />

      <Supporters />

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title={t('New accounts per day · {n} days', { n: o.days })}>
          <DayBars data={o.signups_by_day} unit={['{n} account', '{n} accounts']} />
        </Panel>
        <Panel title={t('Deals per day · {n} days', { n: o.days })}>
          <DayBars data={o.draws_by_day} unit={['{n} deal', '{n} deals']} />
        </Panel>
      </div>

      <GeneratorUsage />

      {o.top_owned.length > 0 && (
        <Panel title={t('Precons most marked as "I own this deck"')}>
          <ol className="space-y-1.5 text-sm">
            {o.top_owned.map((d, i) => (
              <li key={d.slug} className="flex items-center gap-3">
                <span className="w-4 text-right tabular-nums text-parchment/40">{i + 1}</span>
                <Link to={`/deck/${d.slug}`} className="min-w-0 flex-1 truncate hover:text-gold">
                  {d.name}
                </Link>
                <span className="tabular-nums text-parchment/70">{d.owners}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Users />
    </div>
  )
}

export default function AdminPage() {
  const t = useT()
  useTitle(t('Admin'))
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
        <h1 className="font-display text-3xl text-parchment">{t('Admin')}</h1>
        <p className="text-sm text-parchment/60">{t('Overview of accounts and site usage. Updates every minute.')}</p>
        <Link to="/admin/social" className="inline-block text-sm text-gold hover:underline">
          {t('Social media posts')} →
        </Link>
      </div>
      <Dashboard />
    </div>
  )
}
