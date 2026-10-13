import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Droplet,
  Flame,
  Leaf,
  Moon,
  ArrowDownFromLine,
  ArrowUpFromLine,
  Ban,
  Hand,
  RotateCw,
  X,
  Keyboard,
  Library,
  Power,
  History,
  Settings,
  Undo2,
  RefreshCw,
  RotateCcw,
  ScanEye,
  Search,
  Share2,
  Shuffle,
  Sparkles,
  Rows3,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import DeckPicker from '../components/table/DeckPicker'
import {
  DiceButtons,
  EndGameDialog,
  GameOverOverlay,
  HotkeyHelp,
  LibraryViewer,
  LogSounds,
  RevealOverlay,
  RollOverlay,
  TargetArrows,
  TokenPicker,
} from '../components/table/TableExtras'
import { useDeckImagePreload } from '../hooks/useDeckImagePreload'
import { useTableHotkeys } from '../hooks/useTableHotkeys'
import { isMuted, setMuted } from '../lib/tableSounds'
import { BOARD_CARD, HAND_CARD, getTableSettings, updateTableSettings, useTableSettings } from '../lib/tableSettings'
import TableSettingsDialog from '../components/table/TableSettings'
import { setHoverPreview, useHoverPreview } from '../lib/hoverPreview'
import { Tombstone } from '../lib/icons'
import {
  CardBack,
  CardMenu,
  CardPreviewPanel,
  CardView,
  DropZone,
  IconButton,
  LibraryMenu,
  SymbolStrip,
  ZoneViewer,
} from '../components/table/TableKit'
import {
  CARD_RATIO,
  TableCtx,
  dragInfo,
  useTable,
  zoneLabel,
  type HoverTarget,
  type MenuTarget,
  type PickMode,
  pointer,
  symbolLabel,
} from '../components/table/tableUtils'
import {
  useTableSocket,
  type UndoRequest,
  type FieldCard,
  type LogItem,
  type TableCard,
  type TablePlayer,
  type ZoneName,
} from '../hooks/useTableSocket'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import type { MyTable } from '../lib/types'
import { readJSON, writeJSON } from '../lib/storage'

/*
 * Mesa virtual — Fase 1 do roadmap: cartas de verdade.
 * O servidor guarda a partida e manda a cada jogador a própria visão (mão e grimório dos outros
 * só como quantidade). Arraste as suas cartas entre o campo, a mão e as zonas; botão direito
 * abre o menu da carta; dois cliques viram/desviram no campo.
 */

// Cor de cada cadeira (classes escritas por extenso para o Tailwind encontrar)
const SEAT_BORDER = ['border-l-gold', 'border-l-sky-400', 'border-l-emerald-400', 'border-l-violet-400']
const SEAT_TEXT = ['text-gold', 'text-sky-400', 'text-emerald-400', 'text-violet-400']
const SEAT_RING = ['ring-gold', 'ring-sky-400', 'ring-emerald-400', 'ring-violet-400']
// Ícone de cada cadeira (no lugar da inicial do nome), um por cor
const SEAT_ICONS = [Flame, Droplet, Leaf, Moon]
const SEAT_TINT = ['from-gold/[0.08]', 'from-sky-400/[0.08]', 'from-emerald-400/[0.08]', 'from-violet-400/[0.08]']

// Split: o oponente em foco aparece grande e os outros pequenos ao lado. Full: todos do mesmo tamanho.
type ViewMode = 'split' | 'full'
const VIEW_KEY = 'precon-draft:table-view'
// Largura das cartas no campo (px): as posições são frações do campo, então valem nos dois tamanhos
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export default function TablePage() {
  const { code } = useParams()
  return code ? <TableRoom code={code.toUpperCase()} /> : <TableLobby />
}

const randomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n % 32]).join('')

function TableLobby() {
  const t = useT()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  useTitle(t('Virtual table'))
  // Mesas abertas em que você tem lugar; atualiza sozinho (quem está online e o prazo de inatividade)
  const mine = useQuery({ queryKey: ['tables', 'mine'], queryFn: api.myTables, refetchInterval: 15_000 })
  const tables = mine.data?.tables ?? []
  const idleMinutes = Math.round((mine.data?.idle_close ?? 600) / 60)
  const join = (e: FormEvent) => {
    e.preventDefault()
    const clean = code.trim().toUpperCase()
    if (/^[A-Z0-9]{4,12}$/.test(clean)) navigate(`/mesa/${clean}`)
  }
  return (
    <div className="mx-auto max-w-3xl py-6">
      <p className="text-sm font-semibold tracking-wide text-gold uppercase">{t('Beta')}</p>
      <h1 className="font-display mt-1 text-5xl">{t('Virtual table')}</h1>
      <p className="mt-4 text-parchment/70">
        {t('Play Commander online with up to 4 players: pick a precon or a deck from your pool and share the link.')}
      </p>

      <section className="mt-10" aria-labelledby="my-tables">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="my-tables" className="font-display text-2xl">
            {t('Your active tables')}
          </h2>
          <span className="text-xs text-parchment/50">
            {t('Tables close after {n} minutes without changes.', { n: idleMinutes })}
          </span>
        </div>
        {mine.isPending ? (
          <div className="mt-4 h-24 animate-pulse rounded-lg border border-line bg-surface" />
        ) : mine.isError ? (
          <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm text-parchment/70">
            {t('Could not load your tables.')}{' '}
            <button onClick={() => mine.refetch()} className="text-gold underline">
              {t('Try again')}
            </button>
          </p>
        ) : tables.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line p-6 text-center text-sm text-parchment/60">
            {t('You have no open tables right now. Open a new one or join with a code.')}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {tables.map((table) => (
              <MyTableRow key={table.code} table={table} fetchedAt={mine.dataUpdatedAt} />
            ))}
          </ul>
        )}
      </section>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4">
          <h2 className="font-semibold">{t('New table')}</h2>
          <p className="mt-1 text-sm text-parchment/60">{t('Get a code and send the link to your group.')}</p>
          <button
            onClick={() => navigate(`/mesa/${randomCode()}`)}
            className="font-display mt-4 w-full rounded-md bg-gold px-6 py-2.5 text-xl text-ink transition hover:brightness-110"
          >
            {t('Open a new table')}
          </button>
        </div>
        <form onSubmit={join} className="rounded-lg border border-line bg-surface p-4">
          <h2 className="font-semibold">{t('Join with a code')}</h2>
          <p className="mt-1 text-sm text-parchment/60">{t('A friend opened a table? Type the code.')}</p>
          <div className="mt-4 flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('Table code')}
              aria-label={t('Table code')}
              maxLength={12}
              className="min-w-0 flex-1 rounded-md border border-line bg-ink px-3 py-2 tracking-widest uppercase placeholder:tracking-normal placeholder:normal-case focus:border-gold focus:outline-none"
            />
            <button className="rounded-md border border-parchment/30 px-4 py-2 font-semibold transition hover:bg-parchment/10">
              {t('Join')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function MyTableRow({ table, fetchedAt }: { table: MyTable; fetchedAt: number }) {
  const t = useT()
  const [now, setNow] = useState(fetchedAt)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, table.idle_left - Math.max(0, now - fetchedAt) / 1000)
  const minutes = Math.ceil(left / 60)
  const online = table.players.filter((p) => p.online).length
  return (
    <li className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-2xl tracking-widest">{table.code}</span>
          <span className="text-xs text-parchment/60">
            {table.finished ? t('Game over') : table.turn ? t('Turn {n}', { n: table.turn }) : t('Waiting to start')}
          </span>
          {online > 0 && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {t('{n} online', { n: online })}
            </span>
          )}
        </div>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {table.players.map((p) => (
            <li
              key={p.seat}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                p.you ? 'border-gold/50 text-parchment' : 'border-line text-parchment/70'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${p.online ? 'bg-emerald-400' : 'bg-parchment/25'}`} />
              <span className="font-semibold">{p.you ? t('You') : p.name}</span>
              {p.deck && <span className="max-w-40 truncate text-parchment/50">· {p.deck}</span>}
            </li>
          ))}
        </ul>
        <p className={`mt-2 text-xs ${minutes <= 2 ? 'text-gold' : 'text-parchment/50'}`}>
          {t('{seated}/{max} players', { seated: table.players.length, max: table.max_seats })} ·{' '}
          {minutes <= 1
            ? t('Closes in less than a minute without changes')
            : t('Closes in {n} min without changes', { n: minutes })}
        </p>
      </div>
      <Link
        to={`/mesa/${table.code}`}
        className="shrink-0 rounded-md bg-gold px-5 py-2 text-center font-semibold text-ink transition hover:brightness-110"
      >
        {t('Rejoin')}
      </Link>
    </li>
  )
}

// Aviso de inatividade: aparece nos últimos 2 minutos antes da mesa fechar
const IDLE_WARN = 120

function IdleWarning({ closesAt, onKeep }: { closesAt: number; onKeep: () => void }) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, Math.ceil((closesAt - now) / 1000))
  if (left > IDLE_WARN) return null
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold"
    >
      <span>{t('No changes for a while: this table closes in {time}.', { time: clock })}</span>
      <button
        onClick={onKeep}
        className="rounded-full bg-gold px-3 py-0.5 text-xs font-semibold text-ink transition hover:brightness-110"
      >
        {t('Keep table open')}
      </button>
    </div>
  )
}

const ERRORS: Record<string, string> = {
  library_empty: 'Your library is empty.',
  deck_not_found: 'Deck not found.',
  no_deck: 'Choose a deck first.',
  not_your_card: 'You can only move your own cards.',
  not_controller: 'Only the player who controls this card can change its counters and power/toughness.',
  nothing_to_undo: 'Nothing of yours to undo.',
  undo_conflict: 'Can’t undo: someone changed those cards after your action.',
  undo_pending: 'There is already an undo request waiting for an answer.',
}

function TableRoom({ code }: { code: string }) {
  const t = useT()
  const { table, status, error, send, outdated, peek, closePeek, logStart, turnStart, closesAt, closed } =
    useTableSocket(code)
  const navigate = useNavigate()
  const [confirmClose, setConfirmClose] = useState(false)
  const [copied, setCopied] = useState(false)
  const [view, setViewState] = useState<ViewMode>(() =>
    readJSON<string>(VIEW_KEY, 'split') === 'full' ? 'full' : 'split',
  )
  // Oponente em foco no modo split e jogador cujas zonas aparecem ao lado da mão
  // Escolha manual do oponente em foco: vale só no turno em que foi feita
  const [focusPick, setFocusPick] = useState<{ seat: number; turn: number } | null>(null)
  const [zonesSeat, setZonesSeat] = useState<number | null>(null)
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [viewer, setViewer] = useState<{ seat: number; zone: ZoneName } | null>(null)
  const [picking, setPicking] = useState(false)
  const [tokens, setTokens] = useState(false)
  const [help, setHelp] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [ending, setEnding] = useState(false)
  // Tela de fim de partida fechada por você (vale só para aquele resultado)
  const [resultSeen, setResultSeen] = useState('')
  const [muted, setMutedState] = useState(isMuted)
  const hovered = useRef<HoverTarget | null>(null)
  // Carta revelada e dado/moeda: mostram a última novidade que chegou depois de abrir a mesa
  const [revealSeen, setRevealSeen] = useState(0)
  // Cartas sacudidas há pouco (id da carta → registro do log); somem 1,3 s depois da última
  const [shakeSeen, setShakeSeen] = useState(0)
  const [rollSeen, setRollSeen] = useState(0)
  // Erro do servidor aparece por 3 s (dismissed = hora do último erro já escondido)
  const [dismissed, setDismissed] = useState(0)
  useTitle(t('Table {code}', { code }))

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setDismissed(error.at), 3000)
    return () => clearTimeout(timer)
  }, [error])
  const toast =
    error && error.at > dismissed && error.code !== 'too_fast'
      ? t(ERRORS[error.code] ?? 'That action is not allowed.')
      : null

  // Com a janela do grimório aberta, cada mudança na mesa atualiza as cartas (sem novo registro no log)
  const peekRef = useRef(peek)
  useEffect(() => {
    peekRef.current = peek
  }, [peek])
  useEffect(() => {
    const p = peekRef.current
    if (p) send({ type: 'peek', n: p.mode === 'top' ? p.ids.length : null, quiet: true })
  }, [table, send])

  const log = table?.log ?? []
  const lastReveal = log.findLast((e) => e.kind === 'reveal')
  const shakeFrom = Math.max(logStart ?? Infinity, shakeSeen)
  const shakeKey = log
    .filter((e) => e.kind === 'shake' && e.ref && (e.id ?? 0) > shakeFrom)
    .map((e) => `${e.ref}:${e.id}`)
    .join(',')
  const shaking = useMemo(
    () => new Map(shakeKey ? shakeKey.split(',').map((p) => [p.split(':')[0], Number(p.split(':')[1])]) : []),
    [shakeKey],
  )
  const lastShake = shaking.size ? Math.max(...shaking.values()) : 0
  useEffect(() => {
    if (!lastShake) return
    const timer = setTimeout(() => setShakeSeen(lastShake), 1300)
    return () => clearTimeout(timer)
  }, [lastShake])
  const showReveal = lastReveal && (lastReveal.id ?? 0) > Math.max(logStart ?? Infinity, revealSeen) ? lastReveal : null
  const doneReveal = useCallback(() => setRevealSeen(lastReveal?.id ?? 0), [lastReveal?.id])
  const lastRoll = log.findLast((e) => e.kind === 'roll')
  const showRoll = lastRoll && (lastRoll.id ?? 0) > Math.max(logStart ?? Infinity, rollSeen) ? lastRoll : null
  const doneRoll = useCallback(() => setRollSeen(lastRoll?.id ?? 0), [lastRoll?.id])

  const me = table?.players.find((p) => p.id === table.you) ?? null
  const turnNumber = table?.turn.number ?? 0
  useDeckImagePreload(me?.deck)
  const activePlayer = table?.players.find((p) => p.id === table.turn.player) ?? null
  const myTurn = !!me && activePlayer?.id === me.id
  // Ao receber o turno: oferece desvirar tudo + comprar (ou faz sozinho, se marcado)
  const settings = useTableSettings()
  const autoUntap = settings.autoUntap
  const [promptDone, setPromptDone] = useState(0)
  const freshTurn = myTurn && !!me?.deck && turnNumber > Math.max(turnStart ?? Infinity, promptDone)
  const autoDone = useRef(0)
  useEffect(() => {
    if (freshTurn && autoUntap && autoDone.current < turnNumber) {
      autoDone.current = turnNumber
      send({ type: 'untap_all' })
      send({ type: 'draw', n: 1 })
    }
  }, [freshTurn, autoUntap, turnNumber, send])
  const showTurnPrompt = freshTurn && !autoUntap
  // "Mirar…" e "Prender em…": o próximo clique numa carta do campo (ou num jogador, ao mirar) escolhe
  const [choosing, setChoosing] = useState<{
    mode: PickMode
    card: string
    name: string
    kind?: TableCard['attach']
  } | null>(null)
  const choosingRef = useRef(choosing)
  useEffect(() => {
    choosingRef.current = choosing
  })
  useEffect(() => {
    if (!choosing) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setChoosing(null)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [choosing])
  const startPick = useCallback(
    (mode: PickMode, card: TableCard) => {
      setMenu(null)
      setChoosing({ mode, card: card.id, name: card.name, kind: card.attach })
    },
    [setChoosing],
  )
  const pickCard = useCallback(
    (id: string, zone: ZoneName) => {
      const c = choosingRef.current
      if (!c) return false
      if (zone === 'battlefield' && id !== c.card) {
        send(
          c.mode === 'target'
            ? { type: 'target', card: c.card, to_card: id }
            : { type: 'attach', card: c.card, to: id },
        )
      }
      setChoosing(null)
      return true
    },
    [send, setChoosing],
  )
  // Várias cartas selecionadas (Ctrl/Shift + clique, ou arrastar um retângulo no campo vazio)
  const [selection, setSelection] = useState<Set<string>>(() => new Set())
  const fieldKey = (table?.players ?? []).flatMap((p) => p.battlefield.map((c) => c.id)).join(',')
  // Só valem as que ainda estão no campo
  const selected = useMemo(() => {
    const onField = new Set(fieldKey.split(','))
    return new Set([...selection].filter((id) => onField.has(id)))
  }, [selection, fieldKey])
  const selectedRef = useRef(selected)
  useEffect(() => {
    selectedRef.current = selected
  })
  const toggleSelect = useCallback(
    (id: string) =>
      setSelection((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    [setSelection],
  )
  const clearSelection = useCallback(() => setSelection((prev) => (prev.size ? new Set() : prev)), [setSelection])
  const selectionTapped = () => {
    const field = (table?.players ?? []).flatMap((p) => p.battlefield).filter((c) => selected.has(c.id))
    return field.length > 0 && field.every((c) => c.tapped)
  }
  const sendSelection = (action: 'tap' | ZoneName, position?: 'top' | 'bottom') => {
    const cards = [...selected]
    if (!cards.length) return
    if (action === 'tap') send({ type: 'tap_many', cards, tapped: !selectionTapped() })
    else {
      send({ type: 'move_many', cards, to: action, position })
      clearSelection()
    }
  }

  useTableHotkeys({
    send,
    me,
    selection: () => [...selectedRef.current],
    onSelection: (action, position) => sendSelection(action, position),
    clearSelection,
    openNote: (card) => setMenu({ card, zone: 'battlefield', x: pointer.x, y: pointer.y, sub: 'note' }),
    hovered: () => hovered.current,
    clearHover: () => {
      hovered.current = null
      setHoverPreview(null)
    },
    openTokens: () => setTokens(true),
    openHelp: () => setHelp(true),
    peek: (n) => send({ type: 'peek', n }),
    startPick,
  })

  const closeMenu = useCallback(() => setMenu(null), [])
  // Lista estável (só muda quando alguém senta): o contexto não redesenha todas as cartas a cada ação
  const playersKey = (table?.players ?? []).map((p) => `${p.id}\t${p.seat}\t${p.name}`).join('\n')
  const playerList = useMemo(
    () =>
      playersKey
        ? playersKey.split('\n').map((line) => {
            const [id, seat, name] = line.split('\t')
            return { id: Number(id), seat: Number(seat), name }
          })
        : [],
    [playersKey],
  )
  const ctx = useMemo(
    () => ({
      send,
      you: table?.you ?? 0,
      players: playerList,
      preview: (card: TableCard | null, x = 0, hover?: HoverTarget) => {
        hovered.current = card ? (hover ?? null) : null
        clearTimeout(previewTimer.current)
        const next = card ? { card, side: (x > window.innerWidth / 2 ? 'left' : 'right') as 'left' | 'right' } : null
        const delay = getTableSettings().previewDelay
        // Com espera configurada, a carta só amplia se o mouse ficar em cima dela
        if (next && delay > 0) previewTimer.current = setTimeout(() => setHoverPreview(next), delay)
        else setHoverPreview(next)
      },
      openMenu: setMenu,
      startPick,
      pickCard,
      toggleSelect,
    }),
    [send, table?.you, playerList, startPick, pickCard, toggleSelect],
  )

  if (status === 'closed') {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="font-display text-3xl">{t('Table closed')}</p>
        <p className="mt-3 text-parchment/70">
          {closed?.reason === 'closed' && closed.by
            ? t('{name} closed the table.', { name: closed.by })
            : t('The table was closed after {n} minutes without changes.', {
                n: Math.round((table?.idle_close ?? 600) / 60),
              })}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/mesa"
            className="rounded-md border border-parchment/30 px-4 py-2 font-semibold transition hover:bg-parchment/10"
          >
            {t('Back to tables')}
          </Link>
          <button
            onClick={() => navigate(`/mesa/${randomCode()}`)}
            className="rounded-md bg-gold px-4 py-2 font-semibold text-ink transition hover:brightness-110"
          >
            {t('Open a new table')}
          </button>
        </div>
      </div>
    )
  }

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
  // Oponentes na ordem do turno, começando por quem senta depois de você
  const mySeat = me?.seat ?? 1
  const order = Array.from({ length: maxSeats - 1 }, (_, i) => ((mySeat + i) % maxSeats) + 1)
  // Só os lugares ocupados ganham campo (num 1 contra 1 o oponente ocupa a faixa toda);
  // mesa sem oponentes mostra um lugar livre, para lembrar de mandar o convite
  const taken = order.filter((s) => bySeat.has(s))
  const others = taken.length ? taken : order.slice(0, 1)
  // No split, o campo grande é o de quem está jogando (ou o que você escolheu neste turno)
  const activeSeat = table?.players.find((p) => p.id === table.turn.player)?.seat
  const focus =
    focusPick && focusPick.turn === turnNumber && others.includes(focusPick.seat)
      ? focusPick.seat
      : activeSeat && others.includes(activeSeat)
        ? activeSeat
        : others[0]
  const rest = others.filter((s) => s !== focus)
  const zones = zonesSeat ?? mySeat

  const setView = (v: ViewMode) => {
    setViewState(v)
    writeJSON(VIEW_KEY, v)
  }
  // Clicar num jogador mostra as zonas dele ao lado da mão (e, no split, traz o campo dele para o foco)
  const selectPlayer = (seat: number) => {
    const c = choosingRef.current
    if (c) {
      // Mirando: clicar num jogador (foto ou campo vazio) mira nele
      const target = bySeat.get(seat)
      if (c.mode === 'target' && target) send({ type: 'target', card: c.card, to_player: target.id })
      setChoosing(null)
      return
    }
    setZonesSeat(seat === mySeat ? null : seat)
    if (seat !== mySeat) setFocusPick({ seat, turn: turnNumber })
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
      mine={seat === mySeat && !!me}
      selected={zones === seat}
      active={!!activeSeat && activeSeat === seat}
      onSelect={() => selectPlayer(seat)}
      onPickDeck={() => setPicking(true)}
      onOpenZone={(zone) => setViewer({ seat, zone })}
      choosing={!!choosing}
      shaking={shaking}
      selection={selected}
      onMarquee={(ids, add) => setSelection((prev) => new Set(add ? [...prev, ...ids] : ids))}
      onClearSelection={clearSelection}
    />
  )
  const viewerPlayer = viewer ? bySeat.get(viewer.seat) : undefined
  // Prévia com o estado mais novo da carta (ex.: nota escrita enquanto o mouse está em cima)

  return (
    <TableCtx.Provider value={ctx}>
      <div className="flex flex-col lg:h-[calc(100dvh-4.25rem)] lg:min-h-[40rem]">
        {/* Barra da mesa */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 text-sm">
          <span className="font-display text-xl">{t('Table {code}', { code })}</span>
          <IconButton
            size="sm"
            icon={Share2}
            label={copied ? t('Link copied') : t('Copy invite link')}
            active={copied}
            tipSide="bottom"
            onClick={copy}
          />
          <span className="flex items-center gap-1.5 text-xs text-parchment/60" role="status">
            <span
              className={`h-2 w-2 rounded-full ${status === 'open' ? 'bg-emerald-400' : 'animate-pulse bg-gold'}`}
            />
            {status === 'open' ? t('Connected') : status === 'reconnecting' ? t('Reconnecting…') : t('Connecting…')}
          </span>
          <span className="flex items-center gap-2 rounded-full border border-line py-0.5 pr-0.5 pl-3 text-xs">
            {activePlayer ? (
              <span className={myTurn ? 'font-semibold text-gold' : 'text-parchment/70'}>
                {t('Turn {n}', { n: turnNumber })} ·{' '}
                {myTurn ? t('Your turn') : t("{name}'s turn", { name: activePlayer.name })}
              </span>
            ) : (
              <span className="text-parchment/50">{t('No turns yet')}</span>
            )}
            <button
              onClick={() => send({ type: 'pass_turn' })}
              disabled={!me || (!!activePlayer && !myTurn && activePlayer.online)}
              title={t('Hotkey: E')}
              className="rounded-full bg-gold px-2.5 py-0.5 font-semibold text-ink transition hover:brightness-110 disabled:bg-parchment/10 disabled:text-parchment/40"
            >
              {activePlayer ? t('Pass turn') : t('Start: I go first')}
            </button>
          </span>
          <span className="hidden text-xs text-parchment/40 2xl:inline">
            {t('Drag your cards · right-click for options · double-click to tap')}
          </span>
          <span className="flex items-center gap-1">
            <IconButton
              size="sm"
              icon={Undo2}
              label={
                table?.undo.last
                  ? t('Undo: {action}', { action: actionText(t, table.undo.last) })
                  : t('Nothing to undo')
              }
              hotkey="Ctrl+Z"
              tipSide="bottom"
              disabled={!me || !table?.undo.count || !!table?.undo.request}
              onClick={() => send({ type: 'undo' })}
            />
            <IconButton
              size="sm"
              icon={Settings}
              label={t('Table settings')}
              tipSide="bottom"
              onClick={() => setShowSettings(true)}
            />
            <IconButton
              size="sm"
              icon={Keyboard}
              label={t('Hotkeys')}
              hotkey="?"
              tipSide="bottom"
              onClick={() => setHelp(true)}
            />
            <IconButton
              size="sm"
              icon={muted ? VolumeX : Volume2}
              label={muted ? t('Sound off') : t('Sound on')}
              tipSide="bottom"
              onClick={() => {
                setMuted(!muted)
                setMutedState(!muted)
              }}
            />
            <IconButton
              size="sm"
              icon={Power}
              tone="danger"
              active={confirmClose}
              label={confirmClose ? t('Click again to close for everyone') : t('Close table')}
              tipSide="bottom"
              disabled={!me}
              onClick={() => {
                if (!confirmClose) {
                  setConfirmClose(true)
                  setTimeout(() => setConfirmClose(false), 3000)
                  return
                }
                send({ type: 'close_table' })
              }}
            />
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

        {outdated && (
          <p role="alert" className="border-b border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold">
            {t(
              'The server is still running an older version of the table. Wait for the backend deploy to finish and reload.',
            )}
          </p>
        )}
        {closesAt && status === 'open' && (
          <IdleWarning closesAt={closesAt} onKeep={() => send({ type: 'keep_alive' })} />
        )}
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <section className="flex min-h-0 flex-col">
            {/* Oponentes */}
            {view === 'split' && rest.length > 0 ? (
              <div className="grid min-h-[13rem] grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] border-b border-line lg:min-h-0 lg:flex-[2]">
                <div className="flex min-h-0 flex-col border-r border-line">{rest.map((s) => board(s, 'small'))}</div>
                {board(focus, 'large')}
              </div>
            ) : (
              <div
                className={`grid min-h-[13rem] border-b border-line lg:min-h-0 lg:flex-[2] [&>*+*]:border-l [&>*+*]:border-line ${
                  ['grid-cols-1', 'grid-cols-2', 'grid-cols-3'][others.length - 1]
                }`}
              >
                {others.map((s) => board(s, others.length === 1 ? 'large' : 'small'))}
              </div>
            )}

            {/* Seu campo: sempre o maior */}
            <div className="flex min-h-[18rem] lg:min-h-0 lg:flex-[3]">{board(mySeat, 'large')}</div>

            <HandBar
              seat={zones}
              player={bySeat.get(zones) ?? null}
              me={me}
              onShowMine={() => setZonesSeat(null)}
              onOpenZone={(zone) => setViewer({ seat: zones, zone })}
              onPickDeck={() => setPicking(true)}
              onPeek={(n) => send({ type: 'peek', n })}
              onEndGame={() => setEnding(true)}
              onTokens={() => setTokens(true)}
              onHistory={() => setShowHistory(true)}
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
                    others={(table?.players ?? []).filter((o) => o.id !== p?.id)}
                  />
                )
              })}
            </div>
            <TableLog log={log} onChat={(text) => send({ type: 'chat', text })} />
          </aside>
        </div>
      </div>

      <PreviewHost players={table?.players} />
      {menu && <CardMenu target={menu} onClose={closeMenu} />}
      {peek && (
        <LibraryViewer
          mode={peek.mode}
          cards={peek.mode === 'top' ? peek.cards.filter((c) => peek.ids.includes(c.id)) : peek.cards}
          onClose={closePeek}
        />
      )}
      {tokens && <TokenPicker onClose={() => setTokens(false)} />}
      {showReveal && <RevealOverlay entry={showReveal} onDone={doneReveal} />}
      {showRoll && !showReveal && <RollOverlay entry={showRoll} onDone={doneRoll} />}
      {help && <HotkeyHelp onClose={() => setHelp(false)} />}
      {ending && table && (
        <EndGameDialog
          players={table.players.map((p) => ({ id: p.id, name: p.name }))}
          onClose={() => setEnding(false)}
          onConfirm={(winner) => {
            send({ type: 'end_game', winner })
            setEnding(false)
          }}
        />
      )}
      {table?.result && resultSeen !== JSON.stringify(table.result) && (
        <GameOverOverlay
          winner={table.result.winner_name}
          fromDraw={table.dealt.length > 0}
          onNewGame={() => send({ type: 'new_game' })}
          onClose={() => setResultSeen(JSON.stringify(table.result))}
        />
      )}
      {showTurnPrompt && (
        <TurnPrompt
          turn={turnNumber}
          onAction={(untap, draw) => {
            if (untap) send({ type: 'untap_all' })
            if (draw) send({ type: 'draw', n: 1 })
            setPromptDone(turnNumber)
          }}
          onAuto={() => updateTableSettings({ autoUntap: true })}
        />
      )}
      <LogSounds log={log} start={logStart} />
      {showHistory && table && (
        <HistoryDialog
          log={table.log}
          checkpoints={table.undo.checkpoints}
          pending={!!table.undo.request}
          onRewind={(to) => {
            send({ type: 'rewind', to })
            setShowHistory(false)
          }}
          onClose={() => setShowHistory(false)}
        />
      )}
      {table?.undo.request && me && (
        <UndoBanner
          request={table.undo.request}
          you={me.id}
          onVote={(approve) => send({ type: 'undo_vote', approve })}
        />
      )}
      {showSettings && (
        <TableSettingsDialog
          sample={me?.battlefield.find((c) => c.commander && c.image) ?? me?.battlefield.find((c) => c.image) ?? null}
          muted={muted}
          onMuted={(m) => {
            setMuted(m)
            setMutedState(m)
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      <TargetArrows log={log} start={logStart} />
      {selected.size > 0 && (
        <div
          role="toolbar"
          aria-label={t('Selected cards')}
          className="fixed bottom-40 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-sky-400/60 bg-ink/95 py-1 pr-1 pl-4 text-sm shadow-2xl shadow-black"
        >
          <span className="mr-2 whitespace-nowrap text-sky-300">{t('{n} selected', { n: selected.size })}</span>
          <IconButton
            size="sm"
            icon={selectionTapped() ? RotateCcw : RotateCw}
            label={selectionTapped() ? t('Untap selected') : t('Tap selected')}
            hotkey={t('Space')}
            onClick={() => sendSelection('tap')}
          />
          <IconButton
            size="sm"
            icon={Hand}
            label={t('Return to hand')}
            hotkey="R"
            onClick={() => sendSelection('hand')}
          />
          <IconButton
            size="sm"
            icon={Tombstone}
            label={t('Send to graveyard')}
            hotkey="D"
            onClick={() => sendSelection('graveyard')}
          />
          <IconButton
            size="sm"
            icon={Ban}
            label={t('Send to exile')}
            hotkey="S"
            onClick={() => sendSelection('exile')}
          />
          <IconButton
            size="sm"
            icon={ArrowUpFromLine}
            label={t('Put on top of library')}
            hotkey="T"
            onClick={() => sendSelection('library', 'top')}
          />
          <IconButton
            size="sm"
            icon={ArrowDownFromLine}
            label={t('Put on bottom of library')}
            hotkey="Y"
            onClick={() => sendSelection('library', 'bottom')}
          />
          <IconButton size="sm" icon={X} label={t('Clear selection')} hotkey="Esc" onClick={clearSelection} />
        </div>
      )}
      {choosing && (
        <div
          role="status"
          className="fixed top-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-gold/60 bg-ink/95 px-4 py-2 text-sm shadow-2xl shadow-black"
        >
          <span className="text-gold">
            {choosing.mode === 'target'
              ? t('Choose a card or a player for {card} to target', { card: choosing.name || t('a card') })
              : choosing.kind === 'equipment'
                ? t('Choose the card to equip {card} to', { card: choosing.name || t('a card') })
                : choosing.kind === 'aura'
                  ? t('Choose the card to enchant with {card}', { card: choosing.name || t('a card') })
                  : t('Choose the card to attach {card} to', { card: choosing.name || t('a card') })}
            {choosing.mode === 'attach' && (
              <span className="ml-2 text-xs text-parchment/50">{t('Esc leaves it unattached')}</span>
            )}
          </span>
          <button
            onClick={() => setChoosing(null)}
            className="rounded-full border border-line px-2 py-0.5 text-xs text-parchment/70 hover:text-parchment"
          >
            {t('Cancel')} (Esc)
          </button>
        </div>
      )}
      {viewer && viewerPlayer && (
        <ZoneViewer
          player={viewerPlayer}
          zone={viewer.zone}
          mine={viewerPlayer.id === table?.you}
          onClose={() => setViewer(null)}
        />
      )}
      {picking && (
        <DeckPicker
          dealt={table?.dealt ?? []}
          onClose={() => setPicking(false)}
          onPick={(d) => {
            send({ type: 'load_deck', kind: d.kind, ref: d.ref })
            setPicking(false)
          }}
        />
      )}
      {toast && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-gold/50 bg-surface px-4 py-2 text-sm shadow-xl"
        >
          {toast}
        </div>
      )}
    </TableCtx.Provider>
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
  const SeatIcon = SEAT_ICONS[(seat - 1) % SEAT_ICONS.length]
  return (
    <button
      data-seat-avatar={seat}
      onClick={onSelect}
      disabled={!player}
      title={player ? t('Show zones of {name}', { name: player.name }) : undefined}
      aria-pressed={selected}
      className={`font-display grid shrink-0 place-items-center rounded-full bg-ink ring-2 transition ${SEAT_RING[seat - 1]} ${
        selected ? 'ring-offset-2 ring-offset-ink' : ''
      } ${player ? `hover:brightness-125 ${player.online ? '' : 'opacity-40'}` : 'opacity-25'} ${className}`}
    >
      {player ? (
        <SeatIcon className={`h-[55%] w-[55%] ${SEAT_TEXT[seat - 1]}`} aria-label={player.name} />
      ) : (
        <span className={SEAT_TEXT[seat - 1]}>·</span>
      )}
    </button>
  )
}

/** Campo de um jogador: as cartas ficam onde o dono soltou (posição em fração do campo). */
function Board({
  seat,
  player,
  size,
  mine,
  selected,
  active,
  onSelect,
  onPickDeck,
  onOpenZone,
  choosing,
  shaking,
  selection,
  onMarquee,
  onClearSelection,
}: {
  seat: number
  player: TablePlayer | null
  size: 'large' | 'small'
  mine: boolean
  selected: boolean
  /** É o turno deste jogador */
  active: boolean
  onSelect: () => void
  onPickDeck: () => void
  onOpenZone: (zone: ZoneName) => void
  /** Escolhendo alvo: clicar no campo mira no jogador */
  choosing: boolean
  /** Cartas selecionadas (de qualquer campo) */
  selection: Set<string>
  /** Retângulo arrastado no campo vazio: seleciona as cartas dentro dele (somando, com Shift/Ctrl) */
  onMarquee: (ids: string[], add: boolean) => void
  onClearSelection: () => void
  /** Cartas sacudidas agora (id → registro do log, que reinicia a animação) */
  shaking: Map<string, number>
}) {
  const t = useT()
  const { send, you, startPick } = useTable()
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const marqueed = useRef(false) // o clique que termina um retângulo não conta como clique no campo
  const startMarquee = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || choosing || (e.target as HTMLElement).closest('[data-card-id], button')) return
    e.preventDefault()
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const x0 = e.clientX - r.left
    const y0 = e.clientY - r.top
    marqueed.current = false
    const move = (ev: globalThis.MouseEvent) => {
      const x1 = ev.clientX - r.left
      const y1 = ev.clientY - r.top
      if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > 6) marqueed.current = true
      if (marqueed.current) setBox({ x0, y0, x1, y1 })
    }
    const up = (ev: globalThis.MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setBox(null)
      if (!marqueed.current) return
      const left = r.left + Math.min(x0, ev.clientX - r.left)
      const right = r.left + Math.max(x0, ev.clientX - r.left)
      const top = r.top + Math.min(y0, ev.clientY - r.top)
      const bottom = r.top + Math.max(y0, ev.clientY - r.top)
      const ids = [...el.querySelectorAll('[data-card-id]')]
        .filter((n) => {
          const c = n.getBoundingClientRect()
          return c.right > left && c.left < right && c.bottom > top && c.top < bottom
        })
        .map((n) => n.getAttribute('data-card-id')!)
      onMarquee(ids, ev.shiftKey || ev.ctrlKey || ev.metaKey)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const large = size === 'large'
  const { boardScale, reduceMotion, showSymbols, showBoardNames } = useTableSettings()
  // Oponente: cemitério (e exílio) em pilhas no canto do campo, com a carta de cima à mostra
  const piles = !mine && !!player?.deck
  const pileW = large ? 58 : 42
  const w = Math.round(BOARD_CARD[size] * boardScale)
  const h = w * CARD_RATIO
  // Cartas presas (equipamentos, auras) aparecem atrás da carta em que estão, um pouco deslocadas
  const field = player?.battlefield ?? []
  const ids = new Set(field.map((c) => c.id))
  const attached = new Map<string, FieldCard[]>()
  for (const c of field)
    if (c.attached_to && ids.has(c.attached_to))
      attached.set(c.attached_to, [...(attached.get(c.attached_to) ?? []), c])
  const hosts = field.filter((c) => !c.attached_to || !ids.has(c.attached_to))
  const card = (c: FieldCard, host: FieldCard, k: number) => {
    // Presas: atrás da carta, um pouco para a esquerda e para cima (do ponto de vista do dono do
    // campo), sem sair do campo
    const dx = -k * w * 0.28
    const dy = k * h * 0.12 * (mine ? -1 : 1)
    return (
      <div
        key={c.id}
        className="absolute"
        // Campo dos oponentes espelhado: os terrenos deles ficam do lado deles, longe de você
        style={{
          left: `clamp(0px, calc((100% - ${w}px) * ${host.x} + ${dx}px), calc(100% - ${w}px))`,
          top: `clamp(0px, calc((100% - ${h}px) * ${mine ? host.y : 1 - host.y} + ${dy}px), calc(100% - ${h}px))`,
        }}
      >
        <div
          key={shaking.get(c.id) ?? 0}
          className={
            shaking.has(c.id)
              ? `${reduceMotion ? '' : 'animate-[card-shake_0.55s_ease-in-out_2]'} rounded-[6%] shadow-[0_0_0_2px_#e4572e,0_0_22px_rgba(228,87,46,0.75)]`
              : ''
          }
        >
          <CardView
            card={c}
            zone="battlefield"
            // Arrasta quem controla a carta (a sua, ou uma que te deram o controle)
            mine={mine && (c.controller ?? c.owner) === you}
            selected={selection.has(c.id)}
            width={w}
            tapped={c.tapped}
            tax={c.commander && c.owner === player?.id ? player.tax[c.id] : undefined}
            onDoubleClick={mine ? () => send({ type: 'tap', card: c.id }) : undefined}
          />
        </div>
        {showSymbols && <SymbolStrip symbols={c.symbols} small={!large} side={host.x > 0.92 ? 'left' : 'right'} />}
      </div>
    )
  }
  const zoneChip = (zone: 'graveyard' | 'exile', Icon: typeof Ban) =>
    player?.deck && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenZone(zone)
        }}
        title={t('View {zone} of {name}', { zone: zoneLabel(t, zone), name: player.name })}
        aria-label={t('View {zone} of {name}', { zone: zoneLabel(t, zone), name: player.name })}
        className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 transition hover:border-gold hover:text-gold ${
          player.counts[zone] ? 'border-parchment/25 text-parchment/80' : 'border-line text-parchment/40'
        }`}
      >
        <Icon className="h-3 w-3" aria-hidden />
        {player.counts[zone]}
      </button>
    )
  return (
    <DropZone
      enabled={mine && !!player?.deck}
      onCard={(card, e) => {
        // Solta no ponto onde o mouse pegou a carta, corrigindo a diferença de tamanho (mão → campo)
        const r = e.currentTarget.getBoundingClientRect()
        const scale = w / dragInfo.w
        const x = clamp01((e.clientX - dragInfo.dx * scale - r.left) / Math.max(1, r.width - w))
        const y = clamp01((e.clientY - dragInfo.dy * scale - r.top) / Math.max(1, r.height - h))
        // Arrastou uma carta selecionada: o grupo todo anda junto
        const dragged = field.find((c) => c.id === card.id)
        if (dragged && selection.has(card.id) && selection.size > 1) {
          const places = field
            .filter((c) => selection.has(c.id) && (c.controller ?? c.owner) === you && !c.locked && !c.attached_to)
            .map((c) => ({ card: c.id, x: clamp01(c.x + x - dragged.x), y: clamp01(c.y + y - dragged.y) }))
          send({ type: 'place_many', places })
          return
        }
        // Equipamento/aura solto em cima de outra carta: já prende nela
        const host = card.attach
          ? document
              .elementsFromPoint(e.clientX, e.clientY)
              .map((el) => el.closest('[data-card-id]')?.getAttribute('data-card-id'))
              .find((id) => id && id !== card.id)
          : null
        if (host) {
          if (card.from !== 'battlefield') send({ type: 'move', card: card.id, to: 'battlefield', x, y })
          send({ type: 'attach', card: card.id, to: host })
          return
        }
        send({ type: 'move', card: card.id, to: 'battlefield', x, y })
        // Equipamento/aura que acabou de entrar: pede a carta onde prender (Esc deixa solta)
        if (card.attach && card.from !== 'battlefield')
          startPick('attach', { id: card.id, name: card.name ?? '', image: '', back: '' })
      }}
      onMouseDown={startMarquee}
      // Clicar no campo (o seu ou o de outro jogador) mostra as zonas dele ao lado da mão e,
      // no split, traz o campo para o foco. Também limpa a seleção.
      onClick={() => {
        if (marqueed.current) {
          marqueed.current = false
          return
        }
        onClearSelection()
        onSelect()
      }}
      className={`relative min-h-0 flex-1 overflow-hidden bg-gradient-to-b to-transparent [&+&]:border-t [&+&]:border-line ${SEAT_TINT[seat - 1]} ${
        active ? 'shadow-[inset_0_0_0_2px_rgba(228,87,46,0.55)]' : ''
      } ${choosing ? 'cursor-crosshair' : mine ? '' : 'cursor-pointer'}`}
    >
      <span
        className={`font-display pointer-events-none absolute inset-0 grid place-items-center truncate px-4 text-parchment/[0.06] select-none ${large ? 'text-5xl xl:text-7xl' : 'text-2xl xl:text-3xl'}`}
      >
        {showBoardNames ? (player?.name ?? t('Open seat')) : ''}
      </span>
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2 text-xs text-parchment/60">
        <Avatar
          seat={seat}
          player={player}
          selected={selected}
          onSelect={onSelect}
          className={large ? 'h-8 w-8 text-sm' : 'h-6 w-6 text-xs'}
        />
        {player && (
          <>
            {active && (
              <span className="rounded bg-gold px-1.5 py-0.5 text-[0.65rem] font-bold tracking-wide text-ink uppercase">
                {t('Turn')}
              </span>
            )}
            <span className="font-semibold">{player.life}</span>
            {player.deck && (
              <span className="hidden sm:inline" title={t('Hand') + ' · ' + t('Library')}>
                ✋ {player.counts.hand} · ▤ {player.counts.library}
                {player.poison > 0 && <span className="ml-1 text-emerald-400">☠ {player.poison}</span>}
              </span>
            )}
            {/* No campo dos oponentes, cemitério e exílio ficam em pilhas no canto (abaixo) */}
            {mine && zoneChip('graveyard', Tombstone)}
            {mine && zoneChip('exile', Ban)}
          </>
        )}
      </div>
      {box && (
        <div
          className="pointer-events-none absolute z-20 rounded border border-sky-400 bg-sky-400/10"
          style={{
            left: Math.min(box.x0, box.x1),
            top: Math.min(box.y0, box.y1),
            width: Math.abs(box.x1 - box.x0),
            height: Math.abs(box.y1 - box.y0),
          }}
        />
      )}
      {piles && player && (
        <div className="absolute top-2 right-2 bottom-2 z-10 flex flex-col items-center justify-start gap-2">
          <BoardPile player={player} zone="graveyard" width={pileW} onOpen={onOpenZone} />
          {player.counts.exile > 0 && <BoardPile player={player} zone="exile" width={pileW} onOpen={onOpenZone} />}
        </div>
      )}
      {/* Cartas numa camada que deixa livre a coluna das pilhas (não ficam embaixo delas) */}
      <div className="absolute inset-y-0 left-0" style={{ right: piles ? pileW + 16 : 0 }}>
        {hosts.map((host) => [
          ...(attached.get(host.id) ?? []).map((c, i, list) => card(c, host, list.length - i)),
          card(host, host, 0),
        ])}
      </div>
      {mine && player && !player.deck && (
        <div className="absolute inset-0 grid place-items-center">
          <button
            onClick={onPickDeck}
            className="font-display rounded-md bg-gold px-6 py-3 text-xl text-ink transition hover:brightness-110"
          >
            {t('Choose your deck')}
          </button>
        </div>
      )}
    </DropZone>
  )
}

/**
 * Pilha no canto do campo de um oponente (cemitério ou exílio): a carta de cima à mostra, a
 * quantidade e o ícone da zona. Clique abre a lista; passar o mouse amplia a carta de cima.
 */
function BoardPile({
  player,
  zone,
  width,
  onOpen,
}: {
  player: TablePlayer
  zone: 'graveyard' | 'exile'
  width: number
  onOpen: (z: ZoneName) => void
}) {
  const t = useT()
  const { preview } = useTable()
  const count = player.counts[zone]
  const top = player[zone]?.at(-1)
  const Icon = zone === 'graveyard' ? Tombstone : Ban
  const label = t('View {zone} of {name}', { zone: zoneLabel(t, zone), name: player.name })
  return (
    <button
      type="button"
      disabled={!count}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(zone)
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={(e) => top && preview(top, e.clientX)}
      onMouseLeave={() => preview(null)}
      title={label}
      aria-label={label}
      style={{ width, height: width * CARD_RATIO }}
      className="group relative shrink-0 rounded-[6%] border border-dashed border-parchment/20 bg-ink/40 transition enabled:hover:border-gold/70"
    >
      {top ? (
        <img
          src={top.image}
          alt={top.name}
          draggable={false}
          className={`h-full w-full rounded-[6%] object-cover shadow-md shadow-black/60 ${zone === 'exile' ? 'opacity-80 saturate-50' : ''}`}
        />
      ) : (
        <Icon className="absolute inset-0 m-auto h-1/3 w-1/3 text-parchment/25" aria-hidden />
      )}
      <span className="absolute -bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-ink px-1.5 py-px text-[0.65rem] font-bold whitespace-nowrap text-parchment/90 ring-1 ring-line group-enabled:group-hover:text-gold">
        <Icon className="h-3 w-3" aria-hidden />
        {count}
      </span>
    </button>
  )
}

/** Uma zona (grimório, comando, pilha virada, exílio, cemitério): carta do topo e quantidade. */
function ZoneTile({
  player,
  zone,
  mine,
  onOpen,
  onLibrary,
}: {
  player: TablePlayer
  zone: ZoneName
  mine: boolean
  onOpen: (z: ZoneName) => void
  /** Clique no seu grimório: abre o menu do deck */
  onLibrary: (x: number, y: number) => void
}) {
  const t = useT()
  const { send } = useTable()
  const count = player.counts[zone]
  const list = zone === 'library' ? null : (player[zone as 'graveyard'] as TableCard[] | null)
  // Grimório com o topo revelado: todos veem a carta de cima
  const top = zone === 'library' ? player.top : list?.at(-1)
  const hidden = (zone === 'library' && !top) || (zone === 'facedown' && !mine)
  const canOpen = zone !== 'library' && !hidden && count > 0
  const click = (e: MouseEvent) => {
    if (zone === 'library' && mine) {
      const r = e.currentTarget.getBoundingClientRect()
      onLibrary(r.left, r.top)
    } else if (canOpen) onOpen(zone)
  }
  return (
    <DropZone
      enabled={mine && !!player.deck}
      onCard={(card) => send({ type: 'move', card: card.id, to: zone, position: 'top' })}
      className="flex w-[4.25rem] flex-col items-center gap-1 rounded-md p-0.5"
    >
      <button
        onClick={click}
        onContextMenu={(e) => {
          if (zone !== 'library' || !mine) return
          e.preventDefault()
          click(e)
        }}
        disabled={!(zone === 'library' && mine) && !canOpen}
        title={zone === 'library' && mine ? t('Library options') : zoneLabel(t, zone)}
        aria-label={zone === 'library' && mine ? t('Library options') : zoneLabel(t, zone)}
        className="relative grid h-[5.6rem] w-16 place-items-center rounded-[6%] border border-dashed border-parchment/15 enabled:hover:border-gold/60"
      >
        {count > 0 &&
          (hidden || !top ? (
            <CardBack width={62} />
          ) : (
            <img src={top.image} alt={top.name} className="h-full w-full rounded-[6%] object-cover" />
          ))}
        {count > 0 && (
          <span className="absolute -right-1.5 -bottom-1.5 rounded-full bg-ink px-1.5 text-[0.7rem] font-bold ring-1 ring-line">
            {count}
          </span>
        )}
      </button>
      <span className="max-w-full truncate text-[0.62rem] tracking-wide text-parchment/50 uppercase">
        {zone === 'command' ? t('Command') : zone === 'facedown' ? t('Facedown') : zoneLabel(t, zone)}
      </span>
    </DropZone>
  )
}

/** Faixa de baixo: zonas do jogador selecionado, sua mão e as ações. */
function HandBar({
  seat,
  player,
  me,
  onShowMine,
  onOpenZone,
  onPickDeck,
  onPeek,
  onTokens,
  onEndGame,
  onHistory,
}: {
  seat: number
  player: TablePlayer | null
  me: TablePlayer | null
  onShowMine: () => void
  onOpenZone: (z: ZoneName) => void
  onPickDeck: () => void
  onPeek: (n: number | null) => void
  onTokens: () => void
  onEndGame: () => void
  onHistory: () => void
}) {
  const t = useT()
  const { send } = useTable()
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [topN, setTopN] = useState(3)
  // Menu do grimório (clique no seu deck)
  const [libMenu, setLibMenu] = useState<{ x: number; y: number } | null>(null)
  const closeLib = useCallback(() => setLibMenu(null), [])
  const mine = !!player && player.id === me?.id
  const hand = me?.hand ?? []
  const hasDeck = !!me?.deck
  // Muitas cartas na mão: elas se sobrepõem para caber
  const handW = Math.round(HAND_CARD * useTableSettings().handScale)
  const overlap = hand.length > 8 ? -Math.min(handW * 0.55, (hand.length - 8) * 6 + 16) : 4
  const btn =
    'rounded-md border border-line px-2.5 py-1 text-xs transition enabled:hover:border-parchment/40 enabled:hover:bg-parchment/10 disabled:opacity-40'

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
        <div className="flex gap-1">
          {player ? (
            (['library', 'facedown', 'exile', 'graveyard'] as const).map((z) => (
              <ZoneTile
                key={z}
                player={player}
                zone={z}
                mine={mine}
                onOpen={onOpenZone}
                onLibrary={(x, y) => setLibMenu({ x, y })}
              />
            ))
          ) : (
            <p className="text-xs text-parchment/40">{t('Open seat')}</p>
          )}
        </div>
      </div>

      {libMenu && me && (
        <LibraryMenu
          x={libMenu.x}
          y={libMenu.y}
          player={me}
          onClose={closeLib}
          onPeek={onPeek}
          onPickDeck={onPickDeck}
        />
      )}
      <DropZone
        enabled={hasDeck}
        onCard={(card) => send({ type: 'move', card: card.id, to: 'hand' })}
        style={{ minHeight: handW * CARD_RATIO + 10 }}
        className="flex min-w-48 flex-1 items-center overflow-x-auto rounded-md border border-dashed border-parchment/10 px-2"
        aria-label={t('Your hand')}
      >
        {hand.length === 0 ? (
          <span className="w-full text-center text-xs text-parchment/30">
            {hasDeck ? t('Your hand is empty.') : t('Your hand')}
          </span>
        ) : (
          hand.map((c, i) => (
            <div
              key={c.id}
              style={{ marginLeft: i ? overlap : 0 }}
              className="relative transition-transform hover:z-10 hover:-translate-y-2"
            >
              <CardView card={c} zone="hand" mine width={handW} menuOnClick />
            </div>
          ))
        )}
      </DropZone>

      <div className="flex max-w-[17rem] flex-wrap content-center items-center gap-1">
        {/* Começo da partida: só aparece até você passar o primeiro turno */}
        {hasDeck && me?.opening && (hand.length === 0 ? !!me.counts.library : true) && (
          <button
            className="rounded-md border border-gold/60 bg-gold/15 px-2.5 py-1 text-xs font-semibold text-gold transition hover:bg-gold/25"
            onClick={() => send(hand.length === 0 ? { type: 'draw', n: 7 } : { type: 'mulligan' })}
            title={hand.length === 0 ? undefined : t('Hotkey: M')}
          >
            {hand.length === 0 ? t('Draw opening hand') : t('Mulligan')}
          </button>
        )}
        <IconButton
          icon={ArrowUpFromLine}
          label={t('Draw a card')}
          hotkey="C"
          disabled={!hasDeck || !me?.counts.library}
          onClick={() => send({ type: 'draw', n: 1 })}
        />
        <IconButton
          icon={RefreshCw}
          label={t('Untap all')}
          hotkey="X"
          disabled={!hasDeck}
          onClick={() => send({ type: 'untap_all' })}
        />
        <IconButton
          icon={Rows3}
          label={t('Arrange your battlefield in rows')}
          hotkey="A"
          disabled={!hasDeck || !me?.battlefield.length}
          onClick={() => send({ type: 'arrange' })}
        />
        <IconButton
          icon={Shuffle}
          label={t('Shuffle library')}
          hotkey="V"
          disabled={!hasDeck}
          onClick={() => send({ type: 'shuffle' })}
        />
        <IconButton
          icon={Search}
          label={t('Search library')}
          hotkey="F"
          disabled={!hasDeck || !me?.counts.library}
          onClick={() => onPeek(null)}
        />
        <span className="inline-flex h-8 overflow-hidden rounded-md border border-line text-xs">
          <IconButton
            icon={ScanEye}
            label={t('Look at the top {n} cards', { n: topN })}
            hotkey="G"
            disabled={!hasDeck || !me?.counts.library}
            onClick={() => onPeek(topN)}
          />
          <input
            type="number"
            min={1}
            max={10}
            value={topN}
            onChange={(e) => setTopN(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            aria-label={t('How many cards')}
            className="w-9 border-l border-line bg-transparent px-1 text-center"
          />
        </span>
        <IconButton icon={Sparkles} label={t('Create token')} hotkey="W" disabled={!me} onClick={onTokens} />
        {me && <DiceButtons />}
        {hasDeck ? (
          <IconButton icon={Library} label={t('Change deck')} disabled={!me} onClick={onPickDeck} />
        ) : (
          <button className={btn} disabled={!me} onClick={onPickDeck}>
            {t('Choose your deck')}
          </button>
        )}
        <IconButton icon={History} label={t('Game history (go back to a moment)')} disabled={!me} onClick={onHistory} />
        <IconButton
          icon={RotateCcw}
          label={confirmRestart ? t('Click again to restart') : t('Restart game')}
          active={confirmRestart}
          disabled={!hasDeck}
          onClick={() => {
            if (!confirmRestart) {
              setConfirmRestart(true)
              setTimeout(() => setConfirmRestart(false), 3000)
              return
            }
            setConfirmRestart(false)
            send({ type: 'restart' })
          }}
        />
        <IconButton icon={Trophy} label={t('End game')} tone="gold" disabled={!me} onClick={onEndGame} />
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
  others,
}: {
  seat: number
  player: TablePlayer | null
  mine: boolean
  selected: boolean
  onSelect: () => void
  others: TablePlayer[]
}) {
  const t = useT()
  const { send } = useTable()
  const btn =
    'rounded-md border border-line px-2 py-1 text-sm font-semibold transition hover:border-parchment/40 hover:bg-parchment/10 active:scale-95'
  // Veneno e dano de comandante: clique soma 1, botão direito tira 1 (só no seu painel)
  const counterProps = (run: (delta: number) => void) =>
    mine
      ? {
          onClick: () => run(1),
          onContextMenu: (e: MouseEvent) => {
            e.preventDefault()
            run(-1)
          },
        }
      : { disabled: true }
  const chip = `inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[0.7rem] tabular-nums ${mine ? 'hover:border-gold' : ''}`
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
          {player && (
            <p className="truncate text-xs text-parchment/45">
              {!player.online ? t('offline') : (player.deck?.name ?? t('No deck yet'))}
            </p>
          )}
        </div>
        <span
          key={player?.life}
          className="font-display ml-auto animate-[fade-in_0.3s_ease-out] text-4xl tabular-nums"
          aria-label={t('Life')}
        >
          {player ? player.life : '—'}
        </span>
      </div>
      {player && (mine || player.poison > 0 || Object.values(player.cmd_damage).some(Boolean)) && (
        <div
          className="mt-1.5 flex flex-wrap items-center gap-1"
          title={mine ? t('Click to add, right-click to remove') : undefined}
        >
          <button
            className={chip}
            aria-label={t('Poison')}
            {...counterProps((d) => send({ type: 'poison', delta: d }))}
          >
            <span className="text-emerald-400">☠</span> {player.poison}
          </button>
          {others.map((o) => {
            const n = player.cmd_damage[String(o.id)] ?? 0
            if (!mine && !n) return null
            return (
              <button
                key={o.id}
                className={chip}
                aria-label={t('Commander damage from {name}', { name: o.name })}
                title={t('Commander damage from {name}', { name: o.name })}
                {...counterProps((d) => send({ type: 'cmd_damage', from: o.id, delta: d }))}
              >
                <span className={`font-bold ${SEAT_TEXT[o.seat - 1]}`}>⚔ {o.name.slice(0, 1).toUpperCase()}</span> {n}
              </button>
            )
          })}
        </div>
      )}
      {mine && (
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[-5, -1, 1, 5].map((d) => (
            <button key={d} className={btn} onClick={() => send({ type: 'life', delta: d })}>
              {d > 0 ? `+${d}` : `−${-d}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type T = (s: string, v?: Record<string, string | number>) => string

/** Uma linha do log, montada no idioma de quem lê. */
/**
 * Carta ampliada ao passar o mouse. Fica num componente à parte, que escuta só a prévia: passar o
 * mouse pelas cartas não redesenha a mesa inteira (com o campo cheio isso deixava tudo lento).
 * Mostra a versão mais nova da carta (ex.: uma nota escrita com o mouse em cima).
 */
function PreviewHost({ players }: { players: TablePlayer[] | undefined }) {
  const preview = useHoverPreview()
  useEffect(() => () => setHoverPreview(null), []) // saiu da mesa: nada de prévia presa
  const live = preview
    ? ((players ?? []).flatMap((p) => p.battlefield).find((c) => c.id === preview.card.id) ?? preview.card)
    : null
  return <CardPreviewPanel card={live} side={preview?.side ?? 'right'} />
}

/**
 * Histórico da partida: os registros do log, do mais novo para o mais antigo, separados por turno.
 * Os momentos guardados têm "Voltar para cá": a mesa inteira volta a como estava logo depois
 * daquele evento (todos os jogadores conectados aprovam antes).
 */
function HistoryDialog({
  log,
  checkpoints,
  pending,
  onRewind,
  onClose,
}: {
  log: LogItem[]
  checkpoints: number[]
  pending: boolean
  onRewind: (id: number) => void
  onClose: () => void
}) {
  const t = useT()
  const [chosen, setChosen] = useState<number | null>(null)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const points = new Set(checkpoints)
  const items = [...log].reverse().filter((e) => e.kind !== 'chat')
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('Game history')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-xl flex-col rounded-xl border border-line bg-ink shadow-2xl shadow-black"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <History className="h-5 w-5 text-gold" aria-hidden />
          <h2 className="font-display text-2xl">{t('Game history')}</h2>
          <button
            onClick={onClose}
            aria-label={t('Close')}
            className="ml-auto rounded-md p-1 text-parchment/60 hover:text-gold"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="border-b border-line px-5 py-2 text-xs text-parchment/50">
          {t('Click a moment to take the whole table back to right after it. Everyone at the table must agree.')}
        </p>
        {pending && (
          <p className="border-b border-line bg-gold/10 px-5 py-2 text-xs text-gold">
            {t('There is already a request waiting for an answer.')}
          </p>
        )}
        <ol className="min-h-0 flex-1 overflow-y-auto py-2">
          {items.length === 0 && <li className="px-5 py-3 text-sm text-parchment/40">{t('Nothing happened yet.')}</li>}
          {items.map((e, i) => {
            const id = e.id ?? -i
            const can = points.has(id) && !pending
            const turn = e.kind === 'turn'
            return (
              <li key={id}>
                {turn && (
                  <p className="mt-2 border-t border-line px-5 pt-2 text-[0.65rem] font-semibold tracking-wide text-parchment/40 uppercase">
                    {t('Turn {n}', { n: e.n ?? 0 })}
                  </p>
                )}
                <button
                  type="button"
                  disabled={!can}
                  onClick={() => setChosen(chosen === id ? null : id)}
                  className={`flex w-full items-start gap-2 px-5 py-1.5 text-left text-sm transition ${
                    chosen === id
                      ? 'bg-gold/15 text-gold'
                      : can
                        ? 'hover:bg-parchment/5'
                        : 'cursor-default text-parchment/45'
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEAT_DOT[(e.seat || 1) - 1] ?? 'bg-parchment/30'}`}
                  />
                  <span className="flex-1">{logText(t, e)}</span>
                  {can && chosen !== id && (
                    <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-parchment/30" aria-hidden />
                  )}
                </button>
                {chosen === id && (
                  <div className="flex items-center gap-2 bg-gold/10 px-5 pb-2">
                    <span className="flex-1 text-xs text-parchment/70">
                      {t('Everything after this goes away for everyone.')}
                    </span>
                    <button
                      onClick={() => onRewind(id)}
                      className="rounded-md bg-gold px-3 py-1 text-xs font-semibold text-ink hover:brightness-110"
                    >
                      {t('Go back to here')}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

/**
 * Pedido de desfazer aberto: quem pediu espera (e pode desistir); cada jogador conectado aprova ou
 * recusa; os demais só acompanham. Fica no topo da mesa até todos responderem ou expirar.
 */
function UndoBanner({
  request,
  you,
  onVote,
}: {
  request: UndoRequest
  you: number
  onVote: (approve: boolean) => void
}) {
  const t = useT()
  const action = request.kind === 'rewind' ? logText(t, request.entry) : actionText(t, request.entry)
  const mine = request.by === you
  const myVote = request.needed.find((n) => n.id === you)
  const waiting = request.needed.filter((n) => !n.approved).map((n) => n.name)
  return (
    <div
      role="alertdialog"
      aria-label={t('Undo request')}
      className="fixed top-20 left-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-gold/60 bg-ink/95 p-4 shadow-2xl shadow-black"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-gold">
        <Undo2 className="h-4 w-4" aria-hidden />
        {request.kind === 'rewind'
          ? mine
            ? t('You asked to take the table back to')
            : t('{name} wants to take the table back to', { name: request.name })
          : mine
            ? t('You asked to undo')
            : t('{name} wants to undo', { name: request.name })}
      </p>
      <p className="mt-1 text-parchment">{action}</p>
      <p className="mt-2 text-xs text-parchment/60">
        {request.needed.map((n) => (
          <span key={n.id} className={`mr-3 ${n.approved ? 'text-emerald-400' : ''}`}>
            {n.approved ? '✓' : '…'} {n.name}
          </span>
        ))}
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {mine ? (
          <>
            <span className="mr-auto self-center text-xs text-parchment/50">
              {t('Waiting for {names}', { names: waiting.join(', ') })}
            </span>
            <button
              onClick={() => onVote(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-parchment/80 hover:border-parchment/40"
            >
              {t('Cancel')}
            </button>
          </>
        ) : myVote && !myVote.approved ? (
          <>
            <button
              onClick={() => onVote(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-parchment/80 hover:border-red-400/60 hover:text-red-300"
            >
              {t('Decline')}
            </button>
            <button
              onClick={() => onVote(true)}
              className="rounded-md bg-gold px-4 py-1.5 text-sm font-semibold text-ink hover:brightness-110"
            >
              {request.kind === 'rewind' ? t('Allow going back') : t('Allow undo')}
            </button>
          </>
        ) : (
          <span className="text-xs text-parchment/50">{t('Waiting for {names}', { names: waiting.join(', ') })}</span>
        )}
      </div>
    </div>
  )
}

/** A ação como frase sem o nome de quem fez ("moveu Island da mão para o cemitério"), para o desfazer. */
function actionText(t: T, e: LogItem): string {
  if (e.kind === 'action') {
    const silent: Record<string, string> = {
      move: t('moved a card on the battlefield'),
      place_many: t('moved cards on the battlefield'),
      arrange: t('arranged their battlefield'),
      lock: t('locked or unlocked a card'),
      toggle_stats: t('changed a power/toughness counter'),
      reorder_top: t('reordered the top of the library'),
    }
    return silent[e.text ?? ''] ?? t('their last action')
  }
  const full = logText(t, e)
  // Tira "ana " / "ana: " do começo (o nome já está na frase de quem desfez)
  return full.startsWith(`${e.who}: `)
    ? full.slice(e.who.length + 2)
    : full.startsWith(`${e.who} `)
      ? full.slice(e.who.length + 1)
      : full
}

function logText(t: T, e: LogItem): string {
  const who = e.who
  // Ação na carta de outro jogador: "ana virou Sol Ring de beto"
  const named = e.card ?? t('a card')
  const card = e.owner && e.owner !== who ? t('{owner}’s {card}', { owner: e.owner, card: named }) : named
  switch (e.kind) {
    case 'joined':
      return t('{who} sat down', { who })
    case 'deck':
      return t('{who} loaded {deck} ({n} cards)', { who, deck: e.deck ?? '', n: e.n ?? 0 })
    case 'draw':
      return e.n === 1 ? t('{who} drew a card', { who }) : t('{who} drew {n} cards', { who, n: e.n ?? 0 })
    case 'move':
      if (e.to === 'library')
        return e.position === 'bottom'
          ? t('{who} put {card} on the bottom of the library', { who, card })
          : t('{who} put {card} on top of the library', { who, card })
      return t('{who} moved {card} from {from} to {to}', {
        who,
        card,
        from: zoneLabel(t, String(e.frm)),
        to: zoneLabel(t, String(e.to)),
      })
    case 'tap':
      return t('{who} tapped {card}', { who, card })
    case 'untap':
      return t('{who} untapped {card}', { who, card })
    case 'untap_all':
      return t('{who} untapped everything', { who })
    case 'arrange':
      return t('{who} arranged their battlefield in rows', { who })
    case 'shuffle':
      return t('{who} shuffled the library', { who })
    case 'mulligan':
      return t('{who} took a mulligan', { who })
    case 'restart':
      return t('{who} restarted the game', { who })
    case 'life':
      return t('{who}: life {from} → {to}', { who, from: e.frm ?? '', to: e.to ?? '' })
    case 'counter':
      return t('{who}: {card} now has {n} {counter} counter(s)', { who, card, n: e.n ?? 0, counter: e.counter ?? '' })
    case 'tax':
      return t('{who}: commander tax for {card} is now +{n}', { who, card, n: e.n ?? 0 })
    case 'cmd_damage':
      return t('{who} has taken {n} commander damage from {source}', { who, n: e.n ?? 0, source: e.source ?? '' })
    case 'poison':
      return t('{who} has {n} poison counter(s)', { who, n: e.n ?? 0 })
    case 'search':
      return t('{who} is searching their library', { who })
    case 'look':
      return t('{who} looked at the top {n} card(s) of their library', { who, n: e.n ?? 0 })
    case 'reveal':
      if (e.cards && e.cards.length > 1)
        return t('{who} revealed the top {n} cards: {cards}', {
          who,
          n: e.cards.length,
          cards: e.cards.map((c) => c.name).join(', '),
        })
      return t('{who} revealed {card}', { who, card })
    case 'draw_to': {
      const where = {
        graveyard: t('to the graveyard'),
        exile: t('to exile'),
        facedown: t('to the facedown pile'),
        hand: t('to their hand'),
        battlefield: t('onto the battlefield'),
        battlefield_down: t('onto the battlefield face down'),
      }[String(e.to)]
      const what = e.text ? ` (${e.text})` : ''
      return e.position === 'bottom'
        ? t('{who} put {n} card(s) from the bottom of the library {where}', { who, n: e.n ?? 0, where: where ?? '' }) +
            what
        : t('{who} put {n} card(s) from the top of the library {where}', { who, n: e.n ?? 0, where: where ?? '' }) +
            what
    }
    case 'top_revealed':
      return t('{who} is playing with the top of the library revealed', { who })
    case 'top_hidden':
      return t('{who} stopped revealing the top of the library', { who })
    case 'scoop':
      return t('{who} scooped: all their cards went back to the library', { who })
    case 'shake':
      return t('{who} shook {card}', { who, card })
    case 'invert':
      return t('{who} turned {card} upside down', { who, card })
    case 'uninvert':
      return t('{who} turned {card} right side up', { who, card })
    case 'highlight':
      return t('{who} highlighted {card}', { who, card })
    case 'note':
      return e.text
        ? t('{who} wrote on {card}: “{text}”', { who, card, text: e.text })
        : t('{who} removed the note from {card}', { who, card })
    case 'symbol':
      return t('{who} marked {card}: {symbol}', { who, card, symbol: symbolLabel(t, e.text ?? '') })
    case 'face_down':
      return t('{who} turned {card} face down', { who, card })
    case 'face_up':
      return t('{who} turned {card} face up', { who, card })
    case 'flip':
      return t('{who} turned {card} to its other face', { who, card })
    case 'control':
      return t('{who} gave control of {card} to {to}', { who, card, to: e.to ?? '' })
    case 'attach':
      return t('{who} attached {card} to {to}', { who, card, to: e.to ?? t('a card') })
    case 'detach':
      return t('{who} detached {card}', { who, card })
    case 'tap_many':
      return t('{who} tapped {n} cards', { who, n: e.n ?? 0 })
    case 'untap_many':
      return t('{who} untapped {n} cards', { who, n: e.n ?? 0 })
    case 'move_many':
      return (
        t('{who} moved {n} cards to {to}', {
          who,
          n: e.n ?? 0,
          to:
            e.to === 'library'
              ? e.position === 'bottom'
                ? t('Bottom of library')
                : t('Top of library')
              : zoneLabel(t, String(e.to)),
        }) + (e.text ? ` (${e.text})` : '')
      )
    case 'target': {
      const target =
        e.to_owner && e.to_owner !== who && e.to_ref
          ? t('{owner}’s {card}', { owner: e.to_owner, card: e.to ?? t('a card') })
          : (e.to ?? t('a card'))
      return t('{who}: {card} targets {target}', { who, card, target })
    }
    case 'token':
      return t('{who} created a {card} token', { who, card })
    case 'clone':
      return t('{who} created a token copy of {card}', { who, card })
    case 'token_gone':
      return t('{who}: the {card} token left the battlefield', { who, card })
    case 'turn':
      return e.n === 1 && e.next === who
        ? t('{who} started the game (turn 1)', { who })
        : t('{who} passed the turn to {next} (turn {n})', { who, next: e.next ?? '', n: e.n ?? 0 })
    case 'stat':
      return t('{who}: {card} is now {p}/{t}', { who, card, p: e.p ?? 0, t: e.t ?? 0 })
    case 'game_over':
      return e.winner
        ? t('{who} ended the game: {winner} won!', { who, winner: e.winner })
        : t('{who} ended the game with no winner', { who })
    case 'new_game':
      return t('{who} started a new game', { who })
    case 'roll':
      return e.sides === 2
        ? t('{who} flipped a coin: {result}', { who, result: e.n === 1 ? t('heads') : t('tails') })
        : t('{who} rolled a d{sides}: {n}', { who, sides: e.sides ?? 0, n: e.n ?? 0 })
    case 'undo':
      return t('{who} undid: {action}', { who, action: e.undone ? actionText(t, e.undone) : t('their last action') })
    case 'rewind':
      return t('{who} took the table back to: {action}', {
        who,
        action: e.undone ? logText(t, e.undone) : t('an earlier moment'),
      })
    case 'undo_rejected':
      return t('{who} declined the undo requested by {owner}', { who, owner: e.owner ?? '' })
    case 'undo_failed':
      return t("Couldn't undo {action}: the table changed since then", {
        action: e.undone ? actionText(t, e.undone) : t('the last action'),
      })
    case 'action':
      return actionText(t, e)
    default:
      return who
  }
}

const SEAT_DOT = ['bg-gold', 'bg-sky-400', 'bg-emerald-400', 'bg-violet-400']

function TableLog({ log, onChat }: { log: LogItem[]; onChat: (text: string) => void }) {
  const t = useT()
  const [tab, setTab] = useState<'all' | 'chat' | 'actions'>('all')
  const [text, setText] = useState('')
  const items = [...log]
    .reverse()
    .filter((e) => (tab === 'all' ? true : tab === 'chat' ? e.kind === 'chat' : e.kind !== 'chat'))
  const tabs: [typeof tab, string][] = [
    ['all', t('All')],
    ['chat', t('Chat')],
    ['actions', t('Actions')],
  ]
  return (
    <div className="flex max-h-64 min-h-32 flex-1 flex-col rounded-lg border border-line bg-surface/60 lg:max-h-none lg:min-h-40">
      <div className="flex gap-4 border-b border-line px-3 pt-2 text-xs font-semibold tracking-wide uppercase">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`pb-1.5 ${tab === key ? 'border-b-2 border-gold' : 'text-parchment/45 hover:text-parchment'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs text-parchment/70">
        {items.length === 0 && <li className="text-parchment/35">{t('Nothing happened yet.')}</li>}
        {items.map((e, i) => (
          <li key={e.id ?? log.length - i} className={e.kind === 'chat' ? 'text-parchment' : ''}>
            <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${SEAT_DOT[e.seat - 1]}`} />
            {e.kind === 'chat' ? (
              <>
                <span className="font-semibold">{e.who}:</span> {e.text}
              </>
            ) : (
              logText(t, e)
            )}
          </li>
        ))}
      </ol>
      <form
        className="flex gap-1.5 border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          onChat(text.trim().slice(0, 300))
          setText('')
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder={t('Type a message…')}
          id="table-chat"
          aria-label={t('Chat message')}
          className="min-w-0 flex-1 rounded-md border border-line bg-ink px-2 py-1 text-xs focus:border-gold focus:outline-none"
        />
        <button className="rounded-md bg-gold px-2.5 text-xs font-semibold text-ink">{t('Send')}</button>
      </form>
    </div>
  )
}

/** "Seu turno": desvirar tudo e comprar com um clique (Enter), ou deixar automático. */
function TurnPrompt({
  turn,
  onAction,
  onAuto,
}: {
  turn: number
  onAction: (untap: boolean, draw: boolean) => void
  onAuto: () => void
}) {
  const t = useT()
  useEffect(() => {
    // Um botão em foco (ex.: "Passar o turno") também reagiria ao Enter: tira o foco dele
    const focused = document.activeElement
    if (focused instanceof HTMLButtonElement) focused.blur()
  }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && ['INPUT', 'TEXTAREA'].includes(el.tagName)) return // Enter no chat não compra carta
      if (e.key === 'Enter') {
        e.preventDefault()
        onAction(true, true)
      } else if (e.key === 'Escape') onAction(false, false)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onAction])
  const btn =
    'rounded-md border border-line px-3 py-1.5 text-sm transition hover:border-parchment/40 hover:bg-parchment/10'
  return (
    <div
      role="alertdialog"
      aria-label={t('Your turn')}
      className="fixed top-24 left-1/2 z-40 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 animate-[flip-in_0.3s_ease-out] rounded-xl border border-gold/60 bg-ink/95 p-4 text-center shadow-2xl shadow-black"
    >
      <p className="font-display text-3xl text-gold">{t('Your turn')}</p>
      <p className="text-xs text-parchment/50">{t('Turn {n}', { n: turn })}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <button
          onClick={() => onAction(true, true)}
          className="rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-ink transition hover:brightness-110"
        >
          {t('Untap all + draw')} <span className="opacity-60">(Enter)</span>
        </button>
        <button onClick={() => onAction(true, false)} className={btn}>
          {t('Only untap')}
        </button>
        <button onClick={() => onAction(false, false)} className={btn}>
          {t('Not now')}
        </button>
      </div>
      <button
        onClick={() => {
          onAuto()
          onAction(true, true)
        }}
        className="mt-3 text-xs text-parchment/50 underline hover:text-gold"
      >
        {t('Always do it automatically')}
      </button>
    </div>
  )
}
