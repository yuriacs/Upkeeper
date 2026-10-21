import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Droplet,
  Flame,
  Leaf,
  Moon,
  ArrowDownFromLine,
  ArrowUpFromLine,
  Ban,
  ChevronDown,
  ChevronUp,
  Hand,
  RotateCw,
  X,
  Keyboard,
  Library,
  Power,
  History,
  Settings,
  Undo2,
  Eye,
  EyeOff,
  Crown,
  LogOut,
  LayoutPanelLeft,
  RectangleHorizontal,
  Coffee,
  SkipForward,
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
  BookOpen,
  Plus,
  Megaphone,
  ThumbsUp,
  Menu,
  UserPlus,
} from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import DeckPicker from '../components/table/DeckPicker'
import { ToolbarMenu } from '../components/table/ToolbarMenu'
import { InviteFriends } from '../components/table/InviteFriends'
import { ChatText, LogText } from '../components/table/CardLink'
import { useCardLookup } from '../components/table/cardLookup'
import NewTableDialog, { type TableSetup } from '../components/table/NewTableDialog'
import { playstyleLabel } from '../lib/playstyles'
import { hasRules, ruleChips } from '../lib/tableRules'
import {
  DiceMenu,
  EndGameDialog,
  GameOverOverlay,
  ConfirmActionDialog,
  HotkeyHelp,
  LeaveDialog,
  LibraryViewer,
  QuantityDialog,
  SearchPickDialog,
  LogSounds,
  RevealOverlay,
  RollOverlay,
  SignalBanner,
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
import { cardImage, smallImage } from '../lib/cardImage'
import { helperByName, helperLabel } from '../components/table/helpers'
import { actLabel, affectsOthers, findTokenImage, type CardAct } from '../components/table/cardActs'
import { tokenImage, useTokenArts } from '../lib/tokenArts'
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
  saveTableSetup,
  useTableSocket,
  type EndRequest,
  MANA_COLORS,
  type ManaColor,
  type UndoRequest,
  type FieldCard,
  type LogItem,
  type TableCard,
  type TablePlayer,
  type TableState,
  type ControlRequest,
  type ZoneName,
} from '../hooks/useTableSocket'
import { useTitle } from '../hooks/useTitle'
import { COLOR_NAMES } from '../lib/colors'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'
import { useI18n, useT } from '../lib/i18n'
import Launcher from '../components/launcher/Launcher'
import { useAuthDialog } from '../components/auth/AuthDialog'
import PlayGuide, { PlayStats, SectionHeading } from '../components/launcher/PlayGuide'
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
/** Zona do comandante: margem interna do quadro e altura da faixa do nome (px) */
const CMD_PAD = 6
const CMD_LABEL = 14
/** Espaço embaixo da carta no quadro para a força/resistência, que fica logo abaixo da carta */
const CMD_STAT = 10
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
    navigate(`/mesa/${fresh}`)
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
        {(opts?.style || opts?.friends_only || table.max_seats === 2 || !watchable || opts?.rules) && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {opts?.style && <span className={`${chip} border-gold/40 text-gold`}>{playstyleLabel(t, opts.style)}</span>}
            {opts?.friends_only && <span className={`${chip} border-emerald-400/40 text-emerald-300`}>{t('Friends only')}</span>}
            {table.max_seats === 2 && <span className={`${chip} border-line text-parchment/60`}>{t('1 vs 1')}</span>}
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
            to={`/mesa/${table.code}`}
            className="inline-block rounded-md btn-ember px-5 py-2 text-center font-semibold text-ink transition hover:brightness-110"
          >
            {t('Rejoin')}
          </Link>
        ) : free ? (
          <Link
            to={`/mesa/${table.code}`}
            className="inline-block rounded-md btn-ember px-5 py-2 text-center font-semibold text-ink transition hover:brightness-110"
          >
            {t('Join')}
          </Link>
        ) : watchable ? (
          <Link
            to={`/mesa/${table.code}?assistir=1`}
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
  spectating: 'You are watching this table.',
  not_controller: 'Only the player who controls this card can do that. Ask for control in the card menu.',
  control_pending: 'Someone already asked for control of this card.',
  already_yours: 'You already control this card.',
  no_control_request: 'That control request is no longer open.',
  nothing_to_undo: 'Nothing of yours to undo.',
  undo_conflict: 'Can’t undo: someone changed those cards after your action.',
  undo_pending: 'There is already an undo request waiting for an answer.',
  // Regras da mesa (bracket, tutores, valor): o deck não serve
  rule_bracket: 'This deck’s bracket is above what this table allows.',
  rule_bracket_unknown: 'This table limits the bracket, and this deck’s bracket is not known yet. Try again in a moment.',
  rule_tutors: 'This deck has more tutors than this table allows.',
  rule_price: 'This deck is worth more than this table allows.',
  // Fim de partida com confirmação
  end_needs_player: 'Another player needs to be at the table to confirm the result.',
  end_pending: 'There is already a request to end the game waiting for an answer.',
  no_end_request: 'That request to end the game is no longer open.',
  // Atalhos de carta
  not_on_battlefield: 'Put this card on the battlefield to use its shortcut.',
  not_in_hand: 'Use this spell’s shortcut from your hand, graveyard, exile or the battlefield.',
  bad_amount: 'Choose how many first.',
  bad_pick: 'Those cards don’t fit this search. Try again.',
  bad_token: 'Couldn’t find the token’s image. Create it from the Tokens window.',
  too_many_tokens: 'Too many tokens on the table.',
  bad_action: 'This card no longer has that shortcut. Reload the deck to update it.',
  card_missing: 'That card is no longer there.',
}

function TableRoom({ code }: { code: string }) {
  const { t, locale } = useI18n()
  // A mesa usa o laranja de antes no lugar do dourado do site (index.css: html.table-orange)
  useEffect(() => {
    document.documentElement.classList.add('table-orange')
    return () => document.documentElement.classList.remove('table-orange')
  }, [])
  // Veio da lista de mesas abertas pelo "Assistir" (mesa cheia): já entra assistindo
  const [params, setParams] = useSearchParams()
  const [watchFirst] = useState(() => params.has('assistir'))
  // Tira o "?assistir" do endereço: recarregar a página depois de sentar não volta a assistir
  useEffect(() => {
    if (params.has('assistir')) setParams({}, { replace: true })
  }, [params, setParams])
  const {
    table,
    status,
    error,
    send,
    outdated,
    peek,
    closePeek,
    actionPick,
    closeActionPick,
    logStart,
    turnStart,
    closesAt,
    closed,
    spectating,
    canWatch,
    watch,
    play,
  } = useTableSocket(code, watchFirst)
  const navigate = useNavigate()
  // Abandonou a mesa: o servidor confirmou e fechou a conexão
  useEffect(() => {
    if (status === 'left') navigate('/')
  }, [status, navigate])
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(leaveTimer.current), [])
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
  const [tokens, setTokens] = useState<'tokens' | 'helpers' | null>(null)
  const [help, setHelp] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // Assistindo: o jogador que você está seguindo (o campo dele fica grande, embaixo)
  const [follow, setFollow] = useState<number | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [ending, setEnding] = useState(false)
  // Tela de fim de partida fechada por você (vale só para aquele resultado)
  const [resultSeen, setResultSeen] = useState('')
  const [muted, setMutedState] = useState(isMuted)
  const hovered = useRef<HoverTarget | null>(null)
  // Alvo dos atalhos numa janela de cartas: estável, para a janela só limpar ao fechar
  const hoverKeys = useCallback((hover: HoverTarget | null) => {
    hovered.current = hover
  }, [])
  // Carta revelada e dado/moeda: mostram a última novidade que chegou depois de abrir a mesa
  const [revealSeen, setRevealSeen] = useState(0)
  // Cartas sacudidas há pouco (id da carta → registro do log); somem 1,3 s depois da última
  const [shakeSeen, setShakeSeen] = useState(0)
  const [rollSeen, setRollSeen] = useState(0)
  const [signalSeen, setSignalSeen] = useState(0)
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
  const lastSignal = log.findLast((e) => e.kind === 'signal')
  const showSignal =
    lastSignal && (lastSignal.id ?? 0) > Math.max(logStart ?? Infinity, signalSeen) ? lastSignal : null
  const doneSignal = useCallback(() => setSignalSeen(lastSignal?.id ?? 0), [lastSignal?.id])

  const me = table?.players.find((p) => p.id === table.you) ?? null
  // Só assiste quem não tem lugar: quem já está sentado entra como jogador mesmo vindo do "Assistir"
  const watching = spectating && !me
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
    openTokens: () => setTokens('tokens'),
    openHelp: () => setHelp(true),
    peek: (n) => send({ type: 'peek', n }),
    startPick,
  })

  // Atalhos de carta: quantidade (X) e confirmação antes; a ficha procura a própria imagem no Scryfall
  const [flow, setFlow] = useState<{ card: TableCard; index: number; act: CardAct; stage: 'qty' | 'confirm' } | null>(
    null,
  )
  const [tokenQuery, setTokenQuery] = useState<string | null>(null)
  const tokenArts = useTokenArts()
  const runAction = useCallback(
    async (card: TableCard, index: number, n?: number) => {
      const act = card.acts?.[index]
      if (!act) return
      if (act.k === 'tokens') {
        if (!act.n && !n) {
          setFlow({ card, index, act, stage: 'qty' })
          return
        }
        const found = await findTokenImage(act)
        // Não achou a ficha: abre a janela de fichas já buscando pelo nome
        if (!found) setTokenQuery(act.name)
        else {
          // Com a arte que o jogador escolheu para essa ficha, se tiver
          const image = tokenImage(tokenArts, found.image, found.oracleId)
          send({ type: 'card_action', card: card.id, index, n: act.n ? undefined : n, image })
        }
        return
      }
      send({ type: 'card_action', card: card.id, index })
    },
    [send, setFlow, setTokenQuery, tokenArts],
  )
  const cardAction = useCallback(
    (card: TableCard, index: number) => {
      const act = card.acts?.[index]
      if (!act) return
      if (affectsOthers(act)) setFlow({ card, index, act, stage: 'confirm' })
      else void runAction(card, index)
    },
    [runAction, setFlow],
  )
  // Busca de um atalho: a carta que pediu (na mão, no cemitério, no exílio ou em qualquer campo:
  // a carta de um oponente que você controla fica no campo dele)
  const pickSource = actionPick
    ? [
        ...(me?.hand ?? []),
        ...(me?.graveyard ?? []),
        ...(me?.exile ?? []),
        ...(table?.players.flatMap((p) => p.battlefield) ?? []),
      ].find((c) => c.id === actionPick.card)
    : undefined

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
      hoverKeys,
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
      cardAction,
    }),
    [send, table?.you, playerList, startPick, pickCard, toggleSelect, cardAction, hoverKeys],
  )

  if (status === 'closed') {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        {closed?.reason === 'finished' ? (
          <>
            <p className="text-5xl" aria-hidden>
              🏆
            </p>
            <p className="font-display mt-2 text-4xl text-gold">
              {closed.by ? t('{name} won!', { name: closed.by }) : t('No winner')}
            </p>
            <p className="mt-3 text-parchment/70">
              {closed.by
                ? t('Game over, confirmed by the table. The win counts in the ranking.')
                : t('Game over, confirmed by the table.')}
            </p>
          </>
        ) : (
          <>
            <p className="font-display text-3xl">{t('Table closed')}</p>
            <p className="mt-3 text-parchment/70">
              {closed?.reason === 'closed' && closed.by
                ? t('{name} closed the table.', { name: closed.by })
                : t('The table was closed after {n} minutes without changes.', {
                    n: Math.round((table?.idle_close ?? 600) / 60),
                  })}
            </p>
          </>
        )}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/"
            className="rounded-md border border-parchment/30 px-4 py-2 font-semibold transition hover:bg-parchment/10"
          >
            {t('Back to tables')}
          </Link>
          <button
            onClick={() => navigate('/?nova=1')}
            className="rounded-md btn-ember px-4 py-2 font-semibold text-ink transition hover:brightness-110"
          >
            {t('Open a new table')}
          </button>
        </div>
      </div>
    )
  }

  if (
    status === 'full' ||
    status === 'unauthorized' ||
    status === 'invalid' ||
    status === 'blocked' ||
    status === 'limit' ||
    status === 'busy' ||
    status === 'no_watch' ||
    status === 'friends_only' ||
    status === 'started'
  ) {
    const message = {
      full: t('This table is full (4 players).'),
      unauthorized: t('Your session expired. Sign in again to join the table.'),
      invalid: t('Invalid table code.'),
      blocked: t('Too many actions or open tabs on this table. Close the other tabs and try again.'),
      limit: t(
        'You already have the maximum number of open tables. Join one of them, or wait for one to close (10 minutes without moves).',
      ),
      busy: t('The server is full right now. Try again in a few minutes.'),
      no_watch: t('This table does not allow spectators.'),
      friends_only: canWatch
        ? t('Only friends of whoever opened this table can sit down. As a friend of a player, you can watch.')
        : t('This table is for friends of whoever opened it.'),
      started: t('The game already started: new players can no longer sit down.'),
    }[status]
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-lg text-parchment/80">{message}</p>
        {(status === 'blocked' || status === 'busy') && (
          <button
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex items-center gap-2 rounded-md btn-ember px-5 py-2.5 font-semibold text-ink transition hover:brightness-110"
          >
            {t('Try again')}
          </button>
        )}
        {(status === 'full' || status === 'started' || status === 'friends_only') && canWatch && (
          <button
            onClick={watch}
            className="mt-6 inline-flex items-center gap-2 rounded-md btn-ember px-5 py-2.5 font-semibold text-ink transition hover:brightness-110"
          >
            <Eye className="h-4 w-4" aria-hidden />
            {t('Watch the game')}
          </button>
        )}
        <div>
          <Link to="/" className="mt-6 inline-block text-gold underline">
            {t('Back to tables')}
          </Link>
        </div>
      </div>
    )
  }

  const maxSeats = table?.max_seats ?? 4
  const bySeat = new Map(table?.players.map((p) => [p.seat, p]))
  // Assistindo: quem você segue (clique num jogador), ou o primeiro sentado
  const followSeat = follow !== null && bySeat.has(follow) ? follow : bySeat.size ? Math.min(...bySeat.keys()) : 1
  // Oponentes na ordem do turno, começando por quem senta depois de você (ou de quem você segue)
  const mySeat = me?.seat ?? (watching ? followSeat : 1)
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
    if (watching) {
      // Assistindo: passa a seguir esse jogador (o campo dele vai para baixo, com as zonas)
      if (bySeat.has(seat)) setFollow(seat)
      setZonesSeat(null)
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
      facing={seat === mySeat}
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
      <div className="flex flex-col lg:h-dvh lg:min-h-[40rem] lg:flex-row">
        {/* Barra lateral da mesa (em telas pequenas, uma faixa em cima): sair, convite e opções */}
        <nav
          aria-label={t('Table menu')}
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-ink px-2 py-1.5 lg:w-12 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:px-0 lg:py-2"
        >
          <IconButton
            icon={LogOut}
            label={me ? t('Leave the table') : t('Stop watching')}
            tipSide="right"
            onClick={() => (me ? setLeaving(true) : navigate('/'))}
          />
          <IconButton
            icon={Share2}
            label={copied ? t('Link copied') : t('Copy invite link')}
            active={copied}
            tipSide="right"
            onClick={copy}
          />
          {me && (
            <IconButton icon={UserPlus} label={t('Invite friends')} tipSide="right" onClick={() => setInviting(true)} />
          )}
          <span className="mx-1 h-6 w-px bg-line lg:mx-0 lg:my-1 lg:h-px lg:w-6" aria-hidden />
          <IconButton
            icon={Undo2}
            label={
              table?.undo.last ? t('Undo: {action}', { action: actionText(t, table.undo.last) }) : t('Nothing to undo')
            }
            hotkey="Ctrl+Z"
            tipSide="right"
            disabled={!me || !table?.undo.count || !!table?.undo.request}
            onClick={() => send({ type: 'undo' })}
          />
          <IconButton
            icon={view === 'split' ? RectangleHorizontal : LayoutPanelLeft}
            label={
              view === 'split' ? t('Show all opponents the same size') : t('Focus one opponent (the others smaller)')
            }
            tipSide="right"
            onClick={() => setView(view === 'split' ? 'full' : 'split')}
          />
          <IconButton
            icon={Settings}
            label={t('Table settings')}
            tipSide="right"
            onClick={() => setShowSettings(true)}
          />
          <IconButton icon={Keyboard} label={t('Hotkeys')} hotkey="?" tipSide="right" onClick={() => setHelp(true)} />
          <IconButton
            icon={muted ? VolumeX : Volume2}
            label={muted ? t('Sound off') : t('Sound on')}
            tipSide="right"
            onClick={() => {
              setMuted(!muted)
              setMutedState(!muted)
            }}
          />
          <span className="ml-auto lg:mt-auto lg:ml-0" />
          <IconButton
            icon={Power}
            tone="danger"
            active={confirmClose}
            label={confirmClose ? t('Click again to close for everyone') : t('Close table')}
            tipSide="right"
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
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                <div className="grid min-h-[13rem] grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] border-b border-line lg:min-h-0 lg:flex-1">
                  <div className="flex min-h-0 flex-col border-r border-line">{rest.map((s) => board(s, 'small'))}</div>
                  {board(focus, 'large')}
                </div>
              ) : (
                <div
                  className={`grid min-h-[13rem] border-b border-line lg:min-h-0 lg:flex-1 [&>*+*]:border-l [&>*+*]:border-line ${
                    ['grid-cols-1', 'grid-cols-2', 'grid-cols-3'][others.length - 1]
                  }`}
                >
                  {others.map((s) => board(s, others.length === 1 ? 'large' : 'small'))}
                </div>
              )}

              {/* Seu campo (ou o de quem você segue, assistindo): a mesma altura dos oponentes, para o
                  campo deles não ficar espremido (as cartas se amontoavam) */}
              <div className="flex min-h-[18rem] lg:min-h-0 lg:flex-1">{board(mySeat, 'large')}</div>

              <HandBar
                seat={zones}
                player={bySeat.get(zones) ?? null}
                me={me}
                spectating={watching}
                onShowMine={() => setZonesSeat(null)}
                onOpenZone={(zone) => setViewer({ seat: zones, zone })}
                onPickDeck={() => setPicking(true)}
                onPeek={(n) => send({ type: 'peek', n })}
                onEndGame={() => setEnding(true)}
                onTokens={() => setTokens('tokens')}
                onHelpers={() => setTokens('helpers')}
                onHistory={() => setShowHistory(true)}
              />
            </section>

            {/* Jogadores e log */}
            <aside className="order-first flex min-h-0 flex-col gap-2 border-line p-3 lg:order-none lg:border-l">
              {/* Mesa, conexão e turno */}
              <div className="rounded-lg border border-line bg-surface px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-display truncate text-lg leading-tight" title={table?.options.title || undefined}>
                    {table?.options.title || t('Table {code}', { code })}
                  </span>
                  <span
                    role="status"
                    title={
                      status === 'open'
                        ? t('Connected')
                        : status === 'reconnecting'
                          ? t('Reconnecting…')
                          : t('Connecting…')
                    }
                    className="ml-auto flex items-center gap-1.5 text-[0.7rem] text-parchment/50"
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${status === 'open' ? 'bg-emerald-400' : 'animate-pulse bg-gold'}`}
                    />
                    {status === 'open'
                      ? t('Connected')
                      : status === 'reconnecting'
                        ? t('Reconnecting…')
                        : t('Connecting…')}
                  </span>
                </div>
                {table && (table.options.style || table.options.friends_only || table.options.title || hasRules(table.options.rules)) && (
                  <p className="mt-1 truncate text-[0.7rem] text-parchment/50">
                    {[
                      table.options.title ? t('Table {code}', { code }) : '',
                      table.options.style ? playstyleLabel(t, table.options.style) : '',
                      table.options.friends_only ? t('Friends only') : '',
                      table.max_seats === 2 ? t('1 vs 1') : '',
                      ...ruleChips(t, table.options.rules, locale),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                <div className="mt-1.5 flex items-center gap-2 text-xs">
                  {activePlayer ? (
                    <span className={`min-w-0 truncate ${myTurn ? 'font-semibold text-gold' : 'text-parchment/70'}`}>
                      {t('Turn {n}', { n: turnNumber })} ·{' '}
                      {myTurn ? t('Your turn') : t("{name}'s turn", { name: activePlayer.name })}
                    </span>
                  ) : (
                    <span className="text-parchment/50">{t('No turns yet')}</span>
                  )}
                  <button
                    onClick={() => send({ type: 'pass_turn' })}
                    disabled={!me || (!!activePlayer && !myTurn && activePlayer.online && !activePlayer.afk)}
                    title={t('Hotkey: E')}
                    className="ml-auto shrink-0 rounded-full bg-gold px-2.5 py-0.5 font-semibold text-ink transition hover:brightness-110 disabled:bg-parchment/10 disabled:text-parchment/40"
                  >
                    {activePlayer ? t('Pass turn') : t('Start: I go first')}
                  </button>
                </div>
                {watching && (
                  <div className="mt-2 flex items-center gap-2 rounded-md bg-sky-400/10 px-2 py-1 text-xs text-sky-300">
                    <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {t('You are watching')}
                    {(table?.players.length ?? 0) < maxSeats && !table?.started && (
                      <button onClick={play} className="ml-auto font-semibold underline hover:text-gold">
                        {t('Take the free seat')}
                      </button>
                    )}
                  </div>
                )}
                {!!table?.spectators.length && (
                  <p className="mt-1.5 truncate text-[0.7rem] text-parchment/50" title={table.spectators.join(', ')}>
                    {t('Watching: {names}', { names: table.spectators.join(', ') })}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                {/* Partida começada: só os lugares ocupados (ninguém mais senta) */}
                {Array.from({ length: maxSeats }, (_, i) => i + 1)
                  .filter((seat) => !table?.started || bySeat.has(seat))
                  .map((seat) => {
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
                      active={!!p && table?.turn.player === p.id}
                    />
                  )
                })}
              </div>
              <TableLog
                log={log}
                players={table?.players ?? NO_PLAYERS}
                onChat={(text) => send({ type: 'chat', text })}
              />
            </aside>
          </div>
        </div>
      </div>

      <PreviewHost players={table?.players} />
      {menu && <CardMenu target={liveMenu(menu, table)} onClose={closeMenu} />}
      {peek && (
        <LibraryViewer
          mode={peek.mode}
          cards={peek.mode === 'top' ? peek.cards.filter((c) => peek.ids.includes(c.id)) : peek.cards}
          onClose={closePeek}
        />
      )}
      {tokens && <TokenPicker tab={tokens} onClose={() => setTokens(null)} />}
      {tokenQuery !== null && <TokenPicker query={tokenQuery} onClose={() => setTokenQuery(null)} />}
      {flow?.stage === 'qty' && (
        <QuantityDialog
          title={`${flow.card.name}: ${actLabel(t, flow.act)}`}
          onClose={() => setFlow(null)}
          onConfirm={(n) => {
            setFlow(null)
            void runAction(flow.card, flow.index, n)
          }}
        />
      )}
      {flow?.stage === 'confirm' && (
        <ConfirmActionDialog
          source={flow.card.name}
          label={actLabel(t, flow.act)}
          onClose={() => setFlow(null)}
          onConfirm={() => {
            setFlow(null)
            void runAction(flow.card, flow.index)
          }}
        />
      )}
      {actionPick && pickSource?.acts?.[actionPick.index]?.k === 'search' && (
        <SearchPickDialog
          act={pickSource.acts[actionPick.index] as Extract<CardAct, { k: 'search' }>}
          source={pickSource.name}
          cards={actionPick.cards}
          onClose={closeActionPick}
          onConfirm={(ids) => {
            send({ type: 'card_action', card: actionPick.card, index: actionPick.index, pick: ids })
            closeActionPick()
          }}
        />
      )}
      {showReveal && <RevealOverlay entry={showReveal} onDone={doneReveal} />}
      {showRoll && !showReveal && <RollOverlay entry={showRoll} onDone={doneRoll} />}
      {showSignal && <SignalBanner entry={showSignal} onDone={doneSignal} />}
      {inviting && table && (
        <InviteFriends code={code} seated={table.players.map((p) => p.name)} onClose={() => setInviting(false)} />
      )}
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
      {/* Assistindo: sem o painel; a mão aparece só na faixa de baixo, de quem você está seguindo */}
      {table && me && <RevealedHands players={table.players} you={me.id} />}
      {leaving && (
        <LeaveDialog
          onClose={() => setLeaving(false)}
          onKeepSeat={() => navigate('/')}
          onAbandon={() => {
            send({ type: 'abandon' })
            // Se a confirmação do servidor não chegar, sai assim mesmo
            leaveTimer.current = setTimeout(() => navigate('/'), 4000)
          }}
        />
      )}
      {table && me && table.control.length > 0 && (
        <ControlRequests
          requests={table.control}
          you={me.id}
          onAnswer={(card, accept) => send({ type: 'answer_control', card, accept })}
        />
      )}
      {table?.end_request && (
        <EndBanner
          request={table.end_request}
          you={me?.id ?? 0}
          seated={!!me}
          onVote={(approve) => send({ type: 'end_vote', approve })}
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
          rules={table?.options.rules}
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
  facing,
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
  /**
   * Campo de baixo, do ponto de vista do dono (o seu ou, assistindo, o de quem você segue): os
   * terrenos ficam embaixo. Os outros campos são espelhados (terrenos longe de você)
   */
  facing: boolean
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
  const layer = useRef<HTMLDivElement>(null)
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
  const { boardScale, reduceMotion, showSymbols, showBoardNames, manaCounter } = useTableSettings()
  // Oponente: cemitério (e exílio) em pilhas no canto do campo, com a carta de cima à mostra
  const piles = !facing && !!player?.deck
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
  // Zona do comandante: quadro no canto (em cima à esquerda no seu campo; embaixo nos oponentes,
  // que aparecem espelhados), uma vaga do tamanho da carta por comandante, lado a lado
  const cmdBox = useRef<HTMLDivElement>(null)
  const cmdSlots = Math.max(1, player?.commanders ?? field.filter((c) => c.commander && c.owner === player?.id).length)
  const cmdBoxW = cmdSlots * w + (cmdSlots - 1) * CMD_PAD + CMD_PAD * 2
  const inBox = (e: { clientX: number; clientY: number }) => {
    const r = cmdBox.current?.getBoundingClientRect()
    return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
  }
  const card = (c: FieldCard, host: FieldCard, k: number) => {
    // Presas: atrás da carta, um pouco para a esquerda e para cima (do ponto de vista do dono do
    // campo), sem sair do campo
    const dx = -k * w * 0.28
    const dy = k * h * 0.12 * (facing ? -1 : 1)
    // Comandante na zona dele: na vaga do quadro, não no ponto x/y
    const slot = host.slot ?? null
    const statRoom = c.stats ? (large ? 16 : 13) : 0
    const boxLeft = 4 + CMD_PAD + (slot ?? 0) * (w + CMD_PAD)
    const boxTop = 4 + CMD_LABEL + CMD_PAD
    return (
      <div
        key={c.id}
        // Mouse em cima: a carta vem para a frente das que a cobrem, com uma sombra para se destacar
        className="absolute hover:z-30 hover:drop-shadow-[0_6px_14px_rgba(0,0,0,0.85)] focus-within:z-30"
        // Campo dos oponentes espelhado: os terrenos deles ficam do lado deles, longe de você
        style={
          slot !== null && player?.deck
            ? {
                left: Math.max(0, boxLeft + dx),
                top: facing ? `${boxTop + dy}px` : `calc(100% - ${boxTop + h + CMD_STAT - dy}px)`,
              }
            : {
                left: `clamp(0px, calc((100% - ${w}px) * ${host.x} + ${dx}px), calc(100% - ${w}px))`,
                // Força/resistência fica logo abaixo da carta: na beira de baixo do campo a carta sobe
                // um pouco para ela não ser cortada pela divisória
                top: `clamp(0px, calc((100% - ${h + statRoom}px) * ${facing ? host.y : 1 - host.y} + ${dy}px), calc(100% - ${h + statRoom}px))`,
              }
        }
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
        // Posição relativa à camada das cartas (abaixo da faixa do nome, sem a coluna das pilhas)
        const r = (layer.current ?? e.currentTarget).getBoundingClientRect()
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
        // Solto no quadro da zona do comandante: o comandante vai para a vaga dele
        send({ type: 'move', card: card.id, to: 'battlefield', x, y, ...(inBox(e) ? { slot: true } : {}) })
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
          {/* Topo do grimório virado ("Virar o topo"): todos veem a carta de cima */}
          {player.top_revealed && player.top && <RevealedTop player={player} width={pileW} />}
          <BoardPile player={player} zone="graveyard" width={pileW} onOpen={onOpenZone} />
          {player.counts.exile > 0 && <BoardPile player={player} zone="exile" width={pileW} onOpen={onOpenZone} />}
          {manaCounter && Object.keys(player.mana).length > 0 && (
            <div className="mt-auto">
              <ManaBox player={player} mine={false} compact />
            </div>
          )}
        </div>
      )}
      {manaCounter && !piles && player?.deck && (mine || Object.keys(player.mana).length > 0) && (
        <div className={`pointer-events-none absolute right-2 z-20 ${large ? 'top-12' : 'top-9'}`}>
          <ManaBox player={player} mine={mine} compact={!large} />
        </div>
      )}
      {/* Cartas numa camada que deixa livres a faixa do nome/vida em cima e a coluna das pilhas */}
      <div
        ref={layer}
        className={`absolute bottom-0 left-0 ${large ? 'top-11' : 'top-8'}`}
        style={{ right: piles ? pileW + 16 : 0 }}
      >
        {player?.deck && (
          <div
            ref={cmdBox}
            className={`pointer-events-none absolute left-1 rounded-lg border border-dashed border-gold/30 bg-gold/[0.05] ${facing ? 'top-1' : 'bottom-1'}`}
            style={{ width: cmdBoxW, height: h + CMD_PAD * 2 + CMD_LABEL + CMD_STAT }}
          >
            <span
              className={`absolute inset-x-0 truncate px-1 text-center text-[0.55rem] leading-[14px] font-semibold tracking-wider text-gold/45 uppercase ${facing ? 'top-0' : 'bottom-0'}`}
            >
              {t('Commander')}
            </span>
          </div>
        )}
        {hosts.map((host) => [
          ...(attached.get(host.id) ?? []).map((c, i, list) => card(c, host, list.length - i)),
          card(host, host, 0),
        ])}
      </div>
      {mine && player && !player.deck && (
        <div className="absolute inset-0 grid place-items-center">
          <button
            onClick={onPickDeck}
            className="font-display rounded-md btn-ember px-6 py-3 text-xl text-ink transition hover:brightness-110"
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
/** Grimório de um oponente com o topo virado para cima: a carta de cima e quantas restam. */
function RevealedTop({ player, width }: { player: TablePlayer; width: number }) {
  const t = useT()
  const { preview } = useTable()
  const top = player.top!
  const label = t('Top of {name}’s library (revealed)', { name: player.name })
  return (
    <div
      title={label}
      aria-label={label}
      onMouseEnter={(e) => preview(top, e.clientX)}
      onMouseLeave={() => preview(null)}
      style={{ width, height: width * CARD_RATIO }}
      className="relative shrink-0 rounded-[6%] ring-2 ring-sky-400/70"
    >
      <img
        src={smallImage(top.image)}
        alt={top.name}
        draggable={false}
        className="h-full w-full rounded-[6%] object-cover shadow-md shadow-black/60"
      />
      <span className="absolute -bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-ink px-1.5 py-px text-[0.65rem] font-bold whitespace-nowrap text-sky-300 ring-1 ring-sky-400/50">
        <Eye className="h-3 w-3" aria-hidden />
        {player.counts.library}
      </span>
    </div>
  )
}

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
          src={cardImage(top.image, width)}
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
  compact = false,
}: {
  player: TablePlayer
  zone: ZoneName
  mine: boolean
  onOpen: (z: ZoneName) => void
  /** Clique no seu grimório: abre o menu do deck */
  onLibrary: (x: number, y: number) => void
  /** Só o topo da carta, com o nome da zona por cima (mão compacta) */
  compact?: boolean
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
      className={`flex w-[4.25rem] flex-col items-center rounded-md p-0.5 ${compact ? '' : 'gap-1'}`}
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
        className={`relative grid w-16 place-items-center border border-dashed border-parchment/15 enabled:hover:border-gold/60 ${
          compact ? 'h-12 place-items-start overflow-hidden rounded-md' : 'h-[5.6rem] rounded-[6%]'
        }`}
      >
        {count > 0 &&
          (hidden || !top ? (
            <CardBack width={62} />
          ) : (
            <img
              src={smallImage(top.image)}
              alt={top.name}
              className={`w-full rounded-[6%] object-cover ${compact ? 'object-top' : 'h-full'}`}
            />
          ))}
        {count > 0 && (
          <span
            className={`absolute rounded-full bg-ink px-1.5 text-[0.7rem] font-bold ring-1 ring-line ${
              compact ? 'top-0.5 right-0.5' : '-right-1.5 -bottom-1.5'
            }`}
          >
            {count}
          </span>
        )}
        {compact && (
          <span className="absolute inset-x-0 bottom-0 truncate bg-ink/80 px-0.5 text-center text-[0.55rem] tracking-wide text-parchment/70 uppercase">
            {zone === 'command' ? t('Command') : zone === 'facedown' ? t('Facedown') : zoneLabel(t, zone)}
          </span>
        )}
      </button>
      {!compact && (
        <span className="max-w-full truncate text-[0.62rem] tracking-wide text-parchment/50 uppercase">
          {zone === 'command' ? t('Command') : zone === 'facedown' ? t('Facedown') : zoneLabel(t, zone)}
        </span>
      )}
    </DropZone>
  )
}

/** Muitas cartas na mão: elas se sobrepõem para caber */
const overlapFor = (n: number, width: number) => (n > 8 ? -Math.min(width * 0.55, (n - 8) * 6 + 16) : 4)

/** Faixa de baixo: zonas do jogador selecionado, sua mão e as ações (assistindo: a mão de quem você segue). */
function HandBar({
  seat,
  player,
  me,
  onShowMine,
  onOpenZone,
  onPickDeck,
  onPeek,
  onTokens,
  onHelpers,
  onEndGame,
  onHistory,
  spectating,
}: {
  seat: number
  player: TablePlayer | null
  me: TablePlayer | null
  /** Assistindo: só as zonas (sem mão nem ações) */
  spectating: boolean
  onShowMine: () => void
  onOpenZone: (z: ZoneName) => void
  onPickDeck: () => void
  onPeek: (n: number | null) => void
  onTokens: () => void
  /** Cartas de ajuda: Monarca, Iniciativa, O Anel, energia... */
  onHelpers: () => void
  onEndGame: () => void
  onHistory: () => void
}) {
  const t = useT()
  const { send } = useTable()
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [topN, setTopN] = useState(3)
  // Menu do grimório (clique no seu deck)
  const [libMenu, setLibMenu] = useState<{ x: number; y: number } | null>(null)
  const closeLib = useCallback(() => setLibMenu(null), [])
  const mine = !!player && player.id === me?.id
  const hand = me?.hand ?? []
  const hasDeck = !!me?.deck
  // Muitas cartas na mão: elas se sobrepõem para caber
  const { handScale, compactHand: compact } = useTableSettings()
  const handW = Math.round(HAND_CARD * handScale)
  const overlap = overlapFor(hand.length, handW)
  // Mão compacta (como no untap.in): aparece só o topo das cartas; a carta sob o mouse sobe inteira
  // por cima do campo. O resto fica cortado embaixo (clip-path deixa passar só para cima)
  const cardH = Math.round(handW * CARD_RATIO)
  const peekH = Math.max(48, Math.round(cardH * 0.42))
  const handBox = compact
    ? { style: { height: peekH }, className: 'items-start overflow-visible [clip-path:inset(-100vh_0_0_0)]' }
    : { style: { minHeight: cardH + 10 }, className: 'items-center overflow-x-auto' }
  const lift = compact
    ? { style: { '--lift': `${-(cardH - peekH + 6)}px` } as CSSProperties, className: 'hover:z-40 hover:translate-y-(--lift)' }
    : { style: {}, className: 'hover:z-10 hover:-translate-y-2' }
  const btn =
    'rounded-md border border-line px-2.5 py-1 text-xs transition enabled:hover:border-parchment/40 enabled:hover:bg-parchment/10 disabled:opacity-40'
  // Mostrar a mão: para quem (nomes) e os outros jogadores sentados
  const { players } = useTable()
  const others = players.filter((p) => p.id !== me?.id)
  const shownTo = new Set(me?.hand_shown ?? [])
  const toSpectators = !!me?.hand_spectators
  const shownNames = [
    others.length > 1 && others.every((p) => shownTo.has(p.id))
      ? t('everyone')
      : others
          .filter((p) => shownTo.has(p.id))
          .map((p) => p.name)
          .join(', '),
    toSpectators ? t('spectators') : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const handVisible = shownTo.size > 0 || toSpectators

  return (
    <div className="flex flex-col border-t border-line">
      {/* Ações numa linha só, acima das zonas e da mão (como no untap.in): a mão ganha a largura toda */}
      {!spectating && (
        <div className="flex flex-wrap items-center gap-1 border-b border-line/60 px-3 py-1">
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
          {/* Grimório: embaralhar, procurar, olhar o topo */}
          <ToolbarMenu
            icon={BookOpen}
            label={t('Library')}
            disabled={!hasDeck}
            rows={[
              { icon: Shuffle, label: t('Shuffle library'), hotkey: 'V', onClick: () => send({ type: 'shuffle' }) },
              {
                icon: Search,
                label: t('Search library'),
                hotkey: 'F',
                disabled: !me?.counts.library,
                onClick: () => onPeek(null),
              },
              {
                icon: ScanEye,
                label: t('Look at the top {n} cards', { n: topN }),
                hotkey: 'G',
                disabled: !me?.counts.library,
                onClick: () => onPeek(topN),
              },
            ]}
            extra={() => (
              <label className="flex items-center gap-2 border-t border-line px-3 pt-1.5 pb-1 text-xs text-parchment/60">
                {t('How many cards')}
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={topN}
                  onChange={(e) => setTopN(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                  className="ml-auto w-12 rounded border border-line bg-transparent px-1 py-0.5 text-center"
                />
              </label>
            )}
          />
          {/* Campo: fichas, cartas de ajuda e organizar */}
          <ToolbarMenu
            icon={Plus}
            label={t('Add to the battlefield')}
            disabled={!me}
            rows={[
              { icon: Sparkles, label: t('Create token'), hotkey: 'W', onClick: onTokens },
              { icon: Crown, label: t('Board helpers (Monarch, Initiative, The Ring, energy…)'), onClick: onHelpers },
              {
                icon: Rows3,
                label: t('Arrange your battlefield in rows'),
                hotkey: 'A',
                disabled: !hasDeck || !me?.battlefield.length,
                onClick: () => send({ type: 'arrange' }),
              },
            ]}
          />
          {me && <DiceMenu />}
          <span className="relative">
            <IconButton
              icon={Eye}
              label={t('Show your hand to…')}
              active={handVisible}
              disabled={!hasDeck}
              onClick={() => setShowMenu(!showMenu)}
            />
            {showMenu && (
              <ShowHandMenu
                others={others}
                shownTo={shownTo}
                toSpectators={toSpectators}
                onToggle={(to, show) => send({ type: 'show_hand', to, show })}
                onClose={() => setShowMenu(false)}
              />
            )}
          </span>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          {/* Avisos rápidos para a mesa (como no untap.in) */}
          <IconButton
            icon={Megaphone}
            label={t('Alert: wait, I have a response')}
            tone="danger"
            disabled={!me}
            onClick={() => send({ type: 'signal', what: 'alert' })}
          />
          <IconButton
            icon={ThumbsUp}
            label={t('No response: go ahead')}
            disabled={!me}
            onClick={() => send({ type: 'signal', what: 'ok' })}
          />
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          {!hasDeck && (
            <button className={btn} disabled={!me} onClick={onPickDeck}>
              {t('Choose your deck')}
            </button>
          )}
          {/* Partida: deck, histórico, recomeçar e encerrar */}
          <ToolbarMenu
            icon={Menu}
            label={t('Game')}
            disabled={!me}
            active={confirmRestart}
            rows={[
              ...(hasDeck ? [{ icon: Library, label: t('Change deck'), onClick: onPickDeck }] : []),
              { icon: History, label: t('Game history (go back to a moment)'), onClick: onHistory },
              {
                icon: RotateCcw,
                label: confirmRestart ? t('Click again to restart') : t('Restart game'),
                disabled: !hasDeck,
                tone: 'danger' as const,
                stay: !confirmRestart,
                onClick: () => {
                  if (!confirmRestart) {
                    setConfirmRestart(true)
                    setTimeout(() => setConfirmRestart(false), 3000)
                    return
                  }
                  setConfirmRestart(false)
                  send({ type: 'restart' })
                },
              },
              { icon: Trophy, label: t('End game'), onClick: onEndGame },
            ]}
          />
        </div>
      )}
      <div className="flex items-stretch gap-3 px-3 py-2">
        <div className="flex flex-col">
          <p className="mb-1 flex items-center gap-2 text-[0.7rem] font-semibold tracking-wide uppercase">
            <span className={SEAT_TEXT[seat - 1]}>{t('Zones · {name}', { name: player?.name ?? '—' })}</span>
            {!mine && me && (
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
                  compact={compact}
                />
              ))
            ) : (
              <p className="text-xs text-parchment/40">{t('Open seat')}</p>
            )}
          </div>
        </div>

        {/* Seta entre as zonas e a mão: mão e zonas inteiras, ou compactas (só o topo das cartas) */}
        <button
          type="button"
          onClick={() => updateTableSettings({ compactHand: !compact })}
          title={compact ? t('Show the whole hand') : t('Compact hand (more room for the battlefield)')}
          aria-label={compact ? t('Show the whole hand') : t('Compact hand (more room for the battlefield)')}
          aria-pressed={!compact}
          className="flex w-6 shrink-0 items-center justify-center self-stretch rounded-md border border-line text-parchment/60 transition hover:border-gold/60 hover:text-gold"
        >
          {compact ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>

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
        {/* Assistindo: a mão de quem você segue, se ele estiver mostrando para quem assiste */}
        {spectating && player && (
          <div
            style={handBox.style}
            className={`relative flex min-w-48 flex-1 rounded-md border border-dashed border-parchment/10 px-2 ${handBox.className}`}
            aria-label={t('{name}’s hand', { name: player.name })}
          >
            {player.hand ? (
              player.hand.length === 0 ? (
                <span className="w-full text-center text-xs text-parchment/30">{t('Empty hand.')}</span>
              ) : (
                player.hand.map((c, i) => (
                  <div
                    key={c.id}
                    style={{ ...lift.style, marginLeft: i ? overlapFor(player.hand!.length, handW) : 0 }}
                    className={`relative transition-transform ${lift.className}`}
                  >
                    <CardView card={c} zone="hand" mine={false} width={handW} />
                  </div>
                ))
              )
            ) : (
              <span className="flex w-full items-center justify-center gap-1.5 text-center text-xs text-parchment/35">
                <EyeOff className="h-3.5 w-3.5" aria-hidden />
                {t('{name} has {n} card(s) in hand (hidden from spectators)', {
                  name: player.name,
                  n: player.counts.hand,
                })}
              </span>
            )}
          </div>
        )}
        {!spectating && (
          <>
            <DropZone
              enabled={hasDeck}
              onCard={(card) => send({ type: 'move', card: card.id, to: 'hand' })}
              style={handBox.style}
              className={`relative flex min-w-48 flex-1 rounded-md border border-dashed px-2 ${handBox.className} ${
                handVisible ? 'border-sky-400/50' : 'border-parchment/10'
              }`}
              aria-label={t('Your hand')}
            >
              {handVisible && (
                <span className="pointer-events-none absolute top-0.5 left-2 z-20 flex items-center gap-1 rounded bg-ink/90 px-1.5 py-px text-[0.65rem] font-semibold text-sky-300 ring-1 ring-sky-400/50">
                  <Eye className="h-3 w-3" aria-hidden />
                  {t('Visible to {names}', { names: shownNames })}
                </span>
              )}
              {hand.length === 0 ? (
                <span className="w-full self-center text-center text-xs text-parchment/30">
                  {hasDeck ? t('Your hand is empty.') : t('Your hand')}
                </span>
              ) : (
                hand.map((c, i) => (
                  <div
                    key={c.id}
                    style={{ ...lift.style, marginLeft: i ? overlap : 0 }}
                    className={`relative transition-transform ${lift.className}`}
                  >
                    <CardView card={c} zone="hand" mine width={handW} menuOnClick />
                  </div>
                ))
              )}
            </DropZone>

          </>
        )}
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
  active,
}: {
  seat: number
  player: TablePlayer | null
  mine: boolean
  selected: boolean
  onSelect: () => void
  others: TablePlayer[]
  /** Está com o turno */
  active: boolean
}) {
  const t = useT()
  const { send } = useTable()
  // Espectador (não está sentado): só olha
  const { you, players: seated } = useTable()
  const sitting = seated.some((p) => p.id === you)
  // Quem sumiu (desconectado ou ausente) e está com o turno: qualquer um passa por ele
  const stuck = !!player && active && !mine && (!player.online || player.afk)
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
              {player.afk ? (
                <span className="font-semibold text-amber-300">{t('away')}</span>
              ) : !player.online ? (
                t('offline')
              ) : (
                (player.deck?.name ?? t('No deck yet'))
              )}
            </p>
          )}
        </div>
        {player && sitting && (
          <div className="flex shrink-0 items-center gap-0.5 self-start">
            {stuck && (
              <IconButton
                size="sm"
                icon={SkipForward}
                label={t('Pass {name}’s turn', { name: player.name })}
                tone="gold"
                onClick={() => send({ type: 'pass_turn' })}
              />
            )}
            <IconButton
              size="sm"
              icon={Coffee}
              active={player.afk}
              label={
                mine
                  ? player.afk
                    ? t('I’m back')
                    : t('I’m away (skip my turns)')
                  : player.afk
                    ? t('Mark {name} as back', { name: player.name })
                    : t('Mark {name} as away (skip their turns)', { name: player.name })
              }
              onClick={() => send({ type: 'set_afk', player: player.id, afk: !player.afk })}
            />
          </div>
        )}
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
      {player && <HelperChips player={player} />}
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

/** Uma bolinha de mana (fonte Mana); "A" (qualquer cor) é um disco com as cinco cores */
function ManaDot({ color, className = '' }: { color: ManaColor; className?: string }) {
  if (color === 'A')
    return (
      <i
        className={`inline-block h-[1.235em] w-[1.235em] shrink-0 rounded-full shadow-[-0.06em_0.07em_0_#111] ${className}`}
        style={{ background: 'conic-gradient(#f8f6d8 0 20%, #c1d7e9 0 40%, #bab1ab 0 60%, #e49977 0 80%, #a3c095 0)' }}
        aria-hidden
      />
    )
  return <i className={`ms ms-${color.toLowerCase()} ms-cost ms-shadow ${className}`} aria-hidden />
}

/**
 * Quadro da mana em aberto, dentro do campo do jogador: uma linha por cor que tem mana. O servidor
 * soma ao virar um terreno (ou outra fonte de mana) e tira ao desvirar; no seu campo, − gasta,
 * + soma e as bolinhas de baixo somam 1 de qualquer cor (feitiços que geram mana). Zera quando o turno passa.
 */
function ManaBox({ player, mine, compact }: { player: TablePlayer; mine: boolean; compact: boolean }) {
  const t = useT()
  const { send } = useTable()
  const colors = MANA_COLORS.filter((c) => (player.mana[c] ?? 0) > 0)
  const total = colors.reduce((n, c) => n + (player.mana[c] ?? 0), 0)
  const name = (c: ManaColor) => t(c === 'A' ? 'Any color' : COLOR_NAMES[c])
  const step =
    'grid h-4 w-4 place-items-center rounded text-[0.7rem] leading-none text-parchment/60 transition hover:bg-parchment/15 hover:text-parchment'
  return (
    <div
      className={`pointer-events-auto rounded-lg border border-parchment/15 bg-ink/85 shadow-lg backdrop-blur-sm ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'}`}
      onMouseDown={(e) => e.stopPropagation()}
      title={mine ? t('Goes up when you tap a land or another mana source') : t('Mana pool')}
    >
      <div className="flex items-center gap-1.5 text-[0.6rem] font-semibold tracking-wider text-parchment/50 uppercase">
        <span>{t('Mana')}</span>
        <span className="ml-auto text-xs text-parchment tabular-nums">{total}</span>
        {mine && total > 0 && (
          <button
            className="rounded px-1 text-[0.6rem] tracking-normal text-parchment/50 normal-case hover:bg-parchment/10 hover:text-parchment"
            title={t('Spend all the mana in the pool')}
            onClick={() => send({ type: 'mana', clear: true })}
          >
            {t('Spend all')}
          </button>
        )}
      </div>
      {colors.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {colors.map((c) => (
            <li key={c} className="flex items-center gap-1.5 text-sm" title={name(c)}>
              <ManaDot color={c} />
              <span key={player.mana[c]} className="min-w-[2ch] animate-[fade-in_0.2s_ease-out] font-bold tabular-nums">
                {player.mana[c]}
              </span>
              {mine && (
                <span className="ml-auto flex gap-0.5">
                  <button
                    className={step}
                    aria-label={t('Spend 1 {color} mana', { color: name(c).toLowerCase() })}
                    title={t('Spend 1 {color} mana', { color: name(c).toLowerCase() })}
                    onClick={() => send({ type: 'mana', color: c, delta: -1 })}
                  >
                    −
                  </button>
                  <button
                    className={step}
                    aria-label={t('Add 1 {color} mana', { color: name(c).toLowerCase() })}
                    title={t('Add 1 {color} mana', { color: name(c).toLowerCase() })}
                    onClick={() => send({ type: 'mana', color: c, delta: 1 })}
                  >
                    +
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {mine && (
        <div className="mt-1 flex items-center gap-0.5 border-t border-parchment/10 pt-1">
          {MANA_COLORS.map((c) => (
            <button
              key={c}
              className="grid place-items-center rounded opacity-50 transition hover:scale-110 hover:opacity-100"
              aria-label={t('Add 1 {color} mana', { color: name(c).toLowerCase() })}
              title={t('Add 1 {color} mana', { color: name(c).toLowerCase() })}
              onClick={() => send({ type: 'mana', color: c, delta: 1 })}
            >
              <ManaDot color={c} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type T = (s: string, v?: Record<string, string | number>) => string

/**
 * O menu aberto mostra a carta como ela está agora (marcadores, virada...), não como estava ao
 * abrir: assim o número muda na hora ao clicar em + / − com o menu aberto.
 */
function liveMenu(menu: MenuTarget, table: TableState | null): MenuTarget {
  if (menu.zone !== 'battlefield' || !table) return menu
  for (const p of table.players) {
    const card = p.battlefield.find((c) => c.id === menu.card.id)
    if (card) return card === menu.card ? menu : { ...menu, card, tapped: card.tapped }
  }
  return menu
}

/** Menu "Mostrar a mão para…": cada jogador liga/desliga; "Todos" e "Esconder de todos". */
function ShowHandMenu({
  others,
  shownTo,
  toSpectators,
  onToggle,
  onClose,
}: {
  others: { id: number; name: string; seat: number }[]
  shownTo: Set<number>
  /** Mostrando para quem está assistindo */
  toSpectators: boolean
  onToggle: (to: number | null | 'spectators', show: boolean) => void
  onClose: () => void
}) {
  const t = useT()
  useEffect(() => {
    const close = () => onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])
  const all = others.every((p) => shownTo.has(p.id))
  const row =
    'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm transition hover:bg-parchment/10 hover:text-gold'
  return (
    <div
      role="menu"
      aria-label={t('Show your hand to…')}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute right-0 bottom-full z-50 mb-2 w-56 rounded-lg border border-line bg-surface p-1 shadow-2xl shadow-black/70"
    >
      <p className="px-2.5 pt-1 pb-1.5 text-[0.7rem] text-parchment/50">
        {t('They see your hand live until you hide it.')}
      </p>
      {others.map((p) => {
        const on = shownTo.has(p.id)
        return (
          <button
            key={p.id}
            role="menuitemcheckbox"
            aria-checked={on}
            onClick={() => onToggle(p.id, !on)}
            className={row}
          >
            {on ? (
              <Eye className="h-4 w-4 text-sky-300" aria-hidden />
            ) : (
              <EyeOff className="h-4 w-4 text-parchment/40" aria-hidden />
            )}
            <span className={`truncate ${SEAT_TEXT[p.seat - 1]}`}>{p.name}</span>
          </button>
        )
      })}
      <button
        role="menuitemcheckbox"
        aria-checked={toSpectators}
        onClick={() => onToggle('spectators', !toSpectators)}
        className={`${row} ${others.length ? 'border-t border-line' : ''}`}
      >
        {toSpectators ? (
          <Eye className="h-4 w-4 text-sky-300" aria-hidden />
        ) : (
          <EyeOff className="h-4 w-4 text-parchment/40" aria-hidden />
        )}
        <span className="truncate">{t('Spectators')}</span>
      </button>
      {others.length > 1 && !all && (
        <button role="menuitem" onClick={() => onToggle(null, true)} className={`${row} border-t border-line`}>
          {t('Show to all players')}
        </button>
      )}
      {(shownTo.size > 0 || toSpectators) && (
        <button
          role="menuitem"
          onClick={() => {
            if (shownTo.size > 0) onToggle(null, false)
            if (toSpectators) onToggle('spectators', false)
          }}
          className={row}
        >
          {t('Hide from everyone')}
        </button>
      )}
    </div>
  )
}

/**
 * Mãos que outros jogadores estão mostrando para você: um painel pequeno no canto (ao vivo).
 * Dá para recolher; volta a abrir sozinho se a pessoa mostrar de novo.
 */
function RevealedHands({ players, you }: { players: TablePlayer[]; you: number }) {
  const t = useT()
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const showing = players.filter((p) => p.id !== you && p.hand !== null)
  // Parou de mostrar: na próxima vez o painel abre de novo
  const ids = showing.map((p) => p.id).join(',')
  const [seen, setSeen] = useState(ids)
  if (seen !== ids) {
    setSeen(ids)
    setCollapsed((prev) => new Set([...prev].filter((id) => showing.some((p) => p.id === id))))
  }
  if (!showing.length) return null
  return (
    <div className="fixed bottom-44 left-16 z-40 flex max-w-[min(40rem,calc(100vw-6rem))] flex-col gap-2">
      {showing.map((p) => {
        const closed = collapsed.has(p.id)
        const toggle = () =>
          setCollapsed((prev) => {
            const next = new Set(prev)
            if (closed) next.delete(p.id)
            else next.add(p.id)
            return next
          })
        return (
          <div
            key={p.id}
            role="region"
            aria-label={t('{name}’s hand', { name: p.name })}
            className="rounded-xl border border-sky-400/50 bg-ink/95 p-2 shadow-2xl shadow-black"
          >
            <button onClick={toggle} className="flex w-full items-center gap-1.5 text-xs font-semibold text-sky-300">
              <Eye className="h-3.5 w-3.5" aria-hidden />
              {t('{name} is showing you their hand ({n})', { name: p.name, n: p.hand!.length })}
              <span className="ml-auto text-parchment/50">{closed ? t('Show') : t('Hide')}</span>
            </button>
            {!closed && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                {p.hand!.length === 0 ? (
                  <span className="text-xs text-parchment/40">{t('Empty hand.')}</span>
                ) : (
                  p.hand!.map((c) => <CardView key={c.id} card={c} zone="hand" mine={false} width={72} />)
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Cartas de ajuda no campo do jogador (Monarca, Iniciativa, energia...), resumidas no painel:
 * ícone e o marcador da carta (ex.: Rad 3). Passar o mouse mostra a carta.
 */
function HelperChips({ player }: { player: TablePlayer }) {
  const t = useT()
  const { preview } = useTable()
  const cards = player.battlefield.filter((c) => c.helper)
  if (!cards.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {cards.map((c) => {
        const h = helperByName(c.name)
        const Icon = h?.icon ?? Sparkles
        const n = h?.counter ? c.counters[h.counter] : Object.values(c.counters)[0]
        const label = h ? helperLabel(t, h.key) : c.name
        return (
          <span
            key={c.id}
            title={label}
            onMouseEnter={(e) => preview(c, e.clientX)}
            onMouseLeave={() => preview(null)}
            className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[0.7rem] text-gold"
          >
            <Icon className="h-3 w-3" aria-hidden />
            <span className="max-w-[7rem] truncate">{label}</span>
            {!!n && <span className="font-bold tabular-nums">{n}</span>}
          </span>
        )
      })}
    </div>
  )
}

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
  const items = [...log].reverse().filter((e) => e.kind !== 'chat' && e.kind !== 'spectator_chat')
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
                      className="rounded-md btn-ember px-3 py-1 text-xs font-semibold text-ink hover:brightness-110"
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
/**
 * Fim de partida esperando confirmação: quem pediu pode desistir; outro jogador sentado confirma
 * (a vitória conta e a mesa fecha) ou recusa. Quem assiste só vê.
 */
function EndBanner({
  request,
  you,
  seated,
  onVote,
}: {
  request: EndRequest
  you: number
  seated: boolean
  onVote: (approve: boolean) => void
}) {
  const t = useT()
  const mine = request.by === you
  const result = request.winner_name ? t('{name} won', { name: request.winner_name }) : t('No winner')
  return (
    <div
      role="alertdialog"
      aria-label={t('End the game')}
      className="fixed top-20 left-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-gold/60 bg-ink/95 p-4 shadow-2xl shadow-black"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-gold">
        <Trophy className="h-4 w-4" aria-hidden />
        {mine ? t('You asked to end the game') : t('{name} wants to end the game', { name: request.name })}
      </p>
      <p className="font-display mt-1 text-2xl text-parchment">{result}</p>
      <p className="mt-1 text-xs text-parchment/60">
        {t('Another player confirms: the result counts and the table closes.')}
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {mine ? (
          <>
            <span className="mr-auto self-center text-xs text-parchment/50">{t('Waiting for another player…')}</span>
            <button
              onClick={() => onVote(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-parchment/80 hover:border-parchment/40"
            >
              {t('Cancel')}
            </button>
          </>
        ) : seated ? (
          <>
            <button
              onClick={() => onVote(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-parchment/80 hover:border-red-400/60 hover:text-red-300"
            >
              {t('Decline')}
            </button>
            <button
              onClick={() => onVote(true)}
              className="rounded-md btn-ember px-4 py-1.5 text-sm font-semibold text-ink hover:brightness-110"
            >
              {t('Confirm and end')}
            </button>
          </>
        ) : (
          <span className="text-xs text-parchment/50">{t('Waiting for a player to confirm…')}</span>
        )}
      </div>
    </div>
  )
}

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
              className="rounded-md btn-ember px-4 py-1.5 text-sm font-semibold text-ink hover:brightness-110"
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

/**
 * Pedidos de controle (canto de baixo, à direita): quem controla a carta aceita ou recusa; quem
 * pediu vê que está esperando. Somem sozinhos quando vencem.
 */
function ControlRequests({
  requests,
  you,
  onAnswer,
}: {
  requests: ControlRequest[]
  you: number
  onAnswer: (card: string, accept: boolean) => void
}) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(id)
  }, [])
  // Margem para a diferença entre o relógio daqui e o do servidor
  const open = requests.filter((r) => r.until + 5 > now)
  if (!open.length) return null
  return (
    <div className="fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {open.map((r) => {
        const asking = r.to === you
        const name = r.name || t('a face-down card')
        return (
          <div
            key={r.card}
            role={asking ? 'alertdialog' : 'status'}
            aria-label={t('Control request')}
            className="flex gap-3 rounded-xl border border-gold/60 bg-ink/95 p-3 shadow-2xl shadow-black"
          >
            {r.image ? (
              <img src={smallImage(r.image)} alt="" className="w-14 shrink-0 self-start rounded-[6%]" />
            ) : (
              <CardBack width={56} />
            )}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-gold">
                <Hand className="h-3.5 w-3.5" aria-hidden />
                {t('Control request')}
                <span className="ml-auto font-normal text-parchment/40 tabular-nums">
                  {Math.max(0, Math.round(r.until - now))}s
                </span>
              </p>
              <p className="mt-1 text-sm text-parchment">
                {asking
                  ? t('{name} asks for control of {card}', { name: r.from_name, card: name })
                  : t('You asked {name} for control of {card}', { name: r.to_name, card: name })}
              </p>
              {asking ? (
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={() => onAnswer(r.card, false)}
                    className="rounded-md border border-line px-3 py-1 text-sm text-parchment/80 hover:border-red-400/60 hover:text-red-300"
                  >
                    {t('Decline')}
                  </button>
                  <button
                    onClick={() => onAnswer(r.card, true)}
                    className="rounded-md btn-ember px-3 py-1 text-sm font-semibold text-ink hover:brightness-110"
                  >
                    {t('Give control')}
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-parchment/50">{t('Waiting for an answer…')}</p>
              )}
            </div>
          </div>
        )
      })}
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

/** Resumo do atalho de carta no log */
function actShort(t: T, act: string, n: number): string {
  return (
    {
      search: t('search the library'),
      tokens: t('{n} token(s)', { n }),
      counters: t('+1/+1 counters on their creatures'),
      draw: t('draw {n}', { n }),
      mill: t('mill {n}', { n }),
      scry: t('scry {n}', { n }),
      surveil: t('surveil {n}', { n }),
      gain: t('gain {n} life', { n }),
      drain: t('each opponent loses {n} life', { n }),
      wipe: t('board wipe'),
    }[act] ?? act
  )
}

function logText(t: T, e: LogItem): string {
  const who = e.who
  // Ação na carta de outro jogador: "ana virou Sol Ring de beto"
  const named = e.card ?? t('a card')
  const card = e.owner && e.owner !== who ? t('{owner}’s {card}', { owner: e.owner, card: named }) : named
  switch (e.kind) {
    case 'joined':
      return t('{who} sat down', { who })
    case 'end_request':
      return e.winner
        ? t('{who} asked to end the game: {winner} won', { who, winner: e.winner })
        : t('{who} asked to end the game with no winner', { who })
    case 'end_cancel':
      return t('{who} gave up ending the game', { who })
    case 'end_rejected':
      return t('{who} did not confirm the end of the game', { who })
    case 'end_confirmed':
      return t('{who} confirmed the end of the game', { who })
    case 'abandoned':
      return t('{who} left the table (the seat is free)', { who })
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
    case 'card_action':
      return t('{who} used {card}: {action}', { who, card, action: actShort(t, e.act ?? '', e.n ?? 0) })
    case 'search_put':
      return e.text
        ? t('{who} found {n} card(s) ({cards}) and shuffled', { who, n: e.n ?? 0, cards: e.text })
        : t('{who} found {n} card(s) and shuffled', { who, n: e.n ?? 0 })
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
    case 'helper': {
      const h = helperByName(e.card ?? '')
      const name = h ? helperLabel(t, h.key) : (e.card ?? '')
      return e.owner
        ? t('{who} took {card} from {owner}', { who, card: name, owner: e.owner })
        : t('{who} put {card} on the battlefield', { who, card: name })
    }
    case 'control_ask':
      return t('{who} asked {to} for control of {card}', { who, card, to: e.to ?? '' })
    case 'control_no':
      return t('{who} kept control of {card} (asked by {to})', { who, card, to: e.to ?? '' })
    case 'show_hand':
      if (e.spectators) return t('{who} is showing their hand to spectators', { who })
      return e.target
        ? t('{who} is showing their hand to {target}', { who, target: e.target })
        : t('{who} is showing their hand to everyone', { who })
    case 'hide_hand':
      if (e.spectators) return t('{who} stopped showing their hand to spectators', { who })
      return e.target
        ? t('{who} stopped showing their hand to {target}', { who, target: e.target })
        : t('{who} stopped showing their hand', { who })
    case 'afk':
      return e.target ? t('{who} marked {target} as away', { who, target: e.target }) : t('{who} is away', { who })
    case 'back':
      return e.target ? t('{who} marked {target} as back', { who, target: e.target }) : t('{who} is back', { who })
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
    case 'signal':
      return e.what === 'alert' ? t('{who}: Alert! I have a response', { who }) : t('{who}: No response', { who })
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

/** Mensagem de chat (de jogador ou de quem assiste) */
const isChat = (e: LogItem) => e.kind === 'chat' || e.kind === 'spectator_chat'

const SEAT_DOT = ['bg-gold', 'bg-sky-400', 'bg-emerald-400', 'bg-violet-400']

const NO_PLAYERS: TablePlayer[] = []

function TableLog({
  log,
  players,
  onChat,
}: {
  log: LogItem[]
  /** Para ligar os nomes de carta à carta na mesa (prévia e destaque) */
  players: TablePlayer[]
  /** Sem: só leitura. Quem assiste também conversa (a mensagem vai marcada como de espectador) */
  onChat?: (text: string) => void
}) {
  const t = useT()
  const lookup = useCardLookup(players)
  const [tab, setTab] = useState<'all' | 'chat' | 'actions'>('all')
  const [text, setText] = useState('')
  // Mensagens novas de outras pessoas desde a última vez que a aba Chat foi aberta (as que já
  // estavam no log ao abrir a mesa não contam)
  const { user } = useAuth()
  const lastChatId = log.findLast(isChat)?.id ?? 0
  const [chatSeen, setChatSeen] = useState<number | null>(null)
  if (chatSeen === null && log.length > 0) setChatSeen(lastChatId)
  if (tab === 'chat' && chatSeen !== null && chatSeen < lastChatId) setChatSeen(lastChatId)
  const unread =
    chatSeen === null ? 0 : log.filter((e) => isChat(e) && (e.id ?? 0) > chatSeen && e.who !== user?.username).length
  const items = [...log]
    .reverse()
    // Conversa de quem assiste só aparece na aba Chat (o "Tudo" fica com o jogo e o chat dos jogadores)
    .filter((e) =>
      tab === 'all' ? e.kind !== 'spectator_chat' : tab === 'chat' ? isChat(e) : !isChat(e),
    )
  const tabs: [typeof tab, string][] = [
    ['all', t('All')],
    ['chat', t('Chat')],
    ['actions', t('Actions')],
  ]
  return (
    <div className="flex max-h-64 min-h-32 flex-1 flex-col rounded-lg border border-line bg-surface/60 lg:max-h-none lg:min-h-40">
      <div className="flex gap-4 border-b border-line px-3 pt-2 text-xs font-semibold tracking-wide uppercase">
        {tabs.map(([key, label]) => {
          const fresh = key === 'chat' && unread > 0
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-label={fresh ? t('{label} ({n} new messages)', { label, n: unread }) : undefined}
              className={`inline-flex items-center gap-1.5 pb-1.5 ${
                tab === key
                  ? 'border-b-2 border-gold'
                  : fresh
                    ? 'animate-pulse text-gold'
                    : 'text-parchment/45 hover:text-parchment'
              }`}
            >
              {label}
              {fresh && (
                <span className="rounded-full bg-gold px-1.5 text-[0.6rem] leading-4 font-bold text-ink tabular-nums">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs text-parchment/70">
        {items.length === 0 && <li className="text-parchment/35">{t('Nothing happened yet.')}</li>}
        {items.map((e, i) => (
          <li key={e.id ?? log.length - i} className={isChat(e) ? 'text-parchment' : ''}>
            <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${SEAT_DOT[e.seat - 1] ?? 'bg-parchment/35'}`} />
            {e.kind === 'spectator_chat' ? (
              <>
                <span className="font-semibold text-parchment/75">{e.who}</span>{' '}
                <span className="mr-0.5 inline-flex items-center gap-0.5 rounded bg-sky-400/15 px-1 align-[1px] text-[0.6rem] font-semibold tracking-wide text-sky-300 uppercase">
                  <Eye className="h-2.5 w-2.5" aria-hidden />
                  {t('spectator')}
                </span>
                : <ChatText text={e.text ?? ''} lookup={lookup} />
              </>
            ) : e.kind === 'chat' ? (
              <>
                <span className="font-semibold">{e.who}:</span> <ChatText text={e.text ?? ''} lookup={lookup} />
              </>
            ) : (
              <LogText text={logText(t, e)} e={e} lookup={lookup} />
            )}
          </li>
        ))}
      </ol>
      {onChat && (
        <form
          className="flex gap-1.5 border-t border-line p-2"
          onSubmit={(e) => {
            e.preventDefault()
            // Enter envia e devolve o teclado para a mesa (os atalhos voltam a funcionar)
            ;(document.activeElement as HTMLElement | null)?.blur()
            if (!text.trim()) return
            onChat(text.trim().slice(0, 300))
            setText('')
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
            maxLength={300}
            placeholder={t('Message… ([[card]] makes a link)')}
            title={t('Card names on the table become links. To link any card, write it as [[Card name]].')}
            id="table-chat"
            aria-label={t('Chat message')}
            className="min-w-0 flex-1 rounded-md border border-line bg-ink px-2 py-1 text-xs focus:border-gold focus:outline-none"
          />
          <button className="rounded-md bg-gold px-2.5 text-xs font-semibold text-ink">{t('Send')}</button>
        </form>
      )}
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
          className="rounded-md btn-ember px-3 py-1.5 text-sm font-semibold text-ink transition hover:brightness-110"
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
