import {
  ArrowDownFromLine,
  ArrowUpFromLine,
  Ban,
  ChevronRight,
  CirclePlus,
  Copy,
  Crosshair,
  EyeOff,
  FlipVertical2,
  Hand,
  Highlighter,
  Layers,
  Link2,
  Lock,
  LockOpen,
  Repeat2,
  RotateCcw,
  RotateCw,
  Send,
  Shapes,
  Sparkles,
  StickyNote,
  Swords,
  Unlink2,
  UserRoundCog,
  Vibrate,
  type LucideIcon,
} from 'lucide-react'
import { memo, useEffect, useState, type DragEvent, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import type { DrawTarget, FieldCard, TableCard, TablePlayer, ZoneName } from '../../hooks/useTableSocket'
import { useT } from '../../lib/i18n'
import { Tombstone } from '../../lib/icons'
import { helperByName } from './helpers'
import { useTableSettings } from '../../lib/tableSettings'
import { LogoMark } from '../Logo'
import {
  acceptsCard,
  CARD_RATIO,
  COUNTER_KINDS,
  isField,
  DRAG_TYPE,
  dragInfo,
  readDrag,
  ABILITY_KEYS,
  MARK_KEYS,
  SYMBOL_ICONS,
  symbolLabel,
  useTable,
  zoneLabel,
  type MenuTarget,
} from './tableUtils'

/*
 * Peças da mesa virtual: carta, verso, prévia ampliada, menu da carta e visualizador de zona.
 * As ações vão pelo contexto (TableCtx) para não passar `send` por todos os componentes.
 */

/**
 * Botão só com ícone. O texto aparece num balão ao passar o mouse (e vai para leitores de tela).
 * `hotkey` aparece no balão.
 */
export function IconButton({
  icon: Icon,
  text,
  label,
  hotkey,
  onClick,
  disabled,
  active,
  tone = 'default',
  size = 'md',
  tipSide = 'top',
}: {
  /** Ícone, ou um texto curto no lugar dele (ex.: "d20") */
  icon?: LucideIcon
  text?: string
  label: string
  hotkey?: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  tone?: 'default' | 'gold' | 'danger'
  size?: 'sm' | 'md'
  tipSide?: 'top' | 'bottom' | 'right'
}) {
  const tones = {
    default: 'border-line text-parchment/80 enabled:hover:border-parchment/40 enabled:hover:bg-parchment/10',
    gold: 'border-gold/50 text-gold enabled:hover:bg-gold/15',
    danger: 'border-line text-parchment/70 enabled:hover:border-red-400/60 enabled:hover:text-red-300',
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`group relative grid shrink-0 place-items-center rounded-md border transition disabled:opacity-35 ${
        size === 'sm' ? 'h-7 min-w-7' : 'h-8 min-w-8'
      } ${Icon ? '' : 'px-1.5 text-xs font-semibold'} ${active ? 'border-gold bg-gold/15 text-gold' : tones[tone]}`}
    >
      {Icon ? <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={2} aria-hidden /> : text}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-[70] rounded-md border border-line bg-black px-2 py-1 text-[0.7rem] whitespace-nowrap text-parchment opacity-0 shadow-lg transition-opacity delay-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${
          tipSide === 'right'
            ? 'top-1/2 left-full ml-2 -translate-y-1/2'
            : `left-1/2 -translate-x-1/2 ${tipSide === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`
        }`}
      >
        {label}
        {hotkey && (
          <kbd className="ml-1.5 rounded border border-line px-1 text-[0.6rem] text-parchment/60">{hotkey}</kbd>
        )}
      </span>
    </button>
  )
}

/** Uma carta visível. Se for sua, dá para arrastar; cartas do campo têm menu para todos. */
function CardViewBase({
  card,
  zone,
  mine,
  width,
  tapped = false,
  tax,
  onDoubleClick,
  menuOnClick = false,
  onHover,
  selected = false,
  className = '',
}: {
  card: TableCard | FieldCard
  zone: ZoneName
  tax?: number
  mine: boolean
  width: number
  tapped?: boolean
  onDoubleClick?: () => void
  menuOnClick?: boolean
  /** Prévia própria (janela de zona); sem isso, usa a prévia da mesa */
  onHover?: (card: TableCard | null) => void
  /** Faz parte da seleção (várias cartas) */
  selected?: boolean
  className?: string
}) {
  const { preview, openMenu, pickCard, toggleSelect } = useTable()
  const field = isField(card) ? card : null
  const hidden = !card.image // virada para baixo e você não pode ver
  const menu = (e: MouseEvent) => {
    // Cartas do campo: menu para qualquer jogador. Nas outras zonas, só o dono.
    if (!mine && zone !== 'battlefield') return
    e.preventDefault()
    openMenu({ card, zone, tapped, tax, x: e.clientX, y: e.clientY })
  }
  const rotate =
    tapped && field?.inverted ? 'rotate-[270deg]' : tapped ? 'rotate-90' : field?.inverted ? 'rotate-180' : ''
  return (
    <div
      data-card-id={card.id}
      draggable={mine && !field?.locked}
      onDragStart={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        Object.assign(dragInfo, { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width })
        e.dataTransfer.setData(
          DRAG_TYPE,
          JSON.stringify({ id: card.id, from: zone, attach: card.attach ?? null, name: card.name }),
        )
        e.dataTransfer.effectAllowed = 'move'
        preview(null)
      }}
      onMouseEnter={(e) =>
        onHover ? onHover(card) : preview(hidden ? null : card, e.clientX, { card, zone, mine, tapped })
      }
      onMouseLeave={() => (onHover ? onHover(null) : preview(null))}
      onContextMenu={menu}
      onClick={(e) => {
        if (pickCard(card.id, zone)) {
          e.stopPropagation()
          return
        }
        // Ctrl/Shift + clique: seleciona várias cartas do campo
        if (zone === 'battlefield' && (e.ctrlKey || e.metaKey || e.shiftKey)) {
          e.stopPropagation()
          toggleSelect(card.id)
          return
        }
        if (menuOnClick) menu(e)
      }}
      onDoubleClick={onDoubleClick}
      style={{ width, height: width * CARD_RATIO }}
      className={`relative shrink-0 overflow-hidden rounded-[6%] bg-surface transition-transform duration-150 ${rotate} ${
        selected
          ? 'shadow-[0_0_0_3px_#38bdf8,0_0_14px_rgba(56,189,248,0.7)]'
          : field?.highlight
            ? 'shadow-[0_0_0_2px_#facc15,0_0_16px_rgba(250,204,21,0.65)]'
            : 'shadow-md shadow-black/50'
      } ${mine && !field?.locked ? 'cursor-grab active:cursor-grabbing' : ''} ${className}`}
    >
      {hidden ? (
        <div className="grid h-full w-full place-items-center border border-gold/40 bg-[radial-gradient(circle_at_50%_40%,#2a1810,#0b0b0d_70%)]">
          <LogoMark className="h-1/4 w-1/4 opacity-70" />
        </div>
      ) : (
        <img
          src={card.image}
          alt={card.name}
          draggable={false}
          loading="lazy"
          decoding="async"
          className={`h-full w-full object-cover ${field?.face_down ? 'opacity-45 grayscale' : ''}`}
        />
      )}
      {field && <CardBadges card={field} tax={tax} small={width < 60} />}
    </div>
  )
}

/**
 * Carta memorizada: a cada atualização da mesa só redesenha as cartas que mudaram de verdade
 * (com 4 jogadores são centenas de cartas na tela).
 */
const fieldKey = (c: TableCard | FieldCard) => (isField(c) ? JSON.stringify({ ...c, x: 0, y: 0 }) : c.image + c.name)
export const CardView = memo(CardViewBase, (a, b) => {
  // Mesmo objeto (o delta do servidor preserva as cartas que não mudaram): só confere o resto
  if (a.card !== b.card && (a.card.id !== b.card.id || fieldKey(a.card) !== fieldKey(b.card))) return false
  if (a.zone !== b.zone || a.mine !== b.mine || a.width !== b.width || a.tapped !== b.tapped) return false
  if (a.tax !== b.tax || a.menuOnClick !== b.menuOnClick || a.className !== b.className) return false
  if (a.onHover !== b.onHover || a.selected !== b.selected) return false
  return (a.onDoubleClick === undefined) === (b.onDoubleClick === undefined)
})

/** Marcadores, ficha, imposto, nota, símbolo e travas desenhados por cima da carta no campo. */
function CardBadges({ card, tax, small }: { card: FieldCard; tax?: number; small: boolean }) {
  const t = useT()
  const pill = `rounded bg-ink/90 font-bold leading-none ring-1 ring-gold/60 ${small ? 'px-0.5 py-px text-[0.5rem]' : 'px-1 py-0.5 text-[0.62rem]'}`
  const counters = Object.entries(card.counters)
  const icon = small ? 'h-2.5 w-2.5' : 'h-3 w-3'
  return (
    <>
      {card.note && (
        <div
          title={card.note}
          className={`absolute inset-x-[4%] top-[4%] line-clamp-2 rounded bg-amber-200/95 text-center leading-tight font-semibold break-words text-ink shadow ${
            small ? 'px-0.5 text-[0.45rem]' : 'px-1 py-px text-[0.6rem]'
          }`}
        >
          {card.note}
        </div>
      )}
      {((card.token && !card.helper) || (card.commander && !!tax)) && (
        <div className={`absolute right-[4%] flex flex-col items-end gap-0.5 ${card.note ? 'top-[24%]' : 'top-[8%]'}`}>
          {card.token && !card.helper && <span className={pill}>{t('Token')}</span>}
          {card.commander && !!tax && <span className={`${pill} text-gold`}>{t('Tax +{n}', { n: tax * 2 })}</span>}
        </div>
      )}
      {(card.locked || card.face_down) && (
        <div className={`absolute left-[4%] flex gap-0.5 ${card.note ? 'top-[24%]' : 'top-[8%]'}`}>
          {card.locked && (
            <span className={pill} title={t('Locked')}>
              <Lock className={icon} aria-label={t('Locked')} />
            </span>
          )}
          {card.face_down && (
            <span className={pill} title={t('Face down')}>
              <EyeOff className={icon} aria-label={t('Face down')} />
            </span>
          )}
        </div>
      )}
      {card.stats && <StatBox card={card} small={small} />}
      {counters.length > 0 && (
        <div
          className={`pointer-events-none absolute inset-x-0 flex flex-col items-center gap-0.5 ${card.note ? 'top-[30%]' : 'top-[22%]'}`}
        >
          {counters.map(([kind, n]) => (
            <span
              key={kind}
              title={counterLabel(t, kind)}
              className={`rounded-md font-display leading-none font-bold shadow-lg shadow-black/70 ring-2 ${
                small ? 'px-1 py-0.5 text-[0.7rem]' : 'px-1.5 py-1 text-base'
              } ${
                kind === '+1/+1'
                  ? 'bg-emerald-950/95 text-emerald-200 ring-emerald-400'
                  : kind === '-1/-1'
                    ? 'bg-red-950/95 text-red-200 ring-red-400'
                    : 'bg-ink/95 text-gold ring-gold/80'
              }`}
            >
              {kind === '+1/+1' || kind === '-1/-1' ? `${kind[0]}${n}/${kind[0]}${n}` : `${counterLabel(t, kind)} ${n}`}
            </span>
          ))}
        </div>
      )}
    </>
  )
}

/**
 * Símbolos da carta do campo, pequenos e discretos, numa coluna ao lado dela (fora da carta,
 * para não cobrir a arte). `side` = de que lado da carta a coluna fica.
 */
export function SymbolStrip({
  symbols,
  small,
  side = 'right',
}: {
  symbols: string[]
  small: boolean
  side?: 'right' | 'left'
}) {
  const t = useT()
  if (!symbols.length) return null
  return (
    <div
      className={`pointer-events-auto absolute top-0 z-10 flex flex-col gap-0.5 ${side === 'right' ? 'left-full ml-0.5' : 'right-full mr-0.5'}`}
    >
      {symbols.map((key) => {
        const Icon = SYMBOL_ICONS[key]
        if (!Icon) return null
        return (
          <span
            key={key}
            title={symbolLabel(t, key)}
            className={`grid place-items-center rounded-full bg-ink/85 text-gold/90 ring-1 ring-gold/40 ${small ? 'h-3.5 w-3.5' : 'h-[1.1rem] w-[1.1rem]'}`}
          >
            <Icon className={small ? 'h-2 w-2' : 'h-2.5 w-2.5'} aria-label={symbolLabel(t, key)} />
          </span>
        )
      })}
    </div>
  )
}

/**
 * Força/resistência no canto da carta, por cima da caixa impressa. Clique soma 1, botão direito
 * tira 1 (só quem controla a carta; os outros só veem). Marcadores +1/+1 e -1/-1 já entram na conta.
 */
function StatBox({ card, small }: { card: FieldCard; small: boolean }) {
  const t = useT()
  const { send, you } = useTable()
  const canEdit = (card.controller ?? card.owner) === you
  const stats = card.stats!
  const mod = (card.counters['+1/+1'] ?? 0) - (card.counters['-1/-1'] ?? 0)
  const shown = { p: stats.p + mod, t: stats.t + mod }
  const tone = (which: 'p' | 't') => {
    const base = card.base?.[which]
    if (base === undefined) return ''
    return shown[which] > base ? 'text-emerald-300' : shown[which] < base ? 'text-red-300' : ''
  }
  const part = (which: 'p' | 't') => {
    const label = which === 'p' ? t('Power') : t('Toughness')
    if (!canEdit)
      return (
        <span aria-label={label} className={`px-0.5 ${tone(which)}`}>
          {shown[which]}
        </span>
      )
    return (
      <button
        type="button"
        title={t('{stat}: click +1, right-click −1', { stat: label })}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation()
          send({ type: 'stat', card: card.id, which, delta: 1 })
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          send({ type: 'stat', card: card.id, which, delta: -1 })
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className={`rounded px-0.5 hover:bg-gold/30 ${tone(which)}`}
      >
        {shown[which]}
      </button>
    )
  }
  return (
    <div
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      className={`font-display absolute right-[3%] bottom-[3%] flex items-center rounded-md bg-ink/95 leading-none text-parchment ring-1 ring-gold/70 ${
        small ? 'px-0.5 py-px text-[0.6rem]' : 'px-1 py-0.5 text-sm'
      }`}
    >
      {part('p')}
      <span className="text-parchment/50">/</span>
      {part('t')}
    </div>
  )
}

const counterLabel = (t: (s: string) => string, kind: string) =>
  (
    ({
      Loyalty: t('Loyalty'),
      Charge: t('Charge'),
      Tempted: t('Tempted'),
      Energy: t('Energy'),
      Rad: t('Rad'),
      Experience: t('Experience'),
      Speed: t('Speed'),
    }) as Record<string, string>
  )[kind] ?? kind

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
  const { previewEnabled, previewWidth, previewSide, reduceMotion } = useTableSettings()
  if (!card?.image || !previewEnabled) return null
  const where = previewSide === 'auto' ? side : previewSide
  return (
    <div
      // Nunca maior que a altura da tela
      style={{ width: `min(${previewWidth}px, calc((100dvh - 8rem) / 1.4))` }}
      className={`pointer-events-none fixed top-24 z-[45] hidden lg:block ${reduceMotion ? '' : 'animate-[fade-in_0.12s_ease-out]'} ${
        where === 'left' ? 'left-6' : 'right-[19rem]'
      }`}
    >
      <img src={card.image} alt={card.name} className="w-full rounded-[4.5%] shadow-2xl shadow-black/80" />
      {isField(card) && card.note && (
        <p className="mt-2 rounded-md bg-amber-200 px-3 py-2 text-sm font-semibold break-words text-ink shadow-lg">
          {card.note}
        </p>
      )}
    </div>
  )
}

/**
 * Quantidade de um marcador que dá para digitar (ex.: 7): vale ao apertar Enter ou sair do campo.
 */
function CountInput({ value, label, onCommit }: { value: number; label: string; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    // o valor mudou por fora (clique em +/−, outro jogador): acompanha
    setSeen(value)
    setText(String(value))
  }
  const commit = () => {
    const n = Math.max(0, Math.min(999, Math.trunc(Number(text)) || 0))
    setText(String(n))
    if (n !== value) onCommit(n)
  }
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={999}
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
      }}
      className="w-10 rounded border border-line bg-ink py-0.5 text-center text-xs [appearance:textfield] focus:border-gold focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
    />
  )
}

/** Marcadores do menu: o da carta de ajuda (Rad, Energy...) primeiro, depois os comuns */
const counterKinds = (name: string): string[] => {
  const own = helperByName(name)?.counter
  return own ? [own, ...COUNTER_KINDS] : [...COUNTER_KINDS]
}

type Sub = 'counters' | 'symbol' | 'send' | 'control' | 'note' | null

/**
 * Menu da carta (botão direito, ou clique na mão). No campo vale para qualquer carta, sua ou de
 * um oponente: atalhos em ícones no topo, e a lista com submenus (marcadores, símbolo, enviar
 * para, dar o controle). Nas outras zonas: revelar e mover.
 */
export function CardMenu({ target, onClose }: { target: MenuTarget; onClose: () => void }) {
  const t = useT()
  const { send, players, startPick, you } = useTable()
  const [sub, setSub] = useState<Sub>(null)
  // A nota fica aberta mesmo passando o mouse por outras linhas (e já abre pelo atalho N)
  const [noteOpen, setNoteOpen] = useState(target.sub === 'note')
  const [note, setNote] = useState(() => (isField(target.card) ? (target.card.note ?? '') : ''))
  const [custom, setCustom] = useState('')
  const [customN, setCustomN] = useState(1)
  useEffect(() => {
    const close = () => onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // pointerdown (e não click): o clique que abriu o menu já passou e não o fecha na mesma hora
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  const { card, zone } = target
  const field = zone === 'battlefield' && isField(card) ? card : null
  const id = card.id
  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }
  const move = (to: ZoneName, position?: 'top' | 'bottom') => send({ type: 'move', card: id, to, position })

  // Mantém o menu (e os submenus) dentro da tela
  const width = 272
  const left = Math.max(8, Math.min(target.x, window.innerWidth - width - 8))
  const flyLeft = left + width * 2 + 16 > window.innerWidth
  const top = Math.max(8, Math.min(target.y, window.innerHeight - (field ? 560 : 340)))
  const shell = 'fixed z-50 rounded-lg border border-line bg-surface py-1 text-sm shadow-2xl shadow-black/70'
  const row = 'flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition hover:bg-parchment/10 hover:text-gold'
  const kbd = 'ml-auto rounded border border-line px-1 text-[0.6rem] leading-4 text-parchment/50'
  const header = (
    <p className="truncate border-b border-line px-3 pt-1 pb-1.5 text-xs font-semibold text-parchment/60">
      {card.name || t('Face-down card')}
    </p>
  )
  const stop = {
    onClick: (e: MouseEvent) => e.stopPropagation(),
    onPointerDown: (e: MouseEvent) => e.stopPropagation(),
  }

  // Destinos ao mover: no campo a carta vai para as zonas do dono
  const destinations: [string, LucideIcon, () => void][] = [
    [zoneLabel(t, 'hand'), Hand, () => move('hand')],
    [zoneLabel(t, 'graveyard'), Tombstone, () => move('graveyard')],
    [zoneLabel(t, 'exile'), Ban, () => move('exile')],
    [t('Top of library'), ArrowUpFromLine, () => move('library', 'top')],
    [t('Bottom of library'), ArrowDownFromLine, () => move('library', 'bottom')],
    [zoneLabel(t, 'facedown'), Layers, () => move('facedown')],
  ]

  if (!field) {
    const options: [string, LucideIcon, () => void][] = [
      [t('Reveal to everyone'), Sparkles, () => send({ type: 'reveal', card: id })],
      ...(zone !== 'battlefield'
        ? ([
            [
              zoneLabel(t, 'battlefield'),
              Send,
              () => {
                move('battlefield')
                // Equipamento/aura: já pede a carta onde prender
                if (card.attach) startPick('attach', card)
              },
            ],
          ] as [string, LucideIcon, () => void][])
        : []),
      ...destinations.filter(([label]) => label !== zoneLabel(t, zone)),
    ]
    return (
      <div role="menu" style={{ left, top, width }} {...stop} className={shell}>
        {header}
        {options.map(([label, Icon, fn]) => (
          <button key={label} role="menuitem" onClick={run(fn)} className={row}>
            <Icon className="h-4 w-4 shrink-0 text-parchment/50" aria-hidden />
            {label}
          </button>
        ))}
      </div>
    )
  }

  // ---- campo ----
  const controller = field.controller ?? field.owner
  // Marcadores e força/resistência: só quem controla a carta muda
  const canEdit = controller === you
  const subPanel = (key: Exclude<Sub, null | 'note'>, children: ReactNode) =>
    sub === key && (
      <div
        role="menu"
        className={`absolute top-0 z-10 min-w-48 rounded-lg border border-line bg-surface py-1 shadow-2xl shadow-black/70 ${
          flyLeft ? 'right-full mr-1' : 'left-full ml-1'
        }`}
      >
        {children}
      </div>
    )
  const item = (label: string, Icon: LucideIcon, fn: () => void, hotkey?: string) => (
    <button key={label} role="menuitem" onClick={run(fn)} onMouseEnter={() => setSub(null)} className={row}>
      <Icon className="h-4 w-4 shrink-0 text-parchment/50" aria-hidden />
      <span className="truncate">{label}</span>
      {hotkey && <kbd className={kbd}>{hotkey}</kbd>}
    </button>
  )
  const opener = (key: Exclude<Sub, null>, label: string, Icon: LucideIcon, panel?: ReactNode) => (
    <div className="relative" onMouseEnter={() => key !== 'note' && setSub(key)}>
      <button
        role="menuitem"
        aria-haspopup={key !== 'note'}
        aria-expanded={sub === key}
        onClick={() => (key === 'note' ? setNoteOpen(!noteOpen) : setSub(sub === key ? null : key))}
        className={`${row} ${sub === key ? 'bg-parchment/10 text-gold' : ''}`}
      >
        <Icon className="h-4 w-4 shrink-0 text-parchment/50" aria-hidden />
        <span className="truncate">{label}</span>
        {key !== 'note' && <ChevronRight className="ml-auto h-3.5 w-3.5 text-parchment/40" aria-hidden />}
      </button>
      {panel}
    </div>
  )

  return (
    <div role="menu" style={{ left, top, width }} {...stop} className={shell}>
      {header}
      {/* Ações rápidas em ícones */}
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <IconButton
          size="sm"
          icon={field.tapped ? RotateCcw : RotateCw}
          label={field.tapped ? t('Untap') : t('Tap')}
          hotkey={t('Space')}
          tipSide="bottom"
          onClick={run(() => send({ type: 'tap', card: id }))}
        />
        <IconButton
          size="sm"
          icon={FlipVertical2}
          label={field.inverted ? t('Turn right side up') : t('Invert')}
          hotkey="I"
          active={field.inverted}
          tipSide="bottom"
          onClick={run(() => send({ type: 'invert', card: id }))}
        />
        <IconButton
          size="sm"
          icon={field.locked ? Lock : LockOpen}
          label={field.locked ? t('Unlock position') : t('Lock position')}
          active={field.locked}
          tipSide="bottom"
          onClick={run(() => send({ type: 'lock', card: id }))}
        />
        <IconButton
          size="sm"
          icon={Vibrate}
          label={t('Shake (call attention)')}
          hotkey="H"
          tipSide="bottom"
          onClick={run(() => send({ type: 'shake', card: id }))}
        />
        <IconButton
          size="sm"
          icon={Highlighter}
          label={field.highlight ? t('Remove highlight') : t('Highlight card')}
          hotkey="Shift+H"
          active={field.highlight}
          tipSide="bottom"
          onClick={run(() => send({ type: 'highlight', card: id }))}
        />
      </div>

      <div className="py-1">
        {canEdit &&
          opener(
            'counters',
            t('Counters'),
            CirclePlus,
            subPanel(
              'counters',
              <>
                {counterKinds(card.name).map((kind) => (
                  <div key={kind} className="flex items-center gap-2 px-3 py-1">
                    <span className="flex-1 whitespace-nowrap">{counterLabel(t, kind)}</span>
                    <button
                      aria-label={t('Remove {kind} counter', { kind: counterLabel(t, kind) })}
                      onClick={() => send({ type: 'counter', card: id, kind, delta: -1 })}
                      className="h-6 w-6 rounded border border-line hover:border-gold hover:text-gold"
                    >
                      −
                    </button>
                    <CountInput
                      value={field.counters[kind] ?? 0}
                      label={counterLabel(t, kind)}
                      onCommit={(n) =>
                        send({ type: 'counter', card: id, kind, delta: n - (field.counters[kind] ?? 0) })
                      }
                    />
                    <button
                      aria-label={t('Add {kind} counter', { kind: counterLabel(t, kind) })}
                      onClick={() => send({ type: 'counter', card: id, kind, delta: 1 })}
                      className="h-6 w-6 rounded border border-line hover:border-gold hover:text-gold"
                    >
                      +
                    </button>
                  </div>
                ))}
                <form
                  className="flex items-center gap-1.5 border-t border-line px-3 pt-2 pb-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const kind = custom.trim()
                    if (kind && customN > 0) send({ type: 'counter', card: id, kind, delta: customN })
                    setCustom('')
                    setCustomN(1)
                  }}
                >
                  <input
                    value={custom}
                    onChange={(e) => setCustom(e.target.value.slice(0, 16))}
                    placeholder={t('Other counter…')}
                    aria-label={t('Other counter…')}
                    className="min-w-0 flex-1 rounded border border-line bg-ink px-2 py-1 text-xs focus:border-gold focus:outline-none"
                  />
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={customN}
                    onChange={(e) => setCustomN(Math.max(1, Math.min(999, Math.trunc(Number(e.target.value)) || 1)))}
                    aria-label={t('How many')}
                    className="w-11 rounded border border-line bg-ink px-1 py-1 text-center text-xs focus:border-gold focus:outline-none"
                  />
                  <button className="h-6 w-6 rounded border border-line hover:border-gold hover:text-gold">+</button>
                </form>
              </>,
            ),
          )}
        {canEdit &&
          item(field.stats ? t('Remove power/toughness counter') : t('Add power/toughness counter'), Swords, () =>
            send({ type: 'toggle_stats', card: id }),
          )}
        {opener('note', field.note ? t('Edit note') : t('Add note'), StickyNote)}
        {noteOpen && (
          <form
            className="flex items-center gap-1.5 px-3 pb-2"
            onSubmit={(e) => {
              e.preventDefault()
              send({ type: 'note', card: id, text: note })
              onClose()
            }}
          >
            <input
              autoFocus
              value={note}
              maxLength={120}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('Note on the card')}
              aria-label={t('Note on the card')}
              className="min-w-0 flex-1 rounded border border-line bg-ink px-2 py-1 text-xs focus:border-gold focus:outline-none"
            />
            <button className="rounded border border-gold/50 px-2 py-1 text-xs text-gold hover:bg-gold/15">
              {t('Save')}
            </button>
          </form>
        )}
        {opener(
          'symbol',
          t('Add symbol'),
          Shapes,
          subPanel(
            'symbol',
            <div className="w-[13.5rem] p-2">
              {(
                [
                  [t('Marks'), MARK_KEYS],
                  [t('Abilities'), ABILITY_KEYS],
                ] as const
              ).map(([title, keys]) => (
                <div key={title} className="mb-2">
                  <p className="mb-1 text-[0.65rem] tracking-wide text-parchment/40 uppercase">{title}</p>
                  <div className="grid grid-cols-6 gap-1">
                    {keys.map((key) => (
                      <IconButton
                        key={key}
                        size="sm"
                        icon={SYMBOL_ICONS[key]}
                        label={symbolLabel(t, key)}
                        active={field.symbols.includes(key)}
                        onClick={() => send({ type: 'symbol', card: id, symbol: key })}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {field.symbols.length > 0 && (
                <button
                  onClick={run(() => send({ type: 'symbol', card: id, symbol: null }))}
                  className="w-full rounded border border-line py-1 text-xs text-parchment/70 hover:text-gold"
                >
                  {t('Remove all symbols')}
                </button>
              )}
            </div>,
          ),
        )}
        {opener(
          'send',
          t('Send to'),
          Send,
          subPanel(
            'send',
            destinations.map(([label, Icon, fn]) => (
              <button key={label} role="menuitem" onClick={run(fn)} className={row}>
                <Icon className="h-4 w-4 shrink-0 text-parchment/50" aria-hidden />
                <span className="whitespace-nowrap">{label}</span>
              </button>
            )),
          ),
        )}
      </div>

      <div className="border-t border-line py-1">
        {item(
          field.face_down ? t('Turn face up') : t('Turn face down'),
          EyeOff,
          () => send({ type: 'face_down', card: id }),
          'J',
        )}
        {card.back && !field.face_down && item(t('Other face'), Repeat2, () => send({ type: 'flip', card: id }), 'L')}
        {/* Quem controla dá o controle; os outros pedem (quem controla aceita ou recusa) */}
        {!canEdit && item(t('Request control'), Hand, () => send({ type: 'request_control', card: id }))}
        {canEdit &&
          opener(
            'control',
            t('Give control'),
            UserRoundCog,
            subPanel(
              'control',
              players.map((p) => (
                <button
                  key={p.id}
                  role="menuitem"
                  disabled={p.id === controller}
                  onClick={run(() => send({ type: 'control', card: id, to: p.id }))}
                  className={`${row} disabled:opacity-40`}
                >
                  <span className="whitespace-nowrap">{p.name}</span>
                  {p.id === field.owner && (
                    <span className="ml-auto text-[0.65rem] text-parchment/40">{t('owner')}</span>
                  )}
                </button>
              )),
            ),
          )}
        {item(t('Clone card (token)'), Copy, () => send({ type: 'clone', card: id }), 'K')}
        {item(t('Target…'), Crosshair, () => startPick('target', card), 'O')}
        {field.attached_to
          ? item(t('Detach'), Unlink2, () => send({ type: 'attach', card: id, to: null }))
          : item(
              card.attach === 'equipment' ? t('Equip to…') : card.attach === 'aura' ? t('Enchant…') : t('Attach to…'),
              Link2,
              () => startPick('attach', card),
            )}
        {field.commander && (
          <>
            {item(t('Cast from command zone (+2 tax)'), CirclePlus, () => send({ type: 'tax', card: id, delta: 1 }))}
            {!!target.tax && item(t('Undo commander tax'), RotateCcw, () => send({ type: 'tax', card: id, delta: -1 }))}
          </>
        )}
      </div>
    </div>
  )
}

/** Janela com as cartas de uma zona (cemitério, exílio, pilha virada), com a carta ampliada ao lado. */
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
  const { preview } = useTable()
  const [hover, setHover] = useState<TableCard | null>(null)
  useEffect(() => {
    preview(null)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose, preview])
  // Mais recente primeiro (a última carta que entrou no cemitério é a que mais importa)
  const cards = [...((player[zone as 'graveyard'] as TableCard[] | null) ?? [])].reverse()
  const shown = hover ?? cards[0] ?? null
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/75 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={zoneLabel(t, zone)}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-6xl flex-col rounded-xl border border-line bg-ink shadow-2xl shadow-black"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <h2 className="font-display text-2xl">
            {zoneLabel(t, zone)} · {player.name}
          </h2>
          <span className="rounded-full bg-parchment/10 px-2 py-0.5 text-sm text-parchment/70">{cards.length}</span>
          {cards.length > 1 && <span className="text-xs text-parchment/40">{t('Newest first')}</span>}
          <button
            onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-parchment/60 hover:text-gold"
            aria-label={t('Close')}
          >
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 gap-5 p-5">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {mine && cards.length > 0 && (
              <p className="mb-3 text-xs text-parchment/45">{t('Click a card to move it.')}</p>
            )}
            {cards.length === 0 && <p className="text-sm text-parchment/40">{t('Empty.')}</p>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
              {cards.map((c) => (
                <CardView
                  key={c.id}
                  card={c}
                  zone={zone}
                  mine={mine}
                  width={136}
                  menuOnClick
                  onHover={setHover}
                  className="transition hover:-translate-y-1 hover:ring-2 hover:ring-gold"
                />
              ))}
            </div>
          </div>
          {shown?.image && (
            <div className="hidden w-72 shrink-0 md:block">
              <img src={shown.image} alt={shown.name} className="w-full rounded-[4.5%] shadow-2xl shadow-black/80" />
              <p className="mt-2 text-center text-sm text-parchment/70">{shown.name}</p>
            </div>
          )}
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
  onCard: (
    card: { id: string; from: ZoneName; attach?: string | null; name?: string },
    e: DragEvent<HTMLDivElement>,
  ) => void
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

/**
 * Menu do grimório (clique no seu deck), no estilo do untap: comprar, moer, exilar, jogar do
 * topo ou do fundo, vidência, revelar, embaralhar, recolher. Os números (−/+) valem para a linha.
 */
export function LibraryMenu({
  x,
  y,
  player,
  onClose,
  onPeek,
  onPickDeck,
}: {
  x: number
  y: number
  player: TablePlayer
  onClose: () => void
  onPeek: (n: number | null) => void
  onPickDeck: () => void
}) {
  const t = useT()
  const { send } = useTable()
  const [sub, setSub] = useState<'more' | 'bottom' | 'to' | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [confirmScoop, setConfirmScoop] = useState(false)
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

  const width = 244
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8))
  const flyLeft = left + width * 2 + 16 > window.innerWidth
  // Abre para cima a partir do deck (ele fica embaixo da tela)
  const bottom = Math.max(8, window.innerHeight - y + 8)
  const row = 'flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-parchment/10 hover:text-gold'
  const kbd = 'rounded border border-line px-1 text-[0.6rem] leading-4 text-parchment/50'
  const empty = !player.counts.library
  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }
  const count = (key: string) => counts[key] ?? 1
  const stepper = (key: string, max = 20) => (
    <span className="ml-auto flex items-center overflow-hidden rounded border border-line text-xs">
      <button
        type="button"
        aria-label={t('Fewer')}
        onClick={() => setCounts((c) => ({ ...c, [key]: Math.max(1, count(key) - 1) }))}
        className="px-1.5 py-0.5 hover:bg-parchment/10"
      >
        −
      </button>
      <span className="w-6 text-center tabular-nums">{count(key)}</span>
      <button
        type="button"
        aria-label={t('More')}
        onClick={() => setCounts((c) => ({ ...c, [key]: Math.min(max, count(key) + 1) }))}
        className="px-1.5 py-0.5 hover:bg-parchment/10"
      >
        +
      </button>
    </span>
  )
  // Linha com número: clicar no nome executa com o número escolhido
  const numbered = (key: string, label: string, fn: (n: number) => void, hotkey?: string, disabled = empty) => (
    <div
      key={key}
      className="flex items-center gap-2 pr-2"
      onMouseEnter={() => sub && !key.includes(':') && setSub(null)}
    >
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={run(() => fn(count(key)))}
        className="flex flex-1 items-center gap-2 py-1.5 pl-3 text-left whitespace-nowrap transition enabled:hover:text-gold disabled:opacity-40"
      >
        {label}
      </button>
      {stepper(key)}
      {hotkey ? <kbd className={kbd}>{hotkey}</kbd> : <span className="w-[1.1rem]" />}
    </div>
  )
  const plain = (label: string, fn: () => void, hotkey?: string, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onMouseEnter={() => setSub(null)}
      onClick={run(fn)}
      className={`${row} disabled:opacity-40`}
    >
      <span className="truncate">{label}</span>
      {hotkey && <kbd className={`ml-auto ${kbd}`}>{hotkey}</kbd>}
    </button>
  )
  const opener = (key: 'more' | 'bottom' | 'to', label: string, panel: ReactNode) => (
    <div className="relative" onMouseEnter={() => setSub(key)}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup
        aria-expanded={sub === key}
        onClick={() => setSub(sub === key ? null : key)}
        className={`${row} ${sub === key ? 'bg-parchment/10 text-gold' : ''}`}
      >
        {label}
        <ChevronRight className="ml-auto h-3.5 w-3.5 text-parchment/40" aria-hidden />
      </button>
      {sub === key && (
        <div
          role="menu"
          className={`absolute bottom-0 z-10 min-w-56 rounded-lg border border-line bg-surface py-1 shadow-2xl shadow-black/70 ${
            flyLeft ? 'right-full mr-1' : 'left-full ml-1'
          }`}
        >
          {panel}
        </div>
      )}
    </div>
  )
  const destinations = (from: 'top' | 'bottom') => {
    const list: [DrawTarget, string, string?][] = [
      ['facedown', t('Facedown pile'), from === 'top' ? 'P' : undefined],
      ['exile', t('Exile'), from === 'top' ? 'S' : undefined],
      ['graveyard', t('Graveyard'), from === 'top' ? 'D' : undefined],
      ['battlefield_down', t('Play face down'), from === 'top' ? '⇧P' : undefined],
      ['battlefield', t('Play'), from === 'top' ? 'Z' : undefined],
    ]
    if (from === 'bottom') list.push(['hand', t('Hand')])
    return list.map(([to, label, key]) =>
      numbered(`${from}:${to}`, label, (n) => send({ type: 'draw_to', n, to, from }), key),
    )
  }
  const line = <div className="my-1 border-t border-line" />

  return (
    <div
      role="menu"
      aria-label={t('Library')}
      style={{ left, bottom, width }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-50 rounded-lg border border-line bg-surface py-1 text-sm shadow-2xl shadow-black/70"
    >
      <p className="border-b border-line px-3 pt-1 pb-1.5 text-xs font-semibold text-parchment/60">
        {t('Library')} · {player.counts.library}
      </p>
      <button
        type="button"
        role="menuitem"
        onMouseEnter={() => setSub(null)}
        onClick={() => {
          if (!confirmScoop) return setConfirmScoop(true)
          send({ type: 'scoop' })
          onClose()
        }}
        className={`${row} ${confirmScoop ? 'text-red-300' : ''}`}
      >
        {confirmScoop ? t('Click again: all your cards go back to the library') : t('Scoop deck')}
      </button>
      {plain(t('Change deck'), onPickDeck)}
      {line}
      {opener(
        'more',
        t('More…'),
        <>
          {plain(t('Show last draw'), () => send({ type: 'reveal_last_draw' }), undefined, !player.hand?.length)}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={player.top_revealed}
            onClick={run(() => send({ type: 'top_revealed' }))}
            className={row}
          >
            {t('Keep top revealed')}
            <span className={`ml-auto text-xs ${player.top_revealed ? 'text-gold' : 'text-parchment/40'}`}>
              {player.top_revealed ? t('On') : t('Off')}
            </span>
          </button>
          {plain(t('Expand deck'), () => onPeek(null), undefined, empty)}
        </>,
      )}
      {plain(t('Flip top'), () => send({ type: 'reveal_top', n: 1 }), 'T', empty)}
      {numbered('walk', t('Reveal from top'), (n) => send({ type: 'reveal_top', n }))}
      {numbered('scry', t('Scry'), (n) => onPeek(n), 'G')}
      {plain(t('Find card'), () => onPeek(null), 'F', empty)}
      {line}
      {plain(t('Shuffle'), () => send({ type: 'shuffle' }), 'V', empty)}
      {line}
      {opener('bottom', t('Bottom draw'), destinations('bottom'))}
      {opener('to', t('Draw to'), destinations('top'))}
      {numbered('draw', t('Draw'), (n) => send({ type: 'draw', n }), 'C')}
    </div>
  )
}
