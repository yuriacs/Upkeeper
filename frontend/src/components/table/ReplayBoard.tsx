/*
 * Campo de um jogador ao rever a partida (pages/ReplayPage): o mesmo desenho da mesa, com as cartas
 * nas posições em que estavam, a zona do comandante no canto e o campo dos oponentes espelhado.
 * Só para olhar: passar o mouse mostra a carta grande; as cartas que mudaram na ação brilham.
 */
import { Library, Hand, Skull, Ban, Droplet } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { cardImage } from '../../lib/cardImage'
import { useI18n } from '../../lib/i18n'
import type { ReplayBoard as Board, ReplayCard, ReplayPlayer } from '../../lib/replay'
import { LogoMark } from '../Logo'
import { CARD_RATIO } from './tableUtils'

// Proporções do campo da mesa (pages/TablePage: REF_BOARD e BOARD_CARD.large)
const REF = { w: 1270, h: 340, card: 104 }
const CMD_PAD = 6
const CMD_LABEL = 14
const SEAT_BORDER = ['border-l-gold', 'border-l-sky-400', 'border-l-emerald-400', 'border-l-violet-400']

export function ReplayBoard({
  board,
  player,
  facing,
  active,
  changed,
  lit,
  onHover,
}: {
  board: Board
  player?: ReplayPlayer
  /** O seu campo (embaixo, comandante em cima à esquerda); os oponentes aparecem espelhados */
  facing: boolean
  /** É o turno deste jogador */
  active: boolean
  /** Vida ou contagens mudaram nesta ação */
  changed: boolean
  /** Cartas que entraram ou mudaram nesta ação */
  lit: Set<string>
  onHover: (card: ReplayCard | null) => void
}) {
  const { t } = useI18n()
  const area = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = area.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const w = Math.max(18, Math.round((width * REF.card) / REF.w))
  const h = w * CARD_RATIO
  const field = board.field
  const placed = field.every((c) => c.x !== undefined && c.id) // partidas antigas não têm posição
  const ids = new Set(field.map((c) => c.id))
  const attached = new Map<string, ReplayCard[]>()
  for (const c of field)
    if (c.attached_to && ids.has(c.attached_to))
      attached.set(c.attached_to, [...(attached.get(c.attached_to) ?? []), c])
  const hosts = field.filter((c) => !c.attached_to || !ids.has(c.attached_to))
  const cmdSlots = Math.max(1, ...field.filter((c) => c.slot != null).map((c) => (c.slot ?? 0) + 1))
  const cmdBoxW = cmdSlots * w + (cmdSlots - 1) * CMD_PAD + CMD_PAD * 2
  const deck = player?.deck

  const position = (host: ReplayCard, k: number) => {
    // Presas: atrás da carta, um pouco para a esquerda e para cima (como na mesa)
    const dx = -k * w * 0.28
    const dy = k * h * 0.12 * (facing ? -1 : 1)
    if (host.slot != null) {
      const left = Math.max(0, 4 + CMD_PAD + host.slot * (w + CMD_PAD) + dx)
      const top = 4 + CMD_LABEL + CMD_PAD
      return {
        left,
        top: facing ? `${top + dy}px` : `calc(100% - ${top + h - dy}px)`,
      }
    }
    const x = host.x ?? 0
    const y = host.y ?? 0
    return {
      left: `clamp(0px, calc((100% - ${w}px) * ${x} + ${dx}px), calc(100% - ${w}px))`,
      top: `clamp(0px, calc((100% - ${h}px) * ${facing ? y : 1 - y} + ${dy}px), calc(100% - ${h}px))`,
    }
  }
  const card = (c: ReplayCard, host: ReplayCard, k: number) => (
    <div key={c.id} className="absolute hover:z-30" style={{ ...position(host, k), zIndex: k ? 10 - k : undefined }}>
      <FieldCard card={c} width={w} lit={!!c.id && lit.has(c.id)} onHover={onHover} />
    </div>
  )

  return (
    <div
      className={`overflow-hidden rounded-lg border border-l-4 bg-surface/60 ${SEAT_BORDER[(board.seat - 1) % 4]} ${
        active ? 'border-gold/50' : 'border-line'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
        <span className="truncate font-semibold">{player?.name ?? '?'}</span>
        {deck && (
          <Link
            to={deck.kind === 'precon' ? `/deck/${deck.ref}` : `/user-deck/${deck.ref}`}
            className="min-w-0 truncate text-xs text-parchment/50 hover:text-gold"
          >
            {deck.name}
          </Link>
        )}
        <span className="flex items-center gap-2 text-xs text-parchment/60 tabular-nums">
          <Count icon={Hand} label={t('Hand: {n}', { n: board.counts.hand })} n={board.counts.hand} />
          <Count icon={Library} label={t('Library: {n}', { n: board.counts.library })} n={board.counts.library} />
          <Count icon={Skull} label={t('Graveyard: {n}', { n: board.counts.graveyard })} n={board.counts.graveyard} />
          <Count icon={Ban} label={t('Exile: {n}', { n: board.counts.exile })} n={board.counts.exile} />
          {board.poison > 0 && <Count icon={Droplet} label={t('Poison: {n}', { n: board.poison })} n={board.poison} />}
        </span>
        <span
          className={`font-display ml-auto rounded px-1.5 text-2xl tabular-nums transition-colors ${
            changed ? 'bg-gold/15 text-gold' : 'text-parchment'
          }`}
        >
          {board.life}
        </span>
      </div>
      <div
        ref={area}
        className="relative border-t border-line/60 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.03),transparent_70%)]"
        style={{ aspectRatio: `${REF.w} / ${REF.h}` }}
      >
        {width > 0 &&
          (placed ? (
            <>
              <div
                className="absolute left-1 rounded-md border border-dashed border-gold/25"
                style={{
                  width: cmdBoxW,
                  height: h + CMD_PAD * 2 + CMD_LABEL,
                  ...(facing ? { top: 4 } : { bottom: 4 }),
                }}
              >
                {w >= 50 && ( // carta miúda (celular): o rótulo não cabe
                  <span className="block px-1.5 text-[0.55rem] leading-[14px] tracking-wide text-gold/50 uppercase">
                    {t('Commander')}
                  </span>
                )}
              </div>
              {hosts.map((c) => (
                <div key={c.id}>
                  {(attached.get(c.id ?? '') ?? []).map((a, k) => card(a, c, k + 1))}
                  {card(c, c, 0)}
                </div>
              ))}
            </>
          ) : (
            <ul className="flex h-full flex-wrap content-start gap-1.5 overflow-y-auto p-2">
              {field.map((c, i) => (
                <li key={i}>
                  <FieldCard card={c} width={w} lit={false} onHover={onHover} />
                </li>
              ))}
            </ul>
          ))}
        {width > 0 && field.length === 0 && (
          <p className="absolute inset-0 grid place-items-center text-xs text-parchment/30">
            {t('Empty battlefield.')}
          </p>
        )}
      </div>
    </div>
  )
}

function Count({ icon: Icon, label, n }: { icon: typeof Hand; label: string; n: number }) {
  return (
    <span title={label} aria-label={label} className="flex items-center gap-0.5">
      <Icon className="h-3 w-3" aria-hidden />
      {n}
    </span>
  )
}

/** Uma carta do campo: virada, marcadores e força/resistência por cima, brilho se mudou nesta ação */
function FieldCard({
  card,
  width,
  lit,
  onHover,
}: {
  card: ReplayCard
  width: number
  lit: boolean
  onHover: (card: ReplayCard | null) => void
}) {
  const { t } = useI18n()
  const small = width < 60
  const counters = Object.entries(card.counters ?? {}).filter(([, n]) => n)
  const pill = `rounded bg-ink/90 font-bold leading-none ring-1 ring-gold/60 ${small ? 'px-0.5 py-px text-[0.5rem]' : 'px-1 py-0.5 text-[0.62rem]'}`
  const plus = card.counters?.['+1/+1'] ?? 0
  return (
    <div
      onMouseEnter={() => onHover(card)}
      onMouseLeave={() => onHover(null)}
      title={card.face_down ? t('a face-down card') : card.name}
      style={{ width, height: width * CARD_RATIO }}
      className={`relative rounded-[6%] bg-surface transition-[transform,box-shadow] duration-300 ${card.tapped ? 'rotate-90' : ''} ${
        lit ? 'z-20 shadow-[0_0_0_2px_#facc15,0_0_16px_rgba(250,204,21,0.65)]' : 'shadow-md shadow-black/50'
      }`}
    >
      {card.face_down || !card.image ? (
        <div className="grid h-full w-full place-items-center rounded-[6%] border border-gold/40 bg-[radial-gradient(circle_at_50%_40%,#2a1810,#0b0b0d_70%)]">
          <LogoMark className="h-1/4 w-1/4 opacity-70" />
        </div>
      ) : (
        <img
          src={cardImage(card.image, width)}
          alt={card.name}
          draggable={false}
          loading="lazy"
          decoding="async"
          className="h-full w-full rounded-[6%] object-cover"
        />
      )}
      {counters.length > 0 && (
        <div className="absolute top-1 left-1 flex flex-col items-start gap-0.5">
          {counters.map(([name, n]) => (
            <span key={name} className={pill} title={`${name}: ${n}`}>
              {name === '+1/+1' || name === 'Loyalty' ? n : `${name.slice(0, 3)} ${n}`}
            </span>
          ))}
        </div>
      )}
      {card.stats && (
        <span className={`absolute right-1 bottom-1 ${pill}`}>
          {card.stats.p + plus}/{card.stats.t + plus}
        </span>
      )}
    </div>
  )
}
