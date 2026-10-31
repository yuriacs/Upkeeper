import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Settings, LayoutPanelLeft, RectangleHorizontal, Swords } from 'lucide-react'
import { isMuted, setMuted } from '../../lib/tableSounds'
import { getTableSettings } from '../../lib/tableSettings'
import { setHoverPreview } from '../../lib/hoverPreview'
import { IconButton, ZoneViewer } from './TableKit'
import { TableCtx } from './tableUtils'
import { type TableCard, type TableState, type ZoneName } from '../../hooks/useTableSocket'
import { useT } from '../../lib/i18n'
import { readJSON, writeJSON } from '../../lib/storage'
import { Board, PreviewHost } from './Board'
import { HandBar } from './HandBar'
import { VIEW_KEY, VIEW_MODES, type ViewMode } from './tableLook'

const TableSettingsDialog = lazy(() => import('./TableSettings'))

const NO_SHAKE = new Map<string, number>()
const NO_SELECTION = new Set<string>()
const noop = () => {}

/**
 * Rever uma partida (pages/ReplayPage) com a própria mesa: os mesmos campos, pilhas, zonas e prévia
 * de carta, do jeito que se vê jogando, só que sem ações. A página passa o estado de cada passo
 * (lib/replay: replayTable), os controles do replay (na barra da esquerda, no lugar dos da mesa) e
 * o painel da direita (o que aconteceu, no lugar dos jogadores e do chat).
 */
export function ReplayRoom({ table, controls, side }: { table: TableState; controls: ReactNode; side: ReactNode }) {
  const t = useT()
  useEffect(() => {
    document.documentElement.classList.add('table-orange')
    return () => document.documentElement.classList.remove('table-orange')
  }, [])
  const [view, setViewState] = useState<ViewMode>(
    () => VIEW_MODES.find((m) => m === readJSON<string>(VIEW_KEY, 'split')) ?? 'split',
  )
  const [focusPick, setFocusPick] = useState<{ seat: number; turn: number } | null>(null)
  const [zonesSeat, setZonesSeat] = useState<number | null>(null)
  const [viewer, setViewer] = useState<{ seat: number; zone: ZoneName } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [muted, setMutedState] = useState(isMuted)
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const playersKey = table.players.map((p) => `${p.id}\t${p.seat}\t${p.name}\t${p.sleeve ?? ''}\t${p.sleeve_image ?? ''}\t${p.foil ? 1 : ''}`).join('\n')
  const playerList = useMemo(
    () =>
      playersKey.split('\n').map((line) => {
        const [id, seat, name, sleeve, sleeve_image, foil] = line.split('\t')
        return { id: Number(id), seat: Number(seat), name, sleeve, sleeve_image, foil: !!foil }
      }),
    [playersKey],
  )
  const ctx = useMemo(
    () => ({
      send: noop,
      you: table.you,
      players: playerList,
      hoverKeys: noop,
      preview: (card: TableCard | null, x = 0) => {
        clearTimeout(previewTimer.current)
        const next = card ? { card, side: (x > window.innerWidth / 2 ? 'left' : 'right') as 'left' | 'right' } : null
        const delay = getTableSettings().previewDelay
        if (next && delay > 0) previewTimer.current = setTimeout(() => setHoverPreview(next), delay)
        else setHoverPreview(next)
      },
      openMenu: noop,
      startPick: noop,
      pickCard: () => false,
      toggleSelect: noop,
      cardAction: noop,
      selected: () => [],
    }),
    [table.you, playerList],
  )

  const bySeat = new Map(table.players.map((p) => [p.seat, p]))
  const maxSeats = table.max_seats
  const mySeat = table.you
  const turnNumber = table.turn.number
  const order = Array.from({ length: maxSeats - 1 }, (_, i) => ((mySeat + i) % maxSeats) + 1)
  const taken = order.filter((s) => bySeat.has(s))
  const others = taken.length ? taken : order.slice(0, 1)
  const activeSeat = table.turn.player ?? undefined
  const focus =
    focusPick && focusPick.turn === turnNumber && others.includes(focusPick.seat)
      ? focusPick.seat
      : activeSeat && others.includes(activeSeat)
        ? activeSeat
        : others[0]
  const rest = others.filter((s) => s !== focus)
  const zones = zonesSeat ?? mySeat
  const selectPlayer = (seat: number) => {
    setZonesSeat(seat === mySeat ? null : seat)
    if (seat !== mySeat) setFocusPick({ seat, turn: turnNumber })
  }
  const setView = (v: ViewMode) => {
    setViewState(v)
    writeJSON(VIEW_KEY, v)
  }
  const board = (seat: number, size: 'large' | 'small') => (
    <Board
      key={seat}
      seat={seat}
      player={bySeat.get(seat) ?? null}
      size={size}
      mine={false}
      facing={seat === mySeat}
      selected={zones === seat}
      active={activeSeat === seat}
      onSelect={() => selectPlayer(seat)}
      onPickDeck={noop}
      onOpenZone={(zone) => setViewer({ seat, zone })}
      choosing={false}
      shaking={NO_SHAKE}
      selection={NO_SELECTION}
      onMarquee={noop}
      onClearSelection={noop}
    />
  )
  const zonesPlayer = bySeat.get(zones) ?? null
  const viewerPlayer = viewer ? bySeat.get(viewer.seat) : undefined

  return (
    <TableCtx.Provider value={ctx}>
      <div className="flex flex-col lg:h-dvh lg:min-h-[40rem] lg:flex-row">
        <nav
          aria-label={t('Replay controls')}
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-ink px-2 py-1.5 lg:w-12 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:px-0 lg:py-2"
        >
          {controls}
          <span className="mx-1 h-6 w-px bg-line lg:mx-0 lg:my-1 lg:h-px lg:w-6" aria-hidden />
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
          <IconButton icon={Settings} label={t('Table settings')} tipSide="right" onClick={() => setShowSettings(true)} />
        </nav>

        <div className="grid min-h-0 min-w-0 flex-1 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <section className="flex min-h-0 flex-col">
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
            <div className="flex min-h-[18rem] lg:min-h-0 lg:flex-1">{board(mySeat, 'large')}</div>
            <HandBar
              seat={zones}
              player={zonesPlayer}
              me={null}
              spectating
              handNote={
                zonesPlayer
                  ? t('{name} had {n} card(s) in hand', { name: zonesPlayer.name, n: zonesPlayer.counts.hand })
                  : undefined
              }
              onShowMine={() => setZonesSeat(null)}
              onOpenZone={(zone) => setViewer({ seat: zones, zone })}
              onPickDeck={noop}
              onPeek={noop}
              onTokens={noop}
              onHelpers={noop}
              onHistory={noop}
            />
          </section>
          <aside className="order-first flex min-h-0 flex-col gap-2 border-line p-3 lg:order-none lg:border-l">
            {side}
          </aside>
        </div>
      </div>

      <PreviewHost players={table.players} />
      {viewer && viewerPlayer && (
        <ZoneViewer player={viewerPlayer} zone={viewer.zone} mine={false} onClose={() => setViewer(null)} />
      )}
      {showSettings && (
        <Suspense fallback={null}>
          <TableSettingsDialog
            sample={bySeat.get(mySeat)?.battlefield.find((c) => c.commander && c.image) ?? null}
            muted={muted}
            onMuted={(m) => {
              setMuted(m)
              setMutedState(m)
            }}
            onClose={() => setShowSettings(false)}
          />
        </Suspense>
      )}
    </TableCtx.Provider>
  )
}
