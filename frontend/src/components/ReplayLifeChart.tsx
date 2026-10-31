import { useMemo, useState } from 'react'
import { useT } from '../lib/i18n'
import type { Replay } from '../lib/replay'

// Cor de cada lugar, a mesma família da mesa (SEAT_TEXT), um tom abaixo para as linhas lerem bem
// no fundo escuro (paleta conferida: claridade, daltonismo e contraste)
const SEAT_LINE = ['var(--color-gold)', '#0284c7', '#059669', '#8b5cf6']
const W = 280
const H = 112
const PAD = { top: 8, right: 8, bottom: 16, left: 24 }

/**
 * Vida de cada jogador no fim de cada turno (Rever). A linha tracejada marca o turno que o rever
 * está mostrando; passar o mouse mostra a vida de todos naquele turno, e clicar vai para ele.
 */
export default function ReplayLifeChart({
  replay,
  turn,
  onPick,
}: {
  replay: Replay
  turn: number
  onPick: (turn: number) => void
}) {
  const t = useT()
  const [hover, setHover] = useState<number | null>(null)
  const seats = useMemo(() => [...replay.players].sort((a, b) => a.seat - b.seat), [replay.players])
  const lives = useMemo(
    () =>
      replay.turns.map((tn) => Object.fromEntries(tn.boards.map((b) => [b.seat, b.life] as const)) as Record<number, number>),
    [replay.turns],
  )
  const n = lives.length
  if (n < 2) return null
  const all = lives.flatMap((l) => Object.values(l))
  // Escala só na faixa da partida (o 0 entra quando alguém chegou nele), com um respiro
  const top = Math.max(...all)
  const low = Math.min(...all)
  const bottom = low <= 0 ? Math.min(0, low) : Math.max(0, low - Math.ceil((top - low) * 0.1) - 1)
  const x = (i: number) => PAD.left + (i / (n - 1)) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + ((top - v) / (top - bottom || 1)) * (H - PAD.top - PAD.bottom)
  const shown = hover ?? turn
  const pick = (clientX: number, box: DOMRect) => {
    const rel = ((clientX - box.left) / box.width) * W
    return Math.max(0, Math.min(n - 1, Math.round(((rel - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1))))
  }
  const ticks = [...new Set([top, bottom, ...(bottom < 0 ? [0] : [])])]

  return (
    <section className="rounded-lg border border-line bg-surface px-3 py-2">
      <h2 className="text-xs font-semibold tracking-wide text-parchment/60 uppercase">{t('Life over the game')}</h2>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 w-full cursor-pointer touch-none select-none"
        role="img"
        aria-label={t('Life of each player at the end of each turn')}
        onPointerMove={(e) => setHover(pick(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => onPick(pick(e.clientX, e.currentTarget.getBoundingClientRect()))}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-parchment/10" />
            <text x={PAD.left - 4} y={y(v) + 3} textAnchor="end" className="fill-parchment/45 text-[9px] tabular-nums">
              {v}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 3} className="fill-parchment/45 text-[9px]">
          {t('Turn {n}', { n: replay.turns[0].turn })}
        </text>
        <text x={W - PAD.right} y={H - 3} textAnchor="end" className="fill-parchment/45 text-[9px]">
          {t('Turn {n}', { n: replay.turns[n - 1].turn })}
        </text>
        <line
          x1={x(shown)}
          x2={x(shown)}
          y1={PAD.top}
          y2={H - PAD.bottom}
          stroke="currentColor"
          strokeDasharray={hover === null ? '3 3' : undefined}
          className="text-parchment/40"
        />
        {seats.map((p) => {
          const points = lives.map((l, i) => (l[p.seat] === undefined ? null : `${x(i)},${y(l[p.seat])}`))
          const color = SEAT_LINE[(p.seat - 1) % SEAT_LINE.length]
          const at = lives[shown][p.seat]
          return (
            <g key={p.seat}>
              <polyline
                points={points.filter(Boolean).join(' ')}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {at !== undefined && (
                <circle cx={x(shown)} cy={y(at)} r={4} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
              )}
            </g>
          )
        })}
      </svg>
      {/* Legenda com a vida no turno marcado (ou sob o mouse) */}
      <p className="mb-0.5 text-[0.68rem] text-parchment/50">
        {t('End of turn {n}', { n: replay.turns[shown].turn })}
        {replay.turns[shown].player ? ` · ${replay.turns[shown].player}` : ''}
      </p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        {seats.map((p) => (
          <li key={p.seat} className="flex min-w-0 items-center gap-1.5">
            <span
              className="h-0.5 w-3 shrink-0 rounded-full"
              style={{ background: SEAT_LINE[(p.seat - 1) % SEAT_LINE.length] }}
              aria-hidden
            />
            <span className="truncate text-parchment/70">{p.name}</span>
            <span className="ml-auto font-semibold text-parchment tabular-nums">{lives[shown][p.seat] ?? '—'}</span>
          </li>
        ))}
      </ul>
      {/* Para leitor de tela: a mesma informação em tabela */}
      <table className="sr-only">
        <caption>{t('Life of each player at the end of each turn')}</caption>
        <thead>
          <tr>
            <th>{t('Turn')}</th>
            {seats.map((p) => (
              <th key={p.seat}>{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {replay.turns.map((tn, i) => (
            <tr key={i}>
              <td>{tn.turn}</td>
              {seats.map((p) => (
                <td key={p.seat}>{lives[i][p.seat] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
