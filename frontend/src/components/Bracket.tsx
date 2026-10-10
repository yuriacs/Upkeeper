import { fmtPower } from '../lib/analysis'
import { BRACKET_HINTS, BRACKET_NAMES, BRACKETS_ARTICLE_URL, SPELLBOOK_URL } from '../lib/brackets'
import { useI18n, useT } from '../lib/i18n'
import type { BracketDetails } from '../lib/types'

// Intensidade cresce com o bracket (uma só cor: o número e o nome dizem qual é)
const STYLES: Record<number, string> = {
  2: 'border-parchment/30 text-parchment/80',
  3: 'border-gold/60 text-gold',
  4: 'border-gold bg-gold text-ink',
}

/** Nível de poder em texto curto (4,6), com o significado no title. */
export function PowerBadge({ power, className = '' }: { power?: number | null; className?: string }) {
  const { t, locale } = useI18n()
  if (power === null || power === undefined) return null
  return (
    <span
      title={t('Estimated power level (1 to 10)')}
      className={`inline-flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums text-parchment/60 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="size-[1.1em] text-gold/80" fill="currentColor" aria-hidden>
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
      </svg>
      {fmtPower(power, locale)}
    </span>
  )
}

/** Selo compacto "B3" (com o nome no title). */
export function BracketBadge({ bracket, className = '' }: { bracket?: number | null; className?: string }) {
  const t = useT()
  if (!bracket) return null
  return (
    <span
      title={t('Bracket {n} · {name} (estimated)', { n: bracket, name: BRACKET_NAMES[bracket] })}
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
  const t = useT()
  return (
    <section className="space-y-3 rounded-xl border border-gold/15 bg-surface/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl text-gold">Bracket</h2>
        {bracket ? (
          <>
            <span className={`rounded-lg border px-2.5 py-0.5 font-display text-lg ${STYLES[bracket] ?? STYLES[2]}`}>
              {bracket} · {BRACKET_NAMES[bracket]}
            </span>
            <span className="text-xs text-parchment/45">{t('estimated from the list')}</span>
          </>
        ) : (
          <span className="text-sm text-parchment/50">{t('Not calculated yet. Check back in a bit.')}</span>
        )}
      </div>

      {bracket && <p className="text-sm text-parchment/65">{BRACKET_HINTS[bracket] && t(BRACKET_HINTS[bracket])}</p>}
      {bracket === 4 && details?.single_trigger && (
        <p className="rounded-lg border border-gold/25 bg-gold/5 px-3 py-2 text-sm text-parchment/80">
          {t("It's at 4 because of")} <strong className="text-gold">{t('a single card')}</strong>:{' '}
          {details.single_trigger}.{' '}
          {t(
            'Under the official rules, mass land denial alone puts a deck at bracket 4, but many groups agree not to use it and play the deck as a 3.',
          )}
        </p>
      )}

      {details && (
        <div className="space-y-2">
          <Reason title="Game Changers" items={details.game_changers ?? []} />
          <Reason title={t('2-card combos')} items={(details.two_card_combos ?? []).map((pair) => pair.join(' + '))} />
          <Reason title={t('Mass land denial')} items={details.mass_land_denial ?? []} />
          <Reason title={t('Extra turns')} items={details.extra_turns ?? []} />
          {!!details.banned?.length && (
            <p className="text-sm text-amber-300">
              {t('Heads up: banned in Commander — {cards}.', { cards: details.banned.join(', ') })}
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-parchment/40">
        {t("It's the")} <em>{t('minimum')}</em>{' '}
        {t("bracket based on the cards; the builder's intent counts too, so talk it over at the table.")}{' '}
        {t('Card classification by')}{' '}
        <a href={SPELLBOOK_URL} target="_blank" rel="noreferrer" className="underline hover:text-gold">
          Commander Spellbook
        </a>
        {t(', rules from the')}{' '}
        <a href={BRACKETS_ARTICLE_URL} target="_blank" rel="noreferrer" className="underline hover:text-gold">
          {t('official bracket system')}
        </a>
        .
      </p>
    </section>
  )
}
