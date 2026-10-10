import { useState } from 'react'
import { CATEGORIES, FACTOR_LABELS, fmtPower } from '../lib/analysis'
import { BRACKET_NAMES } from '../lib/brackets'
import type { DeckAnalysis as Analysis } from '../lib/types'

function Meter({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-parchment/10" aria-hidden>
      <div className="h-full rounded-full bg-gold" style={{ width: `${(value / 10) * 100}%` }} />
    </div>
  )
}

function PowerCard({ analysis, bracket }: { analysis: Analysis; bracket?: number | null }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="space-y-4 rounded-xl border border-gold/15 bg-surface/60 p-5">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-parchment/50">Nível de poder</p>
        <p className="text-sm font-semibold text-gold/90">{analysis.label}</p>
        <p className="font-display text-6xl tabular-nums text-gold">{fmtPower(analysis.power)}</p>
        <p className="text-xs text-parchment/45">de 10 · estimado</p>
      </div>
      <Meter value={analysis.power} />
      {bracket && (
        <p className="text-center text-sm text-parchment/70">
          Bracket {bracket} · {BRACKET_NAMES[bracket]}
        </p>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-center text-xs text-parchment/50 underline-offset-2 hover:text-gold hover:underline"
      >
        {open ? 'Esconder o cálculo' : 'Como chegamos nesse número'}
      </button>
      {open && (
        <div className="space-y-2 text-sm">
          <p className="text-xs text-parchment/50">
            Base {fmtPower(analysis.base)}, mais os pontos de cada fator
            {analysis.bracket_bonus > 0 && ` e ${fmtPower(analysis.bracket_bonus)} pelo bracket`}:
          </p>
          <ul className="space-y-1.5">
            {analysis.factors.map((f) => (
              <li key={f.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3">
                <span>
                  {FACTOR_LABELS[f.key]?.label ?? f.key}
                  <span className="block text-[11px] text-parchment/45">{FACTOR_LABELS[f.key]?.unit(f.value)}</span>
                </span>
                <span className="tabular-nums text-gold">+{fmtPower(f.points)}</span>
                <span className="col-span-2 h-1 overflow-hidden rounded-full bg-parchment/10">
                  <span className="block h-full rounded-full bg-gold/70" style={{ width: `${f.score * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Category({
  label,
  hint,
  typical,
  count,
  cards,
  onCard,
}: {
  label: string
  hint: string
  typical?: [number, number | null]
  count: number
  cards: string[]
  onCard: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = typical ? (typical[1] === null ? `comum: ${typical[0]}+` : `comum: ${typical[0]} a ${typical[1]}`) : null
  const below = typical && count < typical[0]
  return (
    <li className="rounded-lg border border-gold/10 bg-ink/40">
      <button
        onClick={() => cards.length && setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!cards.length}
        title={hint}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default"
      >
        <span className="w-8 text-right font-display text-xl tabular-nums text-gold">{count}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{label}</span>
          {ref && (
            <span className={`block text-[11px] ${below ? 'text-amber-300/80' : 'text-parchment/40'}`}>{ref}</span>
          )}
        </span>
        {cards.length > 0 && <span className="text-xs text-parchment/40">{open ? '▲' : '▼'}</span>}
      </button>
      {open && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t border-gold/10 px-3 py-2.5 text-sm">
          {cards.map((name, i) => (
            <li key={`${name}-${i}`}>
              <button onClick={() => onCard(name)} className="text-gold/90 underline-offset-2 hover:underline">
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** Nível de poder + o que tem no deck. Clicar numa carta abre a imagem (via onCard). */
export default function DeckAnalysis({
  analysis,
  bracket,
  onCard,
}: {
  analysis: Analysis
  bracket?: number | null
  onCard: (name: string) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between border-b border-gold/15 pb-3">
        <h2 className="font-display text-xl text-gold">Análise</h2>
        <p className="text-sm text-parchment/60">
          {analysis.lands} terrenos <span className="text-parchment/30">·</span> mana média{' '}
          {analysis.avg_cmc.toFixed(2).replace('.', ',')}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        <PowerCard analysis={analysis} bracket={bracket} />
        <ul className="grid content-start items-start gap-2 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <Category
              key={c.key}
              label={c.label}
              hint={c.hint}
              typical={c.typical}
              count={analysis.categories[c.key]?.count ?? 0}
              cards={analysis.categories[c.key]?.cards ?? []}
              onCard={onCard}
            />
          ))}
        </ul>
      </div>
      <p className="text-xs text-parchment/40">
        Estimativa pela lista de cartas (funções das cartas pelo Scryfall). Não substitui a conversa antes do jogo: o
        quanto o deck é afiado também depende de como ele é pilotado.
      </p>
    </div>
  )
}
