import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  ArrowUpFromLine,
  ChevronDown,
  ChevronUp,
  Library,
  History,
  Eye,
  EyeOff,
  Crown,
  RefreshCw,
  RotateCcw,
  ScanEye,
  Search,
  Shuffle,
  Sparkles,
  Rows3,
  BookOpen,
  Plus,
  Megaphone,
  ThumbsUp,
  Menu,
} from 'lucide-react'
import { ToolbarMenu } from './ToolbarMenu'
import { DiceMenu } from './TableExtras'
import { HAND_CARD, updateTableSettings, useTableSettings } from '../../lib/tableSettings'
import { CardView, DropZone, IconButton, LibraryMenu } from './TableKit'
import { CARD_RATIO, useTable } from './tableUtils'
import { type TablePlayer, type ZoneName } from '../../hooks/useTableSocket'
import { useT } from '../../lib/i18n'
import { ZoneTile } from './Board'
import { SEAT_TEXT, overlapFor } from './tableLook'

/** Faixa de baixo: zonas do jogador selecionado, sua mão e as ações (assistindo: a mão de quem você segue). */
export function HandBar({
  seat,
  player,
  me,
  onShowMine,
  onOpenZone,
  onPickDeck,
  onPeek,
  onTokens,
  onHelpers,
  onHistory,
  spectating,
  handNote,
}: {
  seat: number
  player: TablePlayer | null
  me: TablePlayer | null
  /** Assistindo: só as zonas (sem mão nem ações) */
  spectating: boolean
  /** No lugar do aviso de mão escondida de quem assiste (rever a partida) */
  handNote?: string
  onShowMine: () => void
  onOpenZone: (z: ZoneName) => void
  onPickDeck: () => void
  onPeek: (n: number | null) => void
  onTokens: () => void
  /** Cartas de ajuda: Monarca, Iniciativa, O Anel, energia... */
  onHelpers: () => void
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
                {handNote ??
                  t('{name} has {n} card(s) in hand (hidden from spectators)', {
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

/**
 * Menu "Mostrar a mão para…": cada jogador e quem está assistindo (escondida deles por padrão)
 * ligam/desligam; "Todos" e "Esconder de todos".
 */
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
      {others.length > 1 && !all && (
        <button role="menuitem" onClick={() => onToggle(null, true)} className={`${row} border-t border-line`}>
          {t('Show to all players')}
        </button>
      )}
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
export function RevealedHands({ players, you }: { players: TablePlayer[]; you: number }) {
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
