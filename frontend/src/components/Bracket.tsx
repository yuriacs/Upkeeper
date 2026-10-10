import { BRACKET_HINTS, BRACKET_NAMES, BRACKETS_ARTICLE_URL, SPELLBOOK_URL } from '../lib/brackets'
import type { BracketDetails } from '../lib/types'

// Intensidade cresce com o bracket (uma só cor: o número e o nome dizem qual é)
const STYLES: Record<number, string> = {
  2: 'border-parchment/30 text-parchment/80',
  3: 'border-gold/60 text-gold',
  4: 'border-gold bg-gold text-ink',
}

/** Selo compacto "B3" (com o nome no title). */
export function BracketBadge({ bracket, className = '' }: { bracket?: number | null; className?: string }) {
  if (!bracket) return null
  return (
    <span
      title={`Bracket ${bracket} · ${BRACKET_NAMES[bracket]} (estimado)`}
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-px text-[10px] font-semibold tabular-nums ${STYLES[bracket] ?? STYLES[2]} ${className}`}
    >
      B{bracket}
    </span>
  )
}

function Reason({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gold/70">
        {title} <span className="text-parchment/40">({items.length})</span>
      </p>
      <p className="text-sm text-parchment/80">{items.join(' · ')}</p>
    </div>
  )
}

/** Bloco da página do deck: bracket estimado e o porquê. */
export function BracketPanel({ bracket, details }: { bracket?: number | null; details?: BracketDetails }) {
  return (
    <section className="space-y-3 rounded-xl border border-gold/15 bg-surface/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl text-gold">Bracket</h2>
        {bracket ? (
          <>
            <span className={`rounded-lg border px-2.5 py-0.5 font-display text-lg ${STYLES[bracket] ?? STYLES[2]}`}>
              {bracket} · {BRACKET_NAMES[bracket]}
            </span>
            <span className="text-xs text-parchment/45">estimado pela lista</span>
          </>
        ) : (
          <span className="text-sm text-parchment/50">Ainda não calculado. Volte daqui a pouco.</span>
        )}
      </div>

      {bracket && <p className="text-sm text-parchment/65">{BRACKET_HINTS[bracket]}</p>}
      {bracket === 4 && details?.single_trigger && (
        <p className="rounded-lg border border-gold/25 bg-gold/5 px-3 py-2 text-sm text-parchment/80">
          Está no 4 por causa de <strong className="text-gold">uma carta só</strong>: {details.single_trigger}. Pelas
          regras oficiais, destruição de terrenos em massa já leva ao bracket 4, mas muitos grupos combinam de não
          usá-la e jogam o deck como 3.
        </p>
      )}

      {details && (
        <div className="space-y-2">
          <Reason title="Game Changers" items={details.game_changers ?? []} />
          <Reason title="Combos de 2 cartas" items={(details.two_card_combos ?? []).map((pair) => pair.join(' + '))} />
          <Reason title="Destruição de terrenos em massa" items={details.mass_land_denial ?? []} />
          <Reason title="Turnos extras" items={details.extra_turns ?? []} />
          {!!details.banned?.length && (
            <p className="text-sm text-amber-300">Atenção: banida(s) no Commander — {details.banned.join(', ')}.</p>
          )}
        </div>
      )}

      <p className="text-xs text-parchment/40">
        É o bracket <em>mínimo</em> pelas cartas; a intenção de quem montou também conta, então combinem na mesa.
        Classificação das cartas pelo{' '}
        <a href={SPELLBOOK_URL} target="_blank" rel="noreferrer" className="underline hover:text-gold">
          Commander Spellbook
        </a>
        , regras do{' '}
        <a href={BRACKETS_ARTICLE_URL} target="_blank" rel="noreferrer" className="underline hover:text-gold">
          sistema oficial de brackets
        </a>
        .
      </p>
    </section>
  )
}
