import { useEffect, useState, type MouseEvent } from 'react'
import { Coffee, SkipForward, Sparkles, Timer, Flag } from 'lucide-react'
import { fmtClock } from '../../lib/duration'
import { helperByName, helperLabel } from './helpers'
import { IconButton } from './TableKit'
import { useTable } from './tableUtils'
import { MANA_COLORS, type ManaColor, type TablePlayer } from '../../hooks/useTableSocket'
import { COLOR_NAMES } from '../../lib/colors'
import { useT } from '../../lib/i18n'
import { reportImage } from '../../lib/moderation'
import { SEAT_BORDER, SEAT_ICONS, SEAT_RING, SEAT_TEXT } from './tableLook'

/** Há quanto tempo o turno atual começou, contando de segundo em segundo */
export function TurnClock({ since }: { since: number }) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span title={t('Time on this turn')} className="flex shrink-0 items-center gap-1 text-parchment/55 tabular-nums">
      <Timer className="h-3.5 w-3.5" aria-hidden />
      {fmtClock(now / 1000 - since)}
    </span>
  )
}

/** Foto do jogador (ou o ícone da cadeira) num círculo com a cor da cadeira. Clicar mostra as zonas dele. */
export function Avatar({
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
        player?.frame ? 'founder-frame' : ''
      } ${
        selected ? 'ring-offset-2 ring-offset-ink' : ''
      } ${player ? `hover:brightness-125 ${player.online ? '' : 'opacity-40'}` : 'opacity-25'} ${className}`}
    >
      {player?.avatar ? (
        <img src={player.avatar} alt={player.name} className="h-full w-full rounded-full object-cover" />
      ) : player ? (
        <SeatIcon className={`h-[55%] w-[55%] ${SEAT_TEXT[seat - 1]}`} aria-label={player.name} />
      ) : (
        <span className={SEAT_TEXT[seat - 1]}>·</span>
      )}
    </button>
  )
}

/** Denunciar o fundo do campo ou o sleeve de outro jogador (vai para a fila do admin). Discreto, no canto. */
export function PerkImageReport({ url, label }: { url: string; label: string }) {
  const t = useT()
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      disabled={done}
      onClick={async (e) => {
        e.stopPropagation()
        if (await reportImage(url, t)) setDone(true)
      }}
      title={done ? t('Reported') : label}
      aria-label={label}
      className="rounded p-0.5 text-parchment/25 transition hover:text-red-300 disabled:text-parchment/15"
    >
      <Flag className="h-3 w-3" aria-hidden />
    </button>
  )
}

export function PlayerPanel({
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
    // Clicar em qualquer parte do card (fora dos botões) mostra as zonas do jogador e traz o campo
    // dele para o foco, em qualquer visão; com o teclado, a foto continua sendo o botão
    <div
      onClick={(e) => {
        if (player && !(e.target as HTMLElement).closest('button, a, input, select, textarea')) onSelect()
      }}
      className={`rounded-lg border border-l-4 bg-surface p-2.5 transition ${SEAT_BORDER[seat - 1]} ${selected ? 'border-parchment/30' : 'border-line'} ${player ? 'cursor-pointer hover:bg-parchment/[0.04]' : ''}`}
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
export function ManaBox({ player, mine, compact }: { player: TablePlayer; mine: boolean; compact: boolean }) {
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
