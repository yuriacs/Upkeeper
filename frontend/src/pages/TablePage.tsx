import '../i18n/ptTable' // traduções da mesa (carregam junto com esta página)
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  ArrowDownFromLine,
  ArrowUpFromLine,
  Ban,
  Hand,
  RotateCw,
  X,
  Keyboard,
  Power,
  Settings,
  Undo2,
  Eye,
  LogOut,
  LayoutPanelLeft,
  RectangleHorizontal,
  RotateCcw,
  Share2,
  Trophy,
  Volume2,
  VolumeX,
  UserPlus,
  Swords,
} from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { playstyleLabel } from '../lib/playstyles'
import { hasRules, ruleChips } from '../lib/tableRules'
import {
  GameOverOverlay,
  LogSounds,
  RevealOverlay,
  RollOverlay,
  SignalBanner,
  TargetArrows,
} from '../components/table/TableExtras'
import { useDeckImagePreload } from '../hooks/useDeckImagePreload'
import { useTableHotkeys } from '../hooks/useTableHotkeys'
import { isMuted, setMuted } from '../lib/tableSounds'
import { getTableSettings, updateTableSettings, useTableSettings } from '../lib/tableSettings'
import { setHoverPreview } from '../lib/hoverPreview'
import { Tombstone } from '../lib/icons'
import { actionText } from '../components/table/logText'
import {
  actLabel,
  affectsOthers,
  findTokenImage,
  tokenDraft,
  needsAmount,
  needsTarget,
  type CardAct,
} from '../components/table/cardActs'
import { tokenImage, useTokenArts } from '../lib/tokenArts'
import { findCustomToken } from '../lib/customTokens'
import type { CardSpec } from '../lib/cardRender'
import { useQueryClient } from '@tanstack/react-query'
import { dueTriggers, TriggerPanel, type TriggerWhen } from '../components/table/TriggerReminders'
import { CardMenu, IconButton, ZoneViewer } from '../components/table/TableKit'
import {
  TableCtx,
  type HoverTarget,
  type MenuTarget,
  type PickMode,
  pointer,
} from '../components/table/tableUtils'
import { useTableSocket, type TableCard, type TableState, type ZoneName } from '../hooks/useTableSocket'
import { useTitle } from '../hooks/useTitle'
import { useI18n, useT } from '../lib/i18n'
import { lazyPart } from '../lib/lazyPage'
import { callAttention } from '../lib/attention'
import { readJSON, writeJSON } from '../lib/storage'
import { Board, PreviewHost } from '../components/table/Board'
import { HandBar, RevealedHands } from '../components/table/HandBar'
import { PlayerPanel, TurnClock } from '../components/table/PlayerPanel'
import { CloseBanner, ControlRequests, EndBanner, IdleWarning, StartWait, TurnPrompt, UndoBanner } from '../components/table/TableBanners'
import { TableLog } from '../components/table/TableLog'
import { NO_PLAYERS, VIEW_KEY, VIEW_MODES, type ViewMode } from '../components/table/tableLook'

/*
 * Mesa virtual — Fase 1 do roadmap: cartas de verdade.
 * O servidor guarda a partida e manda a cada jogador a própria visão (mão e grimório dos outros
 * só como quantidade). Arraste as suas cartas entre o campo, a mão e as zonas; botão direito
 * abre o menu da carta; dois cliques viram/desviram no campo.
 */

export default function TablePage() {
  const { code } = useParams()
  return code ? (
    <TableRoom code={code.toUpperCase()} />
  ) : (
    <Suspense fallback={null}>
      <TableLobby />
    </Suspense>
  )
}

// Carregam só quando precisam: a tela das mesas (sem código na URL) e as janelas que abrem pouco
const TableLobby = lazy(() => import('./TableLobby'))
const TableSettingsDialog = lazy(() => import('../components/table/TableSettings'))
const DeckPicker = lazy(() => import('../components/table/DeckPicker'))
const InviteFriends = lazy(() => import('../components/table/InviteFriends').then((m) => ({ default: m.InviteFriends })))
// Janelas que alguém abre (grimório, fichas, ações de carta, atalhos, encerrar, sair, histórico):
// fora do pacote da mesa, baixadas uns segundos depois de ela abrir (ou na hora, se abrirem antes)
const dialogs = () => import('../components/table/TableDialogs')
const LibraryViewer = lazyPart(() => dialogs().then((m) => m.LibraryViewer))
const TokenPicker = lazyPart(() => dialogs().then((m) => m.TokenPicker))
const QuantityDialog = lazyPart(() => dialogs().then((m) => m.QuantityDialog))
const ConfirmActionDialog = lazyPart(() => dialogs().then((m) => m.ConfirmActionDialog))
const SearchPickDialog = lazyPart(() => dialogs().then((m) => m.SearchPickDialog))
const GraveyardPickDialog = lazyPart(() => dialogs().then((m) => m.GraveyardPickDialog))
const HotkeyHelp = lazyPart(() => dialogs().then((m) => m.HotkeyHelp))
const EndGameDialog = lazyPart(() => dialogs().then((m) => m.EndGameDialog))
const LeaveDialog = lazyPart(() => dialogs().then((m) => m.LeaveDialog))
const HistoryDialog = lazyPart(() => import('../components/table/HistoryDialog').then((m) => m.HistoryDialog))

/** Segundos que faltam de um prazo que o servidor mandou em segundos (null: sem prazo) */
function useCountdown(seconds: number | null | undefined) {
  const [end, setEnd] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setEnd(seconds == null ? null : Date.now() + seconds * 1000)
    setNow(Date.now())
  }, [seconds])
  useEffect(() => {
    if (end == null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [end])
  return end == null ? null : Math.max(0, Math.ceil((end - now) / 1000))
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
  // Mesa de torneio
  tournament_winner: 'A tournament match needs a winner.',
  bad_placings: 'Put every player at the table in finishing order.',
  teammate_vote: 'Your partner asked: a player from the other pair confirms.',
  start_wait: 'The match starts when the whole pod is seated, or 5 minutes after the second player sits down.',
  close_pending: 'There is already a request to close the table waiting for an answer.',
  no_close_request: 'That request to close the table is no longer open.',
  // Atalhos de carta
  not_on_battlefield: 'Put this card on the battlefield to use its shortcut.',
  not_in_hand: 'Use this spell’s shortcut from your hand, graveyard, exile or the battlefield.',
  bad_amount: 'Choose how many first.',
  bad_pick: 'Those cards don’t fit this search. Try again.',
  bad_target: 'That can’t be the target of this shortcut.',
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
  useEffect(() => {
    const timer = setTimeout(() => void dialogs(), 4000)
    return () => clearTimeout(timer)
  }, [])
  // Veio da lista de mesas abertas pelo "Assistir" (mesa cheia): já entra assistindo
  const [params, setParams] = useSearchParams()
  const [watchFirst] = useState(() => params.has('watch'))
  // Tira o "?watch" do endereço: recarregar a página depois de sentar não volta a assistir
  useEffect(() => {
    if (params.has('watch')) setParams({}, { replace: true })
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
  const chat = useCallback((text: string) => send({ type: 'chat', text }), [send])
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
    VIEW_MODES.find((m) => m === readJSON<string>(VIEW_KEY, 'split')) ?? 'split',
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
  // Chegou a sua vez com a mesa em outra aba: título piscando, som e notificação (no treino, não)
  const alerted = useRef(0)
  useEffect(() => {
    if (!myTurn || !settings.turnAlert || table?.options.practice || alerted.current >= turnNumber) return
    alerted.current = turnNumber
    callAttention(t('Your turn!'), { title: t('Your turn at table {code}', { code }), tag: `turn-${code}` })
  }, [myTurn, turnNumber, settings.turnAlert, table?.options.practice, code, t])
  // Lembretes de gatilho: quando o turno começa, no botão Combate e antes de passar a vez
  const [reminder, setReminder] = useState<'turn' | 'combat' | 'end' | null>(null)
  const remindersOn = settings.triggerReminders && !!me?.deck
  const reminded = useRef<number | null>(null)
  const turnTriggers: TriggerWhen[] = myTurn ? ['upkeep'] : ['upkeep', 'combat', 'end']
  useEffect(() => {
    if (!table) return
    // Ao abrir (ou recarregar) a mesa no meio de um turno, não lembra de novo
    if (reminded.current === null || reminded.current === turnNumber) {
      reminded.current = turnNumber
      return
    }
    reminded.current = turnNumber
    const due = !!activePlayer && remindersOn && dueTriggers(table.players, table.you, myTurn, turnTriggers).length > 0
    setReminder(due ? 'turn' : null)
    // Só quando o turno muda: o resto é lido na hora em que o painel abre
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnNumber, !!table])
  const reminderItems =
    reminder && table
      ? dueTriggers(table.players, table.you, myTurn, reminder === 'turn' ? turnTriggers : [reminder])
      : []
  const combatTriggers = myTurn && remindersOn && table ? dueTriggers(table.players, table.you, true, ['combat']).length : 0
  // Mesa de liga de torneio: o 1º turno espera o pod completo ou 5 minutos depois do 2º sentar
  const startLeft = useCountdown(table?.start_lock?.left)
  const startLocked = !!table?.start_lock && (table.start_lock.left == null || (startLeft ?? 0) > 0)
  // Passar a vez: com gatilho de etapa final, mostra antes; passar de novo (botão ou E) confirma
  const passTurn = () => {
    if (!activePlayer && startLocked) return
    if (myTurn && remindersOn && reminder !== 'end' && table && dueTriggers(table.players, table.you, true, ['end']).length) {
      setReminder('end')
      return
    }
    setReminder(null)
    send({ type: 'pass_turn' })
  }
  // "Mirar…" e "Prender em…": o próximo clique numa carta do campo (ou num jogador, ao mirar) escolhe.
  // Atalho com alvo ("act"): a carta do campo, ou o jogador que leva o dano
  const [choosing, setChoosing] = useState<{
    mode: PickMode
    card: string
    name: string
    kind?: TableCard['attach']
    act?: { index: number; n?: number; player: boolean; label: string }
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
      if (c.mode === 'act' && c.act) {
        // A própria carta também pode ser o alvo ("desvire a permanente alvo")
        if (zone === 'battlefield' && !c.act.player)
          send({ type: 'card_action', card: c.card, index: c.act.index, n: c.act.n, target: id })
      } else if (zone === 'battlefield' && id !== c.card) {
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
    passTurn,
  })

  // Treino: Tab troca o lugar com que você joga (fora de campos de texto e janelas abertas)
  const practice = !!table?.options.practice && !!me
  useEffect(() => {
    if (!practice) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      send({ type: 'practice_switch' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [practice, send])

  // Atalhos de carta: quantidade (X) e confirmação antes; a ficha procura a própria imagem no Scryfall
  const [flow, setFlow] = useState<{ card: TableCard; index: number; act: CardAct; stage: 'qty' | 'confirm' } | null>(
    null,
  )
  const [tokenQuery, setTokenQuery] = useState<{ query: string; draft: Partial<CardSpec> } | null>(null)
  const tokenArts = useTokenArts()
  const queryClient = useQueryClient()
  const runAction = useCallback(
    async (card: TableCard, index: number, n?: number) => {
      const act = card.acts?.[index]
      if (!act) return
      if (needsAmount(act) && !n) {
        setFlow({ card, index, act, stage: 'qty' })
        return
      }
      if (needsTarget(act)) {
        // O próximo clique escolhe: uma carta do campo, ou um jogador (dano)
        setMenu(null)
        setChoosing({
          mode: 'act',
          card: card.id,
          name: card.name,
          act: { index, n: act.n ? undefined : n, player: act.k === 'damage', label: actLabel(t, act) },
        })
        return
      }
      if (act.k === 'tokens') {
        const found = await findTokenImage(act)
        // Com a arte que o jogador escolheu para essa ficha, se tiver; o Scryfall não tem a ficha
        // (a Jellyfish da Cynette nunca foi impressa): uma ficha personalizada sua com o mesmo nome
        const image = found ? tokenImage(tokenArts, found.image, found.oracleId) : (await findCustomToken(queryClient, act.name))?.url
        if (image) send({ type: 'card_action', card: card.id, index, n: act.n ? undefined : n, image })
        // Não achou nenhuma: abre a janela de fichas já buscando pelo nome (e com o que o atalho
        // sabe dela, se o jogador for montar a sua)
        else setTokenQuery({ query: act.name, draft: tokenDraft(act) })
        return
      }
      send({ type: 'card_action', card: card.id, index })
    },
    [send, setFlow, setTokenQuery, tokenArts, queryClient, setChoosing, t],
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
  const playersKey = (table?.players ?? []).map((p) => `${p.id}\t${p.seat}\t${p.name}\t${p.sleeve ?? ''}\t${p.sleeve_image ?? ''}\t${p.foil ? 1 : ''}`).join('\n')
  const playerList = useMemo(
    () =>
      playersKey
        ? playersKey.split('\n').map((line) => {
            const [id, seat, name, sleeve, sleeve_image, foil] = line.split('\t')
            return { id: Number(id), seat: Number(seat), name, sleeve, sleeve_image, foil: !!foil }
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
      selected: () => [...selectedRef.current],
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
          {table?.options.tournament ? (
            <Link
              to={`/tournaments/${table.options.tournament.id}`}
              className="rounded-md btn-ember px-4 py-2 font-semibold text-ink transition hover:brightness-110"
            >
              {t('Back to the tournament')}
            </Link>
          ) : (
            <button
              onClick={() => navigate('/?nova=1')}
              className="rounded-md btn-ember px-4 py-2 font-semibold text-ink transition hover:brightness-110"
            >
              {t('Open a new table')}
            </button>
          )}
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
    status === 'started' ||
    status === 'not_in_match'
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
      not_in_match: t('This is a tournament match: only its players can sit down. You can watch.'),
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
        {(status === 'full' || status === 'started' || status === 'friends_only' || status === 'not_in_match') && canWatch && (
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
      if (c.mode === 'act' && c.act?.player && target)
        send({ type: 'card_action', card: c.card, index: c.act.index, n: c.act.n, player: target.id })
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
          {/* Visão dos oponentes: destaque → todos iguais → 1 contra 1 → destaque (o botão diz a próxima) */}
          <IconButton
            icon={view === 'split' ? RectangleHorizontal : view === 'full' ? Swords : LayoutPanelLeft}
            label={
              view === 'split'
                ? t('Show all opponents the same size')
                : view === 'full'
                  ? t('Show one opponent at a time, like 1 vs 1 (click a player on the right to switch)')
                  : t('Focus one opponent (the others smaller)')
            }
            tipSide="right"
            onClick={() => setView(VIEW_MODES[(VIEW_MODES.indexOf(view) + 1) % VIEW_MODES.length])}
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
            icon={Trophy}
            label={t('End game')}
            tipSide="right"
            disabled={!me || !!table?.end_request}
            onClick={() => setEnding(true)}
          />
          <IconButton
            icon={Power}
            tone="danger"
            active={confirmClose}
            label={
              confirmClose
                ? t('Click again to close the table (another player confirms)')
                : t('Close table')
            }
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
              {view === 'duel' ? (
                <div className="relative flex min-h-[13rem] border-b border-line lg:min-h-0 lg:flex-1">
                  {board(focus, 'large')}
                </div>
              ) : view === 'split' && rest.length > 0 ? (
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
                {table && (table.options.style || table.options.friends_only || table.options.practice || table.options.title || table.options.tournament || hasRules(table.options.rules)) && (
                  <p className="mt-1 truncate text-[0.7rem] text-parchment/50">
                    {[
                      table.options.title ? t('Table {code}', { code }) : '',
                      table.options.style ? playstyleLabel(t, table.options.style) : '',
                      table.options.friends_only ? t('Friends only') : '',
                      table.options.practice ? t('Practice') : '',
                      table.options.tournament ? t('Tournament · round {n}', { n: table.options.tournament.round }) : '',
                      table.max_seats === 2 && !table.options.practice ? t('1 vs 1') : '',
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
                  {activePlayer && table?.turn.started_at ? <TurnClock since={table.turn.started_at} /> : null}
                  {combatTriggers > 0 && (
                    <button
                      onClick={() => setReminder(reminder === 'combat' ? null : 'combat')}
                      title={t('Beginning of combat triggers')}
                      className="ml-auto shrink-0 rounded-full border border-gold/50 px-2.5 py-0.5 font-semibold text-gold transition hover:bg-gold/10"
                    >
                      {t('Combat ({n})', { n: combatTriggers })}
                    </button>
                  )}
                  <button
                    onClick={passTurn}
                    disabled={
                      !me || (!!activePlayer && !myTurn && activePlayer.online && !activePlayer.afk) || (!activePlayer && startLocked)
                    }
                    title={t('Hotkey: E')}
                    className={`${combatTriggers > 0 ? '' : 'ml-auto'} shrink-0 rounded-full bg-gold px-2.5 py-0.5 font-semibold text-ink transition hover:brightness-110 disabled:bg-parchment/10 disabled:text-parchment/40`}
                  >
                    {activePlayer ? t('Pass turn') : t('Start: I go first')}
                  </button>
                </div>
                {table?.options.practice && me && (
                  <PracticeSwitch
                    players={table.players}
                    you={me.id}
                    onSwitch={() => send({ type: 'practice_switch' })}
                  />
                )}
                {!activePlayer && table?.start_lock && startLocked && (
                  <StartWait lock={table.start_lock} left={startLeft} />
                )}
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
                onChat={chat}
              />
            </aside>
          </div>
        </div>
      </div>

      <PreviewHost players={table?.players} />
      {menu && <CardMenu target={liveMenu(menu, table)} onClose={closeMenu} selection={[...selected]} />}
      {peek && (
        <LibraryViewer
          mode={peek.mode}
          cards={peek.mode === 'top' ? peek.cards.filter((c) => peek.ids.includes(c.id)) : peek.cards}
          onClose={closePeek}
        />
      )}
      {tokens && <TokenPicker tab={tokens} onClose={() => setTokens(null)} />}
      {tokenQuery !== null && (
        <TokenPicker query={tokenQuery.query} draft={tokenQuery.draft} onClose={() => setTokenQuery(null)} />
      )}
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
      {actionPick && pickSource?.acts?.[actionPick.index]?.k === 'regrow' && (
        <GraveyardPickDialog
          act={pickSource.acts[actionPick.index] as Extract<CardAct, { k: 'regrow' }>}
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
        <Suspense fallback={null}>
          <InviteFriends code={code} seated={table.players.map((p) => p.name)} onClose={() => setInviting(false)} />
        </Suspense>
      )}
      {help && <HotkeyHelp onClose={() => setHelp(false)} />}
      {ending && table && (
        <EndGameDialog
          players={table.players.map((p) => ({ id: p.id, name: p.name }))}
          tournament={table.options.tournament ?? null}
          onClose={() => setEnding(false)}
          onConfirm={(winner, placings) => {
            send({ type: 'end_game', winner, ...(placings ? { placings } : {}) })
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
      {reminder && reminderItems.length > 0 && (
        <TriggerPanel
          title={
            reminder === 'end'
              ? t('Before passing: end step triggers')
              : reminder === 'combat'
                ? t('Beginning of combat triggers')
                : myTurn
                  ? t('Upkeep triggers')
                  : t('Your triggers on {name}’s turn', { name: activePlayer?.name ?? '' })
          }
          items={reminderItems}
          onHover={(card) => setHoverPreview(card ? { card, side: 'left' } : null)}
          onClose={() => setReminder(null)}
          footer={
            reminder === 'end' ? (
              <>
                <button
                  onClick={() => setReminder(null)}
                  className="rounded-md border border-line px-3 py-1 text-sm hover:border-parchment/40"
                >
                  {t('Back')}
                </button>
                <button
                  onClick={passTurn}
                  title={t('Hotkey: E')}
                  className="rounded-md btn-ember px-3 py-1 text-sm font-semibold text-ink hover:brightness-110"
                >
                  {t('Pass turn')}
                </button>
              </>
            ) : undefined
          }
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
      {table?.close_request && (
        <CloseBanner
          request={table.close_request}
          you={me?.id ?? 0}
          seated={!!me}
          onVote={(approve) => send({ type: 'close_vote', approve })}
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
        <Suspense fallback={null}>
          <TableSettingsDialog
            sample={me?.battlefield.find((c) => c.commander && c.image) ?? me?.battlefield.find((c) => c.image) ?? null}
            muted={muted}
            onMuted={(m) => {
              setMuted(m)
              setMutedState(m)
            }}
            onClose={() => setShowSettings(false)}
          />
        </Suspense>
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
            {choosing.mode === 'act' && choosing.act
              ? choosing.act.player
                ? t('{card}: choose the player ({action})', { card: choosing.name, action: choosing.act.label })
                : t('{card}: choose the target on the battlefield ({action})', {
                    card: choosing.name,
                    action: choosing.act.label,
                  })
              : choosing.mode === 'target'
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
        <Suspense fallback={null}>
          <DeckPicker
            dealt={table?.dealt ?? []}
            rules={table?.options.rules}
            taken={(table?.players ?? [])
              .filter((p) => p.id !== table?.you && p.deck?.kind === 'precon')
              .map((p) => p.deck!.ref)}
            onClose={() => setPicking(false)}
            onPick={(d) => {
              send({ type: 'load_deck', kind: d.kind, ref: d.ref })
              setPicking(false)
            }}
          />
        </Suspense>
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

/**
 * Mesa de treino: com qual dos seus dois lugares você está jogando agora e o botão para trocar. O
 * lugar de que você está jogando fica embaixo, com a mão; passar o turno troca sozinho.
 */
function PracticeSwitch({
  players,
  you,
  onSwitch,
}: {
  players: { id: number; name: string }[]
  you: number
  onSwitch: () => void
}) {
  const t = useT()
  const other = players.find((p) => p.id !== you)
  const current = players.find((p) => p.id === you)
  if (!other || !current) return null
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md bg-violet-400/10 px-2 py-1 text-xs text-violet-200">
      <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{t('Practice · playing as {name}', { name: current.name })}</span>
      <button
        onClick={onSwitch}
        title={t('Hotkey: Tab')}
        className="ml-auto shrink-0 rounded-full border border-violet-300/50 px-2.5 py-0.5 font-semibold hover:bg-violet-300/15"
      >
        {t('Play as {name}', { name: other.name })}
      </button>
    </div>
  )
}
