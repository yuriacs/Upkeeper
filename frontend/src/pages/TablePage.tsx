import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTableSocket, type TablePlayer, type TableState } from '../hooks/useTableSocket'
import { useTitle } from '../hooks/useTitle'
import { useT } from '../lib/i18n'
import { readJSON, writeJSON } from '../lib/storage'

/*
 * Mesa virtual — Fase 0 do roadmap.
 * Só a vida dos jogadores é real (sincronizada por WebSocket). Campos, mão e zonas são o
 * layout da Fase 1, ainda vazios: a mesa fica limpa até as cartas chegarem.
 */

// Cor de cada cadeira (classes escritas por extenso para o Tailwind encontrar)
const SEAT_BORDER = ['border-l-gold', 'border-l-sky-400', 'border-l-emerald-400', 'border-l-violet-400']
const SEAT_TEXT = ['text-gold', 'text-sky-400', 'text-emerald-400', 'text-violet-400']
const SEAT_RING = ['ring-gold', 'ring-sky-400', 'ring-emerald-400', 'ring-violet-400']
const SEAT_TINT = ['from-gold/[0.08]', 'from-sky-400/[0.08]', 'from-emerald-400/[0.08]', 'from-violet-400/[0.08]']

// Split: o oponente em foco aparece grande e os outros pequenos ao lado. Full: todos do mesmo tamanho.
type ViewMode = 'split' | 'full'
const VIEW_KEY = 'precon-draft:table-view'

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
  const [view, setViewState] = useState<ViewMode>(() =>
    readJSON<string>(VIEW_KEY, 'split') === 'full' ? 'full' : 'split',
  )
  // Oponente em foco no modo split e jogador cujas zonas aparecem ao lado da mão
  const [focusSeat, setFocusSeat] = useState<number | null>(null)
  const [zonesSeat, setZonesSeat] = useState<number | null>(null)
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
  const focus = focusSeat !== null && others.includes(focusSeat) ? focusSeat : others[0]
  const zones = zonesSeat ?? mySeat

  const setView = (v: ViewMode) => {
    setViewState(v)
    writeJSON(VIEW_KEY, v)
  }
  // Clicar num jogador mostra as zonas dele ao lado da mão (e, no split, traz o campo dele para o foco)
  const selectPlayer = (seat: number) => {
    setZonesSeat(seat === mySeat ? null : seat)
    if (seat !== mySeat) setFocusSeat(seat)
  }
  const copy = async () => {
    await navigator.clipboard?.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const board = (seat: number, size: 'large' | 'small') => (
    <Board
      key={seat}
      seat={seat}
      player={bySeat.get(seat) ?? null}
      size={size}
      selected={zones === seat}
      onSelect={() => selectPlayer(seat)}
    />
  )

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
        <div
          role="group"
          aria-label={t('View')}
          className="ml-auto hidden overflow-hidden rounded-full border border-line text-xs sm:inline-flex"
        >
          {(['split', 'full'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`px-3 py-1 transition ${view === v ? 'bg-parchment font-semibold text-ink' : 'text-parchment/60 hover:text-parchment'}`}
            >
              {v === 'split' ? t('Split') : t('Full')}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section className="flex min-h-0 flex-col">
          {/* Oponentes */}
          {view === 'split' ? (
            <div className="grid min-h-[13rem] grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] border-b border-line lg:min-h-0 lg:flex-[2]">
              <div className="flex min-h-0 flex-col border-r border-line">
                {others.filter((s) => s !== focus).map((s) => board(s, 'small'))}
              </div>
              {board(focus, 'large')}
            </div>
          ) : (
            <div className="grid min-h-[13rem] grid-cols-3 border-b border-line lg:min-h-0 lg:flex-[2] [&>*+*]:border-l [&>*+*]:border-line">
              {others.map((s) => board(s, 'small'))}
            </div>
          )}

          {/* Seu campo: sempre o maior */}
          <div className="flex min-h-[16rem] lg:min-h-0 lg:flex-[3]">{board(mySeat, 'large')}</div>

          <HandBar
            seat={zones}
            player={bySeat.get(zones) ?? null}
            mine={zones === mySeat}
            onShowMine={() => setZonesSeat(null)}
          />
        </section>

        {/* Jogadores e log */}
        <aside className="order-first flex min-h-0 flex-col gap-2 border-line p-3 lg:order-none lg:border-l">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {Array.from({ length: maxSeats }, (_, i) => i + 1).map((seat) => {
              const p = bySeat.get(seat) ?? null
              return (
                <PlayerPanel
                  key={seat}
                  seat={seat}
                  player={p}
                  mine={!!p && p.id === table?.you}
                  selected={zones === seat}
                  onSelect={() => selectPlayer(seat)}
                  onChange={changeLife}
                />
              )
            })}
          </div>
          <TableLog log={log} />
        </aside>
      </div>
    </div>
  )
}

/** Inicial do jogador num círculo com a cor da cadeira. Clicar mostra as zonas dele. */
function Avatar({
  seat,
  player,
  selected,
  onSelect,
  className = 'h-9 w-9 text-base',
}: {
  seat: number
  player: TablePlayer | null
  selected: boolean
  onSelect: () => void
  className?: string
}) {
  const t = useT()
  return (
    <button
      onClick={onSelect}
      disabled={!player}
      title={player ? t('Show zones of {name}', { name: player.name }) : undefined}
      aria-pressed={selected}
      className={`font-display grid shrink-0 place-items-center rounded-full bg-ink ring-2 transition ${SEAT_RING[seat - 1]} ${
        selected ? 'ring-offset-2 ring-offset-ink' : ''
      } ${player ? `hover:brightness-125 ${player.online ? '' : 'opacity-40'}` : 'opacity-25'} ${className}`}
    >
      <span className={SEAT_TEXT[seat - 1]}>{player ? player.name.slice(0, 1).toUpperCase() : '·'}</span>
    </button>
  )
}

/** Campo de um jogador: a mesa limpa, com o nome em marca d'água (as cartas chegam na Fase 1). */
function Board({
  seat,
  player,
  size,
  selected,
  onSelect,
}: {
  seat: number
  player: TablePlayer | null
  size: 'large' | 'small'
  selected: boolean
  onSelect: () => void
}) {
  const t = useT()
  const large = size === 'large'
  return (
    <div
      className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-gradient-to-b to-transparent [&+&]:border-t [&+&]:border-line ${SEAT_TINT[seat - 1]}`}
    >
      <div className="absolute top-2 left-2 flex items-center gap-2">
        <Avatar
          seat={seat}
          player={player}
          selected={selected}
          onSelect={onSelect}
          className={large ? 'h-8 w-8 text-sm' : 'h-6 w-6 text-xs'}
        />
        {player && <span className="text-xs font-semibold text-parchment/60">{player.life}</span>}
      </div>
      <span
        className={`font-display truncate px-4 text-parchment/[0.07] select-none ${large ? 'text-5xl xl:text-7xl' : 'text-2xl xl:text-3xl'}`}
      >
        {player?.name ?? t('Open seat')}
      </span>
    </div>
  )
}

/** Faixa de baixo: zonas do jogador selecionado, sua mão e as ações. */
function HandBar({
  seat,
  player,
  mine,
  onShowMine,
}: {
  seat: number
  player: TablePlayer | null
  mine: boolean
  onShowMine: () => void
}) {
  const t = useT()
  const actions = [t('Draw'), t('Untap all'), t('Shuffle'), t('Mulligan')]
  const zones = [t('Facedown pile'), t('Exile'), t('Graveyard')]
  return (
    <div className="flex flex-wrap items-stretch gap-3 border-t border-line px-3 py-2">
      <div className="flex flex-col">
        <p className="mb-1 flex items-center gap-2 text-[0.7rem] font-semibold tracking-wide uppercase">
          <span className={SEAT_TEXT[seat - 1]}>{t('Zones · {name}', { name: player?.name ?? '—' })}</span>
          {!mine && (
            <button
              onClick={onShowMine}
              className="font-normal text-parchment/50 normal-case underline hover:text-gold"
            >
              {t('Show my zones')}
            </button>
          )}
        </p>
        <div className="flex gap-1.5">
          {zones.map((z) => (
            <div
              key={z}
              className="grid h-20 w-16 place-items-center rounded-md border border-dashed border-parchment/15 px-1 text-center text-[0.65rem] leading-tight text-parchment/45"
            >
              {z}
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-w-40 flex-1 items-center justify-center rounded-md border border-dashed border-parchment/10 text-xs text-parchment/30">
        {t('Your hand')} · {t('Cards arrive in phase 1.')}
      </div>
      <div className="flex flex-wrap content-center gap-1.5">
        {actions.map((a) => (
          <button
            key={a}
            disabled
            title={t('Coming in phase 1')}
            className="cursor-not-allowed rounded-md border border-line px-2.5 py-1 text-xs text-parchment/40"
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  )
}

function PlayerPanel({
  seat,
  player,
  mine,
  selected,
  onSelect,
  onChange,
}: {
  seat: number
  player: TablePlayer | null
  mine: boolean
  selected: boolean
  onSelect: () => void
  onChange: (delta: number) => void
}) {
  const t = useT()
  const btn =
    'rounded-md border border-line px-2 py-1 text-sm font-semibold transition hover:border-parchment/40 hover:bg-parchment/10 active:scale-95'
  return (
    <div
      className={`rounded-lg border border-l-4 bg-surface p-2.5 transition ${SEAT_BORDER[seat - 1]} ${selected ? 'border-parchment/30' : 'border-line'}`}
    >
      <div className="flex items-center gap-2.5">
        <Avatar seat={seat} player={player} selected={selected} onSelect={onSelect} />
        <div className="min-w-0">
          <p className={`truncate text-sm font-semibold ${player ? '' : 'text-parchment/40'}`}>
            {player?.name ?? t('Open seat')}
            {mine && <span className="ml-1 text-xs font-normal text-gold">({t('you')})</span>}
          </p>
          {player && !player.online && <p className="text-xs text-parchment/40">{t('offline')}</p>}
        </div>
        <span
          key={player?.life}
          className="font-display ml-auto animate-[fade-in_0.3s_ease-out] text-4xl tabular-nums"
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
