import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LogoMark } from '../components/Logo'
import { useTableSocket, type TablePlayer, type TableState } from '../hooks/useTableSocket'
import { useTitle } from '../hooks/useTitle'
import { useT } from '../lib/i18n'

/*
 * Mesa virtual — Fase 0 do roadmap.
 * Só a vida dos jogadores é real (sincronizada por WebSocket). Campos, mão e zonas são o
 * layout da Fase 1 com cartas de mentira, para validar a organização da mesa antes de programar.
 */

// Cor de cada cadeira (borda do painel de vida e marcador do jogador)
const SEAT_BORDER = ['border-l-gold', 'border-l-sky-400', 'border-l-emerald-400', 'border-l-violet-400']
const SEAT_DOT = ['bg-gold', 'bg-sky-400', 'bg-emerald-400', 'bg-violet-400']

const randomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('')

export default function TablePage() {
  const { code } = useParams()
  return code ? <TableRoom code={code.toUpperCase()} /> : <TableLobby />
}

function TableLobby() {
  const t = useT()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  useTitle(t('Virtual table'))
  const join = (e: FormEvent) => {
    e.preventDefault()
    const clean = code.trim().toUpperCase()
    if (/^[A-Z0-9]{4,12}$/.test(clean)) navigate(`/mesa/${clean}`)
  }
  return (
    <div className="mx-auto max-w-xl py-6">
      <p className="text-sm font-semibold tracking-wide text-gold uppercase">{t('Prototype')}</p>
      <h1 className="font-display mt-1 text-5xl">{t('Virtual table')}</h1>
      <p className="mt-4 text-parchment/70">
        {t(
          'Play Commander online with up to 4 players. For now only life totals are live; cards arrive in the next phase.',
        )}
      </p>
      <button
        onClick={() => navigate(`/mesa/${randomCode()}`)}
        className="font-display mt-8 w-full rounded-md bg-gold px-6 py-3 text-xl text-ink transition hover:brightness-110"
      >
        {t('Open a new table')}
      </button>
      <form onSubmit={join} className="mt-6 flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t('Table code')}
          aria-label={t('Table code')}
          maxLength={12}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 tracking-widest uppercase placeholder:tracking-normal placeholder:normal-case focus:border-gold focus:outline-none"
        />
        <button className="rounded-md border border-parchment/30 px-4 py-2 font-semibold transition hover:bg-parchment/10">
          {t('Join')}
        </button>
      </form>
    </div>
  )
}

type LogEntry = { id: number; text: string }

/** Monta o log comparando o estado anterior com o novo (o servidor só manda o estado). */
function useTableLog(table: TableState | null) {
  const t = useT()
  const prev = useRef<TableState | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const nextId = useRef(0)
  useEffect(() => {
    if (!table) return
    const before = new Map(prev.current?.players.map((p) => [p.id, p]))
    const lines: string[] = []
    for (const p of table.players) {
      const old = before.get(p.id)
      if (!old) lines.push(t('{name} sat down', { name: p.name }))
      else {
        if (old.life !== p.life)
          lines.push(t('{name}: life {from} → {to}', { name: p.name, from: old.life, to: p.life }))
        if (old.online && !p.online) lines.push(t('{name} disconnected', { name: p.name }))
        if (!old.online && p.online) lines.push(t('{name} is back', { name: p.name }))
      }
    }
    prev.current = table
    if (lines.length) {
      setLog((cur) => [...lines.map((text) => ({ id: nextId.current++, text })), ...cur].slice(0, 60))
    }
  }, [table, t])
  return log
}

function TableRoom({ code }: { code: string }) {
  const t = useT()
  const { table, status, changeLife } = useTableSocket(code)
  const log = useTableLog(table)
  const [copied, setCopied] = useState(false)
  useTitle(t('Table {code}', { code }))

  if (status === 'full' || status === 'unauthorized' || status === 'invalid') {
    const message = {
      full: t('This table is full (4 players).'),
      unauthorized: t('Your session expired. Sign in again to join the table.'),
      invalid: t('Invalid table code.'),
    }[status]
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-lg text-parchment/80">{message}</p>
        <Link to="/mesa" className="mt-6 inline-block text-gold underline">
          {t('Back to tables')}
        </Link>
      </div>
    )
  }

  const maxSeats = table?.max_seats ?? 4
  const bySeat = new Map(table?.players.map((p) => [p.seat, p]))
  const me = table?.players.find((p) => p.id === table.you) ?? null
  // Oponentes na ordem do turno, começando por quem senta depois de você
  const mySeat = me?.seat ?? 1
  const others = Array.from({ length: maxSeats - 1 }, (_, i) => ((mySeat + i) % maxSeats) + 1)

  const copy = async () => {
    await navigator.clipboard?.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col lg:h-[calc(100dvh-4.25rem)] lg:min-h-[40rem]">
      {/* Barra da mesa */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 text-sm">
        <span className="font-display text-xl">{t('Table {code}', { code })}</span>
        <button
          onClick={copy}
          className="rounded-full border border-parchment/30 px-3 py-0.5 text-xs transition hover:bg-parchment/10"
        >
          {copied ? t('Link copied') : t('Copy invite link')}
        </button>
        <span className="flex items-center gap-1.5 text-xs text-parchment/60" role="status">
          <span className={`h-2 w-2 rounded-full ${status === 'open' ? 'bg-emerald-400' : 'animate-pulse bg-gold'}`} />
          {status === 'open' ? t('Connected') : status === 'reconnecting' ? t('Reconnecting…') : t('Connecting…')}
        </span>
        <span className="ml-auto text-xs text-parchment/45">
          {t('Prototype: only life totals are live. Cards arrive in phase 1.')}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[5.5rem_minmax(0,1fr)_17rem]">
        {/* Suas zonas */}
        <aside className="hidden flex-col gap-2 lg:flex" aria-label={t('Your zones')}>
          <ZoneTile label={t('Command')} accent>
            <CardSlot className="w-14" accent />
          </ZoneTile>
          <ZoneTile label={t('Library')} count={92}>
            <CardBack className="w-14" />
          </ZoneTile>
          <ZoneTile label={t('Graveyard')} count={0} />
          <ZoneTile label={t('Exile')} count={0} />
        </aside>

        {/* Campos */}
        <section className="grid min-h-0 gap-3 lg:grid-rows-[minmax(0,2fr)_minmax(0,3fr)_auto]">
          <div className="grid min-h-0 grid-cols-3 gap-2 sm:gap-3">
            {others.map((seat) => (
              <OpponentArea key={seat} seat={seat} player={bySeat.get(seat) ?? null} />
            ))}
          </div>
          <Battlefield player={me} />
          <Hand />
        </section>

        {/* Vida e log */}
        <aside className="order-first flex min-h-0 flex-col gap-3 lg:order-none">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {Array.from({ length: maxSeats }, (_, i) => i + 1).map((seat) => {
              const p = bySeat.get(seat) ?? null
              return (
                <LifePanel key={seat} seat={seat} player={p} mine={!!p && p.id === table?.you} onChange={changeLife} />
              )
            })}
          </div>
          <TableLog log={log} />
        </aside>
      </div>
    </div>
  )
}

function OpponentArea({ seat, player }: { seat: number; player: TablePlayer | null }) {
  const t = useT()
  return (
    <div className="flex min-h-28 flex-col rounded-lg border border-line bg-surface/60 p-2 lg:min-h-36">
      <div className="flex items-center gap-2 text-sm">
        <span className={`h-2.5 w-2.5 rounded-full ${SEAT_DOT[seat - 1]} ${player?.online ? '' : 'opacity-30'}`} />
        <span className={`truncate font-semibold ${player ? '' : 'text-parchment/40'}`}>
          {player?.name ?? t('Open seat')}
        </span>
        {player && (
          <span className="ml-auto hidden gap-2 text-xs text-parchment/50 sm:flex">
            <span title={t('Hand')}>✋ 7</span>
            <span title={t('Library')}>▤ 92</span>
          </span>
        )}
      </div>
      <div className={`mt-2 flex flex-1 flex-wrap content-start gap-1.5 ${player ? 'opacity-50' : 'opacity-15'}`}>
        <CardSlot className="w-10" accent />
        {Array.from({ length: 5 }, (_, i) => (
          <CardSlot key={i} className={i === 3 ? 'w-14' : 'w-10'} tapped={i === 3} />
        ))}
      </div>
    </div>
  )
}

function Battlefield({ player }: { player: TablePlayer | null }) {
  const t = useT()
  return (
    <div className="relative flex min-h-56 flex-col justify-between rounded-lg border border-line bg-surface/40 p-3">
      <span className="absolute top-2 right-3 text-xs text-parchment/35">{player?.name ?? ''}</span>
      <div className="flex flex-wrap gap-2 opacity-50">
        {Array.from({ length: 4 }, (_, i) => (
          <CardSlot key={i} className={i === 1 ? 'w-[5.6rem] xl:w-28' : 'w-16 xl:w-20'} tapped={i === 1} />
        ))}
      </div>
      <div>
        <p className="mb-1 text-[0.7rem] tracking-wide text-parchment/30 uppercase">{t('Lands')}</p>
        <div className="flex flex-wrap gap-2 opacity-50">
          {Array.from({ length: 6 }, (_, i) => (
            <CardSlot key={i} className={i < 2 ? 'w-[4.2rem] xl:w-[4.9rem]' : 'w-12 xl:w-14'} tapped={i < 2} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Hand() {
  const t = useT()
  const actions = [t('Draw'), t('Untap all'), t('Shuffle'), t('Mulligan')]
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-line bg-surface/60 px-3 pt-2 pb-3">
      <div>
        <p className="mb-1 text-[0.7rem] tracking-wide text-parchment/40 uppercase">{t('Your hand')}</p>
        <div className="flex pl-6">
          {Array.from({ length: 7 }, (_, i) => (
            <CardSlot key={i} className="-ml-6 w-16 shadow-[-6px_0_10px_rgba(0,0,0,0.45)] xl:w-[4.5rem]" />
          ))}
        </div>
      </div>
      <div className="ml-auto flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a}
            disabled
            title={t('Coming in phase 1')}
            className="cursor-not-allowed rounded-md border border-line px-3 py-1.5 text-sm text-parchment/40"
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  )
}

function LifePanel({
  seat,
  player,
  mine,
  onChange,
}: {
  seat: number
  player: TablePlayer | null
  mine: boolean
  onChange: (delta: number) => void
}) {
  const t = useT()
  const btn =
    'rounded-md border border-line px-2 py-1 text-sm font-semibold transition hover:border-parchment/40 hover:bg-parchment/10 active:scale-95'
  return (
    <div className={`rounded-lg border border-l-4 border-line bg-surface p-2.5 ${SEAT_BORDER[seat - 1]}`}>
      <div className="flex items-center gap-2">
        <span className={`truncate text-sm font-semibold ${player ? '' : 'text-parchment/40'}`}>
          {player?.name ?? t('Open seat')}
          {mine && <span className="ml-1 text-xs font-normal text-gold">({t('you')})</span>}
        </span>
        {player && !player.online && <span className="text-xs text-parchment/40">{t('offline')}</span>}
        <span
          key={player?.life}
          className="font-display ml-auto text-4xl tabular-nums animate-[fade-in_0.3s_ease-out]"
          aria-label={t('Life')}
        >
          {player ? player.life : '—'}
        </span>
      </div>
      {mine && (
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          <button className={btn} onClick={() => onChange(-5)}>
            −5
          </button>
          <button className={btn} onClick={() => onChange(-1)}>
            −1
          </button>
          <button className={btn} onClick={() => onChange(1)}>
            +1
          </button>
          <button className={btn} onClick={() => onChange(5)}>
            +5
          </button>
        </div>
      )}
    </div>
  )
}

function TableLog({ log }: { log: LogEntry[] }) {
  const t = useT()
  return (
    <div className="flex max-h-36 min-h-24 flex-1 flex-col rounded-lg border border-line bg-surface/60 lg:max-h-none lg:min-h-40">
      <div className="flex gap-4 border-b border-line px-3 pt-2 text-xs font-semibold tracking-wide uppercase">
        <span className="border-b-2 border-gold pb-1.5">{t('Log')}</span>
        <span className="pb-1.5 text-parchment/35" title={t('Coming in phase 2')}>
          {t('Chat')}
        </span>
      </div>
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs text-parchment/70">
        {log.length === 0 && <li className="text-parchment/35">{t('Nothing happened yet.')}</li>}
        {log.map((e) => (
          <li key={e.id}>{e.text}</li>
        ))}
      </ol>
    </div>
  )
}

function ZoneTile({
  label,
  count,
  accent,
  children,
}: {
  label: string
  count?: number
  accent?: boolean
  children?: ReactNode
}) {
  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-lg border bg-surface/60 p-2 ${accent ? 'border-gold/40' : 'border-line'}`}
    >
      {children}
      <span className="text-[0.7rem] font-semibold tracking-wide text-parchment/60 uppercase">{label}</span>
      {count !== undefined && <span className="font-display text-lg leading-none">{count}</span>}
    </div>
  )
}

function CardSlot({
  className = '',
  tapped = false,
  accent = false,
}: {
  className?: string
  tapped?: boolean
  accent?: boolean
}) {
  return (
    <div
      className={`shrink-0 rounded-[5px] border bg-[#18181c] ${tapped ? '' : 'aspect-[5/7]'} ${accent ? 'border-gold/60' : 'border-parchment/15'} ${tapped ? 'aspect-[7/5]' : ''} ${className}`}
    />
  )
}

function CardBack({ className = '' }: { className?: string }) {
  return (
    <div className={`grid aspect-[5/7] place-items-center rounded-[5px] border border-gold/40 bg-ink ${className}`}>
      <LogoMark className="h-6 w-6 opacity-70" />
    </div>
  )
}
