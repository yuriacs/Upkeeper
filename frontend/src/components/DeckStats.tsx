import { useMemo } from 'react'
import { COLOR_NAMES } from '../lib/colors'
import type { DeckDetail } from '../lib/types'

const CURVE_BUCKETS = ['0', '1', '2', '3', '4', '5', '6', '7+']
const PIP_COLORS = ['W', 'U', 'B', 'R', 'G'] as const

function computeStats(deck: DeckDetail) {
  const all = [...deck.commanders, ...deck.sections.flatMap((s) => s.cards)]
  const nonLand = all.filter((dc) => dc.card.category !== 'land')

  const curve = CURVE_BUCKETS.map(() => 0)
  let cmcSum = 0
  let spells = 0
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }

  for (const { quantity, card } of nonLand) {
    const cmc = Math.floor(Number(card.cmc) || 0)
    curve[Math.min(cmc, 7)] += quantity
    cmcSum += cmc * quantity
    spells += quantity
    // Só a frente das cartas de duas faces; híbridos contam para as duas cores
    const front = card.mana_cost.split('//')[0]
    for (const [, symbol] of front.matchAll(/\{([^}]+)\}/g)) {
      for (const c of PIP_COLORS) if (symbol.toUpperCase().includes(c)) pips[c] += quantity
    }
  }

  const lands = deck.sections.find((s) => s.key === 'land')?.count ?? 0
  return {
    curve,
    avgCmc: spells ? cmcSum / spells : 0,
    spells,
    lands,
    pips: PIP_COLORS.map((c) => ({ color: c, count: pips[c] })).filter((p) => p.count > 0),
    types: deck.sections.map((s) => ({ key: s.key, label: s.label, count: s.count })),
  }
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-gold/15 bg-surface/60 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gold/70">{title}</h3>
      {children}
    </section>
  )
}

/** Barras horizontais: rótulo à esquerda, valor à direita, uma só cor (a identidade vem do rótulo). */
function HBars({ rows }: { rows: { key: string; label: React.ReactNode; count: number; tip: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="group grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-sm" title={r.tip}>
          <span className="truncate text-parchment/75">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-r-[4px] bg-parchment/5">
            <span
              className="block h-full rounded-r-[4px] bg-gold/80 transition group-hover:bg-gold"
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums text-parchment/70">{r.count}</span>
        </li>
      ))}
    </ul>
  )
}

export default function DeckStats({ deck }: { deck: DeckDetail }) {
  const s = useMemo(() => computeStats(deck), [deck])
  const max = Math.max(1, ...s.curve)
  const pipTotal = s.pips.reduce((n, p) => n + p.count, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between border-b border-gold/15 pb-3">
        <h2 className="font-display text-xl text-gold">Estatísticas</h2>
        <p className="text-sm text-parchment/60">
          Mana média <strong className="tabular-nums text-parchment">{s.avgCmc.toFixed(2).replace('.', ',')}</strong>
          <span className="text-parchment/30"> · </span>
          {s.lands} terrenos
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Curva de mana">
          <figure aria-label={`Curva de mana sem terrenos: ${s.curve.map((n, i) => `${n} com valor ${CURVE_BUCKETS[i]}`).join(', ')}`}>
            <div className="flex h-36 items-end gap-1.5" aria-hidden>
              {s.curve.map((n, i) => (
                <div key={i} className="group relative flex h-full flex-1 flex-col justify-end">
                  <span className="mb-1 text-center text-xs tabular-nums text-parchment/60">{n || ''}</span>
                  <div
                    className="rounded-t-[4px] bg-gold/80 transition group-hover:bg-gold"
                    style={{ height: `${(n / max) * 100}%`, minHeight: n ? 2 : 0 }}
                  />
                  <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-xs text-parchment shadow-lg group-hover:block">
                    {n} {n === 1 ? 'carta' : 'cartas'} de valor {CURVE_BUCKETS[i]}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex gap-1.5 border-t border-parchment/15 pt-1" aria-hidden>
              {CURVE_BUCKETS.map((b) => (
                <span key={b} className="flex-1 text-center text-xs text-parchment/50">
                  {b}
                </span>
              ))}
            </div>
            <figcaption className="mt-2 text-xs text-parchment/40">{s.spells} cartas que não são terreno</figcaption>
          </figure>
        </Panel>

        <Panel title="Símbolos de mana">
          {s.pips.length ? (
            <HBars
              rows={s.pips.map((p) => ({
                key: p.color,
                count: p.count,
                tip: `${p.count} símbolos ${COLOR_NAMES[p.color].toLowerCase()} (${Math.round((p.count / pipTotal) * 100)}%)`,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <i className={`ms ms-${p.color.toLowerCase()} ms-cost ms-shadow`} aria-hidden />
                    {COLOR_NAMES[p.color]}
                  </span>
                ),
              }))}
            />
          ) : (
            <p className="text-sm text-parchment/50">Sem símbolos coloridos: o deck é incolor.</p>
          )}
          <p className="text-xs text-parchment/40">Somando os custos de mana das cartas.</p>
        </Panel>

        <Panel title="Tipos de carta">
          <HBars rows={s.types.map((t) => ({ key: t.key, label: t.label, count: t.count, tip: `${t.count} ${t.label.toLowerCase()}` }))} />
        </Panel>
      </div>
    </div>
  )
}
