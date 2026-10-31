/*
 * Tela das mesas (/tables): abrir uma mesa nova, as suas mesas e as abertas para entrar ou assistir.
 * Fica fora da página da mesa: quem só olha a lista não baixa a mesa inteira, e quem entra numa
 * mesa não baixa o lançador nem o guia.
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthDialog } from '../components/auth/AuthDialog'
import Launcher from '../components/launcher/Launcher'
import PlayGuide, { PlayStats, SectionHeading } from '../components/launcher/PlayGuide'
import NewTableDialog, { type TableSetup } from '../components/table/NewTableDialog'
import FindMatch from '../components/table/FindMatch'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n, useT } from '../lib/i18n'
import { playstyleLabel } from '../lib/playstyles'
import { ruleChips } from '../lib/tableRules'
import { saveTableSetup } from '../hooks/useTableSocket'
import type { MyTable } from '../lib/types'

const randomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('')

export default function TableLobby() {
  const t = useT()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { openAuth } = useAuthDialog()
  useTitle(null)
  // Janela "Nova mesa" (também abre por /?nova, vindo de uma mesa que fechou)
  const [params, setParams] = useSearchParams()
  const [newOpen, setNewOpen] = useState(() => params.has('nova'))
  useEffect(() => {
    if (params.has('nova')) setParams({}, { replace: true })
  }, [params, setParams])
  const openTable = (setup: TableSetup) => {
    const fresh = randomCode()
    saveTableSetup(fresh, { ...setup })
    navigate(`/table/${fresh}`)
  }
  // "Iniciar uma partida": a mesa pede conta. Sem login, entra primeiro e depois abre a janela
  const startNew = () => (user ? setNewOpen(true) : openAuth('login', { onClose: (ok) => ok && setNewOpen(true) }))
  // Mesas abertas em que você tem lugar; atualiza sozinho (quem está online e o prazo de inatividade)
  const mine = useQuery({
    queryKey: ['tables', 'mine'],
    queryFn: api.myTables,
    refetchInterval: 15_000,
    enabled: !!user,
  })
  const tables = mine.data?.tables ?? []
  // Todas as mesas abertas (de qualquer pessoa), sem as que já aparecem como suas
  const open = useQuery({ queryKey: ['tables', 'open'], queryFn: api.openTables, refetchInterval: 15_000 })
  const mineCodes = new Set(tables.map((m) => m.code))
  const all = open.data?.tables ?? []
  const others = all.filter((o) => !mineCodes.has(o.code))
  const playersOnline = all.reduce((n, tb) => n + tb.players.filter((p) => p.online).length, 0)
  // Uma lista só: as suas mesas primeiro, depois as de outras pessoas
  const rows = [
    ...tables.map((table) => ({ table, mine: true, fetchedAt: mine.dataUpdatedAt })),
    ...others.map((table) => ({ table, mine: false, fetchedAt: open.dataUpdatedAt })),
  ]
  const freeSeats = all.reduce((n, tb) => n + Math.max(0, tb.max_seats - tb.players.length), 0)
  const idleMinutes = Math.round((open.data?.idle_close ?? mine.data?.idle_close ?? 600) / 60)
  return (
    <div className="pb-16">
      <Launcher
        openTables={rows.length}
        playersOnline={playersOnline}
        onNewTable={startNew}
      />

      <div className="mx-auto max-w-[1600px] space-y-24 px-5 sm:px-8 lg:px-16">
        {/* Mesas: um só lugar na página, com o status em cima e a lista em tabela */}
        <section aria-labelledby="open-tables" className="space-y-6">
          <SectionHeading
            id="open-tables"
            eyebrow={t('Live now')}
            title={t('Open tables')}
            note={t('Tables close after {n} minutes without changes.', { n: idleMinutes })}
          />
          <PlayStats
            items={[
              [t('Open tables'), open.isPending ? undefined : rows.length],
              [t('Your tables'), user ? (mine.isPending ? undefined : tables.length) : 0],
              [t('Free seats'), open.isPending ? undefined : freeSeats],
              [t('Players online'), open.isPending ? undefined : playersOnline],
            ]}
          />
          <FindMatch />
          {open.isPending || (user && mine.isPending) ? (
            <div className="h-40 animate-pulse rounded-xl border border-line bg-surface" />
          ) : user && mine.isError ? (
            <p className="rounded-lg border border-line bg-surface p-4 text-sm text-parchment/70">
              {t('Could not load your tables.')}{' '}
              <button onClick={() => mine.refetch()} className="text-gold underline">
                {t('Try again')}
              </button>
            </p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line p-10 text-center">
              <p className="text-sm text-parchment/60">{t('No open tables right now.')}</p>
              <button
                onClick={startNew}
                className="rounded-md border border-gold/60 px-4 py-1.5 text-sm font-semibold text-gold transition hover:bg-gold/10"
              >
                {t('Be the first: open a table')}
              </button>
            </div>
          ) : (
            <TablesTable rows={rows} />
          )}
        </section>
        <PlayGuide onNewTable={startNew} />
      </div>
      {newOpen && <NewTableDialog onStart={openTable} onClose={() => setNewOpen(false)} />}
    </div>
  )
}

type TableRowData = { table: MyTable; mine: boolean; fetchedAt: number }

/**
 * Lista de mesas em tabela: mesa (com título, estilo e regras), situação, jogadores, prazo e a
 * ação (voltar, entrar ou assistir). No celular cada linha vira um cartão.
 */
function TablesTable({ rows }: { rows: TableRowData[] }) {
  const t = useT()
  return (
    <div className="overflow-hidden rounded-xl border border-parchment/10">
      <table className="w-full text-left text-sm">
        <thead className="hidden bg-parchment/[0.04] text-[0.65rem] font-semibold tracking-[0.18em] text-parchment/50 uppercase md:table-header-group">
          <tr>
            <th className="px-5 py-3">{t('Table')}</th>
            <th className="px-5 py-3">{t('Status')}</th>
            <th className="px-5 py-3">{t('Players')}</th>
            <th className="px-5 py-3">{t('Closes in')}</th>
            <th className="px-5 py-3 text-right">
              <span className="sr-only">{t('Action')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-parchment/10">
          {rows.map((r) => (
            <TableRow key={r.table.code} {...r} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TableRow({ table, mine, fetchedAt }: TableRowData) {
  const { t, locale } = useI18n()
  const [now, setNow] = useState(fetchedAt)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, table.idle_left - Math.max(0, now - fetchedAt) / 1000)
  const minutes = Math.ceil(left / 60)
  const seated = table.players.length
  const opts = table.options
  const watchable = opts?.allow_watch !== false
  const free = seated < table.max_seats && !table.started && table.can_join !== false
  const chip = 'rounded-full border px-2 py-px text-[0.7rem] font-semibold'
  return (
    <tr className={`grid gap-3 p-4 transition hover:bg-parchment/[0.03] md:table-row md:p-0 ${mine ? 'bg-gold/[0.04]' : ''}`}>
      <td className="md:px-5 md:py-4">
        {opts?.title && <p className="truncate font-semibold text-parchment">{opts.title}</p>}
        <span className="font-display text-2xl tracking-widest">{table.code}</span>
        {mine && (
          <span className="ml-2 rounded-full border border-gold/50 px-2 py-0.5 align-middle text-[0.65rem] font-semibold tracking-wide text-gold uppercase">
            {t('Yours')}
          </span>
        )}
        {(opts?.style || opts?.friends_only || opts?.practice || table.max_seats === 2 || !watchable || opts?.rules) && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {opts?.style && <span className={`${chip} border-gold/40 text-gold`}>{playstyleLabel(t, opts.style)}</span>}
            {opts?.friends_only && <span className={`${chip} border-emerald-400/40 text-emerald-300`}>{t('Friends only')}</span>}
            {opts?.practice ? (
              <span className={`${chip} border-violet-400/40 text-violet-300`}>{t('Practice')}</span>
            ) : (
              table.max_seats === 2 && <span className={`${chip} border-line text-parchment/60`}>{t('1 vs 1')}</span>
            )}
            {!watchable && <span className={`${chip} border-line text-parchment/50`}>{t('No spectators')}</span>}
            {ruleChips(t, opts?.rules, locale).map((r) => (
              <span key={r} className={`${chip} border-sky-400/40 text-sky-300`}>
                {r}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="text-xs text-parchment/70 md:px-5 md:py-4">
        {table.finished ? t('Game over') : table.turn ? t('Turn {n}', { n: table.turn }) : t('Waiting to start')}
        {!!table.spectators && <span className="block text-parchment/45">{t('{n} watching', { n: table.spectators })}</span>}
      </td>
      <td className="md:px-5 md:py-4">
        <div className="flex items-center gap-2 text-xs text-parchment/60">
          <span className="h-1 w-16 overflow-hidden rounded-full bg-parchment/10">
            <span className="block h-full rounded-full bg-gold" style={{ width: `${(seated / table.max_seats) * 100}%` }} />
          </span>
          {t('{seated}/{max} players', { seated, max: table.max_seats })}
        </div>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {table.players.map((p) => (
            <li
              key={p.seat}
              title={p.online ? t('Online') : t('Offline')}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                p.online
                  ? 'border-emerald-400/50 bg-emerald-400/[0.07] text-parchment'
                  : p.you
                    ? 'border-gold/50 text-parchment/80'
                    : 'border-line text-parchment/60'
              }`}
            >
              {/* Bolinha verde (pulsando) quando o jogador está na mesa agora */}
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  p.online ? 'animate-pulse bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153/0.9)]' : 'bg-parchment/25'
                }`}
              />
              <span className="sr-only">{p.online ? t('Online') : t('Offline')}</span>
              <span className="font-semibold">{p.you ? t('You') : p.name}</span>
              {p.deck && <span className="max-w-32 truncate text-parchment/50">· {p.deck}</span>}
            </li>
          ))}
        </ul>
      </td>
      <td className={`text-xs md:px-5 md:py-4 ${minutes <= 2 ? 'text-gold' : 'text-parchment/55'}`}>
        {minutes <= 1 ? t('less than a minute') : t('{n} min', { n: minutes })}
      </td>
      <td className="md:px-5 md:py-4 md:text-right">
        {mine ? (
          <Link
            to={`/table/${table.code}`}
            className="inline-block rounded-md btn-ember px-5 py-2 text-center font-semibold text-ink transition hover:brightness-110"
          >
            {t('Rejoin')}
          </Link>
        ) : free ? (
          <Link
            to={`/table/${table.code}`}
            className="inline-block rounded-md btn-ember px-5 py-2 text-center font-semibold text-ink transition hover:brightness-110"
          >
            {t('Join')}
          </Link>
        ) : watchable ? (
          <Link
            to={`/table/${table.code}?watch=1`}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-sky-400/60 px-5 py-2 font-semibold text-sky-300 transition hover:bg-sky-400/10"
          >
            <Eye className="h-4 w-4" aria-hidden />
            {t('Watch')}
          </Link>
        ) : (
          <span className="inline-block px-5 py-2 text-sm text-parchment/50">
            {table.started ? t('In progress') : t('Full')}
          </span>
        )}
      </td>
    </tr>
  )
}

// Aviso de inatividade: aparece nos últimos 2 minutos antes da mesa fechar
