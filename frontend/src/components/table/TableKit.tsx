import { useEffect, useState, type DragEvent, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import type { TableCard, TablePlayer, ZoneName } from '../../hooks/useTableSocket'
import { useT } from '../../lib/i18n'
import { LogoMark } from '../Logo'
import {
  acceptsCard,
  CARD_RATIO,
  DRAG_TYPE,
  dragInfo,
  readDrag,
  useTable,
  zoneLabel,
  type MenuTarget,
} from './tableUtils'

/*
 * Peças da mesa virtual: carta, verso, prévia ampliada, menu da carta e visualizador de zona.
 * As ações vão pelo contexto (TableCtx) para não passar `send` por todos os componentes.
 */

/** Uma carta visível. Se for sua, dá para arrastar e abrir o menu. */
export function CardView({
  card,
  zone,
  mine,
  width,
  tapped = false,
  onDoubleClick,
  menuOnClick = false,
  className = '',
}: {
  card: TableCard
  zone: ZoneName
  mine: boolean
  width: number
  tapped?: boolean
  onDoubleClick?: () => void
  menuOnClick?: boolean
  className?: string
}) {
  const { preview, openMenu } = useTable()
  const menu = (e: MouseEvent) => {
    if (!mine) return
    e.preventDefault()
    openMenu({ card, zone, tapped, x: e.clientX, y: e.clientY })
  }
  return (
    <div
      draggable={mine}
      onDragStart={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        Object.assign(dragInfo, { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width })
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ id: card.id, from: zone }))
        e.dataTransfer.effectAllowed = 'move'
        preview(null)
      }}
      onMouseEnter={(e) => preview(card, e.clientX)}
      onMouseLeave={() => preview(null)}
      onContextMenu={menu}
      onClick={menuOnClick ? menu : undefined}
      onDoubleClick={onDoubleClick}
      style={{ width, height: width * CARD_RATIO }}
      className={`shrink-0 overflow-hidden rounded-[6%] bg-surface shadow-md shadow-black/50 transition-transform duration-150 ${
        tapped ? 'rotate-90' : ''
      } ${mine ? 'cursor-grab active:cursor-grabbing' : ''} ${className}`}
    >
      <img src={card.image} alt={card.name} draggable={false} loading="lazy" className="h-full w-full object-cover" />
    </div>
  )
}

/** Verso de carta (grimório e pilha virada): não usamos o verso oficial, só a marca do site. */
export function CardBack({ width, className = '' }: { width: number; className?: string }) {
  return (
    <div
      style={{ width, height: width * CARD_RATIO }}
      className={`grid shrink-0 place-items-center rounded-[6%] border border-gold/40 bg-[radial-gradient(circle_at_50%_40%,#2a1810,#0b0b0d_70%)] ${className}`}
    >
      <LogoMark className="h-1/4 w-1/4 opacity-70" />
    </div>
  )
}

/** Carta ampliada ao passar o mouse: aparece do lado oposto ao cursor. */
export function CardPreviewPanel({ card, side }: { card: TableCard | null; side: 'left' | 'right' }) {
  if (!card) return null
  return (
    <div
      className={`pointer-events-none fixed top-28 z-40 hidden w-64 animate-[fade-in_0.12s_ease-out] lg:block xl:w-72 ${
        side === 'left' ? 'left-6' : 'right-[19rem]'
      }`}
    >
      <img src={card.image} alt={card.name} className="w-full rounded-[4.5%] shadow-2xl shadow-black/80" />
    </div>
  )
}

/** Menu da carta (botão direito, ou clique na mão): mover entre zonas e virar. */
export function CardMenu({ target, onClose }: { target: MenuTarget; onClose: () => void }) {
  const t = useT()
  const { send } = useTable()
  useEffect(() => {
    const close = () => onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('click', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  const { card, zone } = target
  const move = (to: ZoneName, position?: 'top' | 'bottom') => send({ type: 'move', card: card.id, to, position })
  const items: [string, () => void][] = []
  if (zone === 'battlefield')
    items.push([target.tapped ? t('Untap') : t('Tap'), () => send({ type: 'tap', card: card.id })])
  const targets: ZoneName[] = ['hand', 'battlefield', 'graveyard', 'exile', 'command', 'facedown']
  for (const z of targets) if (z !== zone) items.push([zoneLabel(t, z), () => move(z)])
  items.push([t('Top of library'), () => move('library', 'top')])
  items.push([t('Bottom of library'), () => move('library', 'bottom')])

  // Mantém o menu dentro da tela
  const left = Math.min(target.x, window.innerWidth - 200)
  const top = Math.min(target.y, window.innerHeight - 40 * items.length - 40)
  return (
    <div
      role="menu"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 w-48 overflow-hidden rounded-lg border border-line bg-surface py-1 text-sm shadow-2xl shadow-black/70"
    >
      <p className="truncate border-b border-line px-3 pt-1 pb-1.5 text-xs font-semibold text-parchment/60">
        {card.name}
      </p>
      {zone !== 'battlefield' && (
        <p className="px-3 pt-1.5 text-[0.65rem] tracking-wide text-parchment/40 uppercase">{t('Move to')}</p>
      )}
      {items.map(([label, run]) => (
        <button
          key={label}
          role="menuitem"
          onClick={() => {
            run()
            onClose()
          }}
          className="block w-full px-3 py-1.5 text-left transition hover:bg-parchment/10 hover:text-gold"
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Janela com as cartas de uma zona (cemitério, exílio, comando, pilha virada). */
export function ZoneViewer({
  player,
  zone,
  mine,
  onClose,
}: {
  player: TablePlayer
  zone: ZoneName
  mine: boolean
  onClose: () => void
}) {
  const t = useT()
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const cards = (player[zone as 'graveyard'] as TableCard[] | null) ?? []
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={zoneLabel(t, zone)}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80dvh] w-full max-w-4xl flex-col rounded-xl border border-line bg-ink"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-2xl">
            {zoneLabel(t, zone)} · {player.name}
          </h2>
          <span className="text-sm text-parchment/50">{cards.length}</span>
          <button
            onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-parchment/60 hover:text-gold"
            aria-label={t('Close')}
          >
            ✕
          </button>
        </div>
        {mine && cards.length > 0 && (
          <p className="px-4 pt-3 text-xs text-parchment/45">{t('Click a card to move it.')}</p>
        )}
        <div className="flex flex-wrap gap-2 overflow-y-auto p-4">
          {cards.length === 0 && <p className="text-sm text-parchment/40">{t('Empty.')}</p>}
          {cards.map((c) => (
            <CardView key={c.id} card={c} zone={zone} mine={mine} width={110} menuOnClick />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Moldura de uma zona que aceita cartas arrastadas (só as suas). */
export function DropZone({
  enabled,
  onCard,
  className = '',
  children,
  ...rest
}: {
  enabled: boolean
  onCard: (card: { id: string; from: ZoneName }, e: DragEvent<HTMLDivElement>) => void
  className?: string
  children?: ReactNode
} & Omit<HTMLAttributes<HTMLDivElement>, 'onDrop'>) {
  const [over, setOver] = useState(false)
  return (
    <div
      {...rest}
      onDragOver={(e) => {
        if (!enabled || !acceptsCard(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        if (!enabled) return
        const card = readDrag(e)
        if (card) {
          e.preventDefault()
          onCard(card, e)
        }
      }}
      className={`${className} ${over ? 'ring-2 ring-gold/70 ring-inset' : ''}`}
    >
      {children}
    </div>
  )
}
