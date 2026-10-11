import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import DeckPicker from '../components/table/DeckPicker'
import { CardBack, CardMenu, CardPreviewPanel, CardView, DropZone, ZoneViewer } from '../components/table/TableKit'
import { CARD_RATIO, TableCtx, dragInfo, useTable, zoneLabel, type MenuTarget } from '../components/table/tableUtils'
import { useTableSocket, type LogItem, type TableCard, type TablePlayer, type ZoneName } from '../hooks/useTableSocket'
import { useTitle } from '../hooks/useTitle'
import { useT } from '../lib/i18n'
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
const SEAT_TINT = ['from-gold/[0.08]', 'from-sky-400/[0.08]', 'from-emerald-400/[0.08]', 'from-violet-400/[0.08]']

// Split: o oponente em foco aparece grande e os outros pequenos ao lado. Full: todos do mesmo tamanho.
type ViewMode = 'split' | 'full'
const VIEW_KEY = 'precon-draft:table-view'
// Largura das cartas no campo (px): as posições são frações do campo, então valem nos dois tamanhos
const CARD_W = { large: 76, small: 44 } as const
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
  const join = (e: FormEvent) => {
    e.preventDefault()
    const clean = code.trim().toUpperCase()
    if (/^[A-Z0-9]{4,12}$/.test(clean)) navigate(`/mesa/${clean}`)
  }
  return (
    <div className="mx-auto max-w-xl py-6">
      <p className="text-sm font-semibold tracking-wide text-gold uppercase">{t('Beta')}</p>
      <h1 className="font-display mt-1 text-5xl">{t('Virtual table')}</h1>
      <p className="mt-4 text-parchment/70">
        {t('Play Commander online with up to 4 players: pick a precon or a deck from your pool and share the link.')}
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

const ERRORS: Record<string, string> = {
  library_empty: 'Your library is empty.',
  deck_not_found: 'Deck not found.',
  no_deck: 'Choose a deck first.',
  not_your_card: 'You can only move your own cards.',
}

function TableRoom({ code }: { code: string }) {
  const t = useT()
  const { table, status, error, send } = useTableSocket(code)
  const [copied, setCopied] = useState(false)
  const [view, setViewState] = useState<ViewMode>(() =>
    readJSON<string>(VIEW_KEY, 'split') === 'full' ? 'full' : 'split',
  )
  // Oponente em foco no modo split e jogador cujas zonas aparecem ao lado da mão
  const [focusSeat, setFocusSeat] = useState<number | null>(null)
  const [zonesSeat, setZonesSeat] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ card: TableCard; side: 'left' | 'right' } | null>(null)
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [viewer, setViewer] = useState<{ seat: number; zone: ZoneName } | null>(null)
  const [picking, setPicking] = useState(false)
  // Erro do servidor aparece por 3 s (dismissed = hora do último erro já escondido)
  const [dismissed, setDismissed] = useState(0)
  useTitle(t('Table {code}', { code }))

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setDismissed(error.at), 3000)
    return () => clearTimeout(timer)
  }, [error])
  const toast = error && error.at > dismissed ? t(ERRORS[error.code] ?? 'That action is not allowed.') : null

  const closeMenu = useCallback(() => setMenu(null), [])
  const ctx = useMemo(
    () => ({
      send,
      you: table?.you ?? 0,
      preview: (card: TableCard | null, x = 0) =>
        setPreview(card ? { card, side: x > window.innerWidth / 2 ? 'left' : 'right' } : null),
      openMenu: setMenu,
    }),
    [send, table?.you],
  )

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
  const order = Array.from({ length: maxSeats - 1 }, (_, i) => ((mySeat + i) % maxSeats) + 1)
  // Só os lugares ocupados ganham campo (num 1 contra 1 o oponente ocupa a faixa toda);
  // mesa sem oponentes mostra um lugar livre, para lembrar de mandar o convite
  const taken = order.filter((s) => bySeat.has(s))
  const others = taken.length ? taken : order.slice(0, 1)
  const focus = focusSeat !== null && others.includes(focusSeat) ? focusSeat : others[0]
  const rest = others.filter((s) => s !== focus)
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
      mine={seat === mySeat && !!me}
      selected={zones === seat}
      onSelect={() => selectPlayer(seat)}
      onPickDeck={() => setPicking(true)}
    />
  )
  const viewerPlayer = viewer ? bySeat.get(viewer.seat) : undefined

  return (
    <TableCtx.Provider value={ctx}>
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
            <span
              className={`h-2 w-2 rounded-full ${status === 'open' ? 'bg-emerald-400' : 'animate-pulse bg-gold'}`}
            />
            {status === 'open' ? t('Connected') : status === 'reconnecting' ? t('Reconnecting…') : t('Connecting…')}
          </span>
          <span className="hidden text-xs text-parchment/40 xl:inline">
            {t('Drag your cards · right-click for options · double-click to tap')}
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
                  />
                )
              })}
            </div>
            <TableLog log={table?.log ?? []} />
          </aside>
        </div>
      </div>

      <CardPreviewPanel card={preview?.card ?? null} side={preview?.side ?? 'right'} />
      {menu && <CardMenu target={menu} onClose={closeMenu} />}
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
          onClose={() => setPicking(false)}
          onPick={(d) => {
            send({ type: 'load_deck', kind: d.kind, ref: d.slug })
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

/** Campo de um jogador: as cartas ficam onde o dono soltou (posição em fração do campo). */
function Board({
  seat,
  player,
  size,
  mine,
  selected,
  onSelect,
  onPickDeck,
}: {
  seat: number
  player: TablePlayer | null
  size: 'large' | 'small'
  mine: boolean
  selected: boolean
  onSelect: () => void
  onPickDeck: () => void
}) {
  const t = useT()
  const { send } = useTable()
  const large = size === 'large'
  const w = CARD_W[size]
  const h = w * CARD_RATIO
  return (
    <DropZone
      enabled={mine && !!player?.deck}
      onCard={(card, e) => {
        // Solta no ponto onde o mouse pegou a carta, corrigindo a diferença de tamanho (mão → campo)
        const r = e.currentTarget.getBoundingClientRect()
        const scale = w / dragInfo.w
        const x = (e.clientX - dragInfo.dx * scale - r.left) / Math.max(1, r.width - w)
        const y = (e.clientY - dragInfo.dy * scale - r.top) / Math.max(1, r.height - h)
        send({ type: 'move', card: card.id, to: 'battlefield', x: clamp01(x), y: clamp01(y) })
      }}
      className={`relative min-h-0 flex-1 overflow-hidden bg-gradient-to-b to-transparent [&+&]:border-t [&+&]:border-line ${SEAT_TINT[seat - 1]}`}
    >
      <span
        className={`font-display pointer-events-none absolute inset-0 grid place-items-center truncate px-4 text-parchment/[0.06] select-none ${large ? 'text-5xl xl:text-7xl' : 'text-2xl xl:text-3xl'}`}
      >
        {player?.name ?? t('Open seat')}
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
            <span className="font-semibold">{player.life}</span>
            {player.deck && (
              <span className="hidden sm:inline" title={t('Hand') + ' · ' + t('Library')}>
                ✋ {player.counts.hand} · ▤ {player.counts.library}
              </span>
            )}
          </>
        )}
      </div>
      {player?.battlefield.map((c) => (
        <div
          key={c.id}
          className="absolute"
          style={{ left: `calc((100% - ${w}px) * ${c.x})`, top: `calc((100% - ${h}px) * ${c.y})` }}
        >
          <CardView
            card={c}
            zone="battlefield"
            mine={mine}
            width={w}
            tapped={c.tapped}
            onDoubleClick={mine ? () => send({ type: 'tap', card: c.id }) : undefined}
          />
        </div>
      ))}
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

/** Uma zona (grimório, comando, pilha virada, exílio, cemitério): carta do topo e quantidade. */
function ZoneTile({
  player,
  zone,
  mine,
  onOpen,
}: {
  player: TablePlayer
  zone: ZoneName
  mine: boolean
  onOpen: (z: ZoneName) => void
}) {
  const t = useT()
  const { send } = useTable()
  const count = player.counts[zone]
  const list = zone === 'library' ? null : (player[zone as 'graveyard'] as TableCard[] | null)
  const top = list?.at(-1)
  const hidden = zone === 'library' || (zone === 'facedown' && !mine)
  const canOpen = !hidden && count > 0
  const click = () => {
    if (zone === 'library' && mine) send({ type: 'draw', n: 1 })
    else if (canOpen) onOpen(zone)
  }
  return (
    <DropZone
      enabled={mine && !!player.deck}
      onCard={(card) => send({ type: 'move', card: card.id, to: zone, position: 'top' })}
      className="flex w-[4.25rem] flex-col items-center gap-1 rounded-md p-0.5"
    >
      <button
        onClick={click}
        disabled={!(zone === 'library' && mine) && !canOpen}
        title={zone === 'library' && mine ? t('Click to draw') : zoneLabel(t, zone)}
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
}: {
  seat: number
  player: TablePlayer | null
  me: TablePlayer | null
  onShowMine: () => void
  onOpenZone: (z: ZoneName) => void
  onPickDeck: () => void
}) {
  const t = useT()
  const { send } = useTable()
  const [confirmRestart, setConfirmRestart] = useState(false)
  const mine = !!player && player.id === me?.id
  const hand = me?.hand ?? []
  const hasDeck = !!me?.deck
  // Muitas cartas na mão: elas se sobrepõem para caber
  const overlap = hand.length > 8 ? -Math.min(44, (hand.length - 8) * 6 + 16) : 4
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
            (['library', 'command', 'facedown', 'exile', 'graveyard'] as const).map((z) => (
              <ZoneTile key={z} player={player} zone={z} mine={mine} onOpen={onOpenZone} />
            ))
          ) : (
            <p className="text-xs text-parchment/40">{t('Open seat')}</p>
          )}
        </div>
      </div>

      <DropZone
        enabled={hasDeck}
        onCard={(card) => send({ type: 'move', card: card.id, to: 'hand' })}
        className="flex min-h-[7.5rem] min-w-48 flex-1 items-center overflow-x-auto rounded-md border border-dashed border-parchment/10 px-2"
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
              <CardView card={c} zone="hand" mine width={74} menuOnClick />
            </div>
          ))
        )}
      </DropZone>

      <div className="flex max-w-[15rem] flex-wrap content-center gap-1.5">
        <button className={btn} disabled={!hasDeck || !me?.counts.library} onClick={() => send({ type: 'draw', n: 1 })}>
          {t('Draw')}
        </button>
        {hasDeck && hand.length === 0 && (
          <button className={btn} disabled={!me?.counts.library} onClick={() => send({ type: 'draw', n: 7 })}>
            {t('Draw 7')}
          </button>
        )}
        <button className={btn} disabled={!hasDeck} onClick={() => send({ type: 'untap_all' })}>
          {t('Untap all')}
        </button>
        <button className={btn} disabled={!hasDeck} onClick={() => send({ type: 'shuffle' })}>
          {t('Shuffle')}
        </button>
        <button className={btn} disabled={!hasDeck} onClick={() => send({ type: 'mulligan' })}>
          {t('Mulligan')}
        </button>
        <button className={btn} disabled={!me} onClick={onPickDeck}>
          {hasDeck ? t('Change deck') : t('Choose your deck')}
        </button>
        <button
          className={`${btn} ${confirmRestart ? 'border-gold text-gold' : ''}`}
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
        >
          {confirmRestart ? t('Click again to restart') : t('Restart game')}
        </button>
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
}: {
  seat: number
  player: TablePlayer | null
  mine: boolean
  selected: boolean
  onSelect: () => void
}) {
  const t = useT()
  const { send } = useTable()
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

/** Uma linha do log, montada no idioma de quem lê. */
function logText(t: (s: string, v?: Record<string, string | number>) => string, e: LogItem): string {
  const who = e.who
  const card = e.card ?? t('a card')
  switch (e.kind) {
    case 'joined':
      return t('{who} sat down', { who })
    case 'deck':
      return t('{who} loaded {deck} ({n} cards)', { who, deck: e.deck ?? '', n: e.n ?? 0 })
    case 'draw':
      return e.n === 1 ? t('{who} drew a card', { who }) : t('{who} drew {n} cards', { who, n: e.n ?? 0 })
    case 'move':
      if (e.to === 'library')
        return t(
          e.position === 'bottom'
            ? '{who} put {card} on the bottom of the library'
            : '{who} put {card} on top of the library',
          {
            who,
            card,
          },
        )
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
    case 'shuffle':
      return t('{who} shuffled the library', { who })
    case 'mulligan':
      return t('{who} took a mulligan', { who })
    case 'restart':
      return t('{who} restarted the game', { who })
    case 'life':
      return t('{who}: life {from} → {to}', { who, from: e.frm ?? '', to: e.to ?? '' })
    default:
      return who
  }
}

function TableLog({ log }: { log: LogItem[] }) {
  const t = useT()
  const items = [...log].reverse()
  return (
    <div className="flex max-h-48 min-h-24 flex-1 flex-col rounded-lg border border-line bg-surface/60 lg:max-h-none lg:min-h-40">
      <div className="flex gap-4 border-b border-line px-3 pt-2 text-xs font-semibold tracking-wide uppercase">
        <span className="border-b-2 border-gold pb-1.5">{t('Log')}</span>
        <span className="pb-1.5 text-parchment/35" title={t('Coming in phase 2')}>
          {t('Chat')}
        </span>
      </div>
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2 text-xs text-parchment/70">
        {items.length === 0 && <li className="text-parchment/35">{t('Nothing happened yet.')}</li>}
        {items.map((e, i) => (
          <li key={log.length - i}>
            <span
              className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${['bg-gold', 'bg-sky-400', 'bg-emerald-400', 'bg-violet-400'][e.seat - 1]}`}
            />
            {logText(t, e)}
          </li>
        ))}
      </ol>
    </div>
  )
}
