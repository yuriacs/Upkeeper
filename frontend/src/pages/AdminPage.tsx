import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import DayBars from '../components/DayBars'
import LoadError from '../components/LoadError'
import { useDebounce } from '../hooks/useDebounce'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { AdminUser, AdminUserOrdering } from '../lib/types'

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })

function ago(iso: string | null): string {
  if (!iso) return 'nunca'
  const days = Math.round((Date.parse(iso) - Date.now()) / 86_400_000)
  if (days === 0) return 'hoje'
  if (Math.abs(days) < 30) return rtf.format(days, 'day')
  if (Math.abs(days) < 365) return rtf.format(Math.round(days / 30), 'month')
  return rtf.format(Math.round(days / 365), 'year')
}

function Tile({ label, value, note }: { label: string; value: number; note?: ReactNode }) {
  return (
    <div className="rounded-xl border border-gold/15 bg-surface/60 px-4 py-3">
      <p className="font-display text-3xl tabular-nums text-gold">{value.toLocaleString('pt-BR')}</p>
      <p className="text-sm text-parchment/70">{label}</p>
      {note && <p className="mt-0.5 text-xs text-parchment/45">{note}</p>}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-gold/15 bg-surface/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gold/70">{title}</h2>
      {children}
    </section>
  )
}

const ORDER_OPTIONS: { value: AdminUserOrdering; label: string }[] = [
  { value: 'recent', label: 'Mais recentes' },
  { value: 'oldest', label: 'Mais antigas' },
  { value: 'last_login', label: 'Último acesso' },
  { value: 'username', label: 'Nome (A–Z)' },
  { value: 'draws', label: 'Mais sorteios' },
  { value: 'wins', label: 'Mais vitórias' },
  { value: 'pool', label: 'Maior deckpool' },
]

function UserRow({ u }: { u: AdminUser }) {
  return (
    <tr className="align-top">
      <td className="px-3 py-2.5">
        <p className="font-medium">
          {u.username}
          {u.is_admin && <span className="ml-1.5 rounded bg-gold/15 px-1.5 py-0.5 text-[10px] text-gold">admin</span>}
        </p>
        <p className="text-xs text-parchment/50">{u.email}</p>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-parchment/70">{dateFmt.format(new Date(u.date_joined))}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-parchment/70" title={u.last_login ?? undefined}>
        {ago(u.last_login)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums" title={`${u.precons} precons marcados, ${u.decks} decks importados`}>
        {u.precons + u.decks}
        <span className="block text-[11px] text-parchment/40">
          {u.precons}p · {u.decks}i
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
    <Panel title="Contas">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Buscar por nome ou e-mail…"
          aria-label="Buscar contas"
          className="min-w-0 flex-1 rounded-lg border border-gold/20 bg-ink px-3 py-2 text-sm focus:border-gold focus:outline-none"
        />
        <select
          value={ordering}
          onChange={(e) => {
            setOrdering(e.target.value as AdminUserOrdering)
            setPage(1)
          }}
          aria-label="Ordenar contas"
          className="rounded-lg border border-gold/20 bg-ink px-3 py-2 text-sm focus:border-gold focus:outline-none"
        >
          {ORDER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
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
              <tr className="border-b border-gold/10">
                <th className="px-3 py-2 font-normal">Conta</th>
                <th className="px-3 py-2 font-normal">Criada em</th>
                <th className="px-3 py-2 font-normal">Último acesso</th>
                <th className="px-3 py-2 text-right font-normal">Deckpool</th>
                <th className="px-3 py-2 text-right font-normal">Sorteios</th>
                <th className="px-3 py-2 text-right font-normal">Vitórias</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gold/10">
              {users.data?.results.map((u) => <UserRow key={u.id} u={u} />)}
            </tbody>
          </table>
          {users.isPending && <p className="py-6 text-center text-parchment/50">Carregando…</p>}
          {users.data?.count === 0 && <p className="py-6 text-center text-parchment/50">Nenhuma conta encontrada.</p>}
        </div>
      )}

      {users.data && users.data.count > 0 && (
        <div className="flex items-center justify-between text-sm text-parchment/60">
          <span>
            {users.data.count} {users.data.count === 1 ? 'conta' : 'contas'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page <= 1}
              className="rounded border border-gold/25 px-2.5 py-1 hover:border-gold/60 disabled:opacity-30"
            >
              ← Anterior
            </button>
            <span className="tabular-nums">
              {page}/{pages}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!users.data.next}
              className="rounded border border-gold/25 px-2.5 py-1 hover:border-gold/60 disabled:opacity-30"
            >
              Próxima →
            </button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function Dashboard() {
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: api.adminOverview, refetchInterval: 60_000 })
  if (overview.isPending) return <p className="text-center text-parchment/60">Carregando o painel…</p>
  if (overview.isError)
    return <LoadError error={overview.error} onRetry={() => overview.refetch()} retrying={overview.isFetching} />
  const o = overview.data
  const pct = (n: number) => (o.users.total ? `${Math.round((n / o.users.total) * 100)}% das contas` : '')

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="contas" value={o.users.total} note={`+${o.users.new_7d} em 7 dias · +${o.users.new_30d} em 30`} />
        <Tile label="ativas em 30 dias" value={o.users.active_30d} note={pct(o.users.active_30d)} />
        <Tile label="com deckpool" value={o.users.with_pool} note={pct(o.users.with_pool)} />
        <Tile label="sorteios" value={o.content.draws} note={`${o.content.draws_7d} em 7 dias · ${o.content.room_draws} em salas`} />
        <Tile label="partidas com vencedor" value={o.content.games} />
        <Tile label="precons marcados" value={o.content.owned_precons} />
        <Tile label="decks importados" value={o.content.imported_decks} />
        <Tile label="salas abertas" value={o.content.open_rooms} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title={`Novas contas por dia · ${o.days} dias`}>
          <DayBars data={o.signups_by_day} unit={['conta', 'contas']} />
        </Panel>
        <Panel title={`Sorteios por dia · ${o.days} dias`}>
          <DayBars data={o.draws_by_day} unit={['sorteio', 'sorteios']} />
        </Panel>
      </div>

      {o.top_owned.length > 0 && (
        <Panel title='Precons mais marcados como "tenho"'>
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
  useTitle('Painel')
  const { user, ready } = useAuth()
  if (!ready) return null
  if (!user) return <Navigate to="/entrar" replace state={{ next: '/painel' }} />
  if (!user.is_admin)
    return (
      <div className="space-y-3 py-10 text-center">
        <p className="text-parchment/70">Esta página é só para a administração do site.</p>
        <Link to="/" className="text-gold hover:underline">
          Voltar ao início
        </Link>
      </div>
    )

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-3xl text-gold">Painel</h1>
        <p className="text-sm text-parchment/60">Visão geral das contas e do uso do site. Atualiza a cada minuto.</p>
      </div>
      <Dashboard />
    </div>
  )
}
