import { useI18n } from '../lib/i18n'
import { money } from '../lib/money'
import type { DeckPrice } from '../lib/types'

/** Selo compacto do valor estimado (catálogo, pool, listas) */
export function PriceBadge({ usd, className = '' }: { usd?: string | null; className?: string }) {
  const { t, locale } = useI18n()
  const text = money(usd, 'USD', locale, true)
  if (!usd || !text) return null
  return (
    <span
      title={t('Estimated value: sum of the card prices on Scryfall')}
      className={`shrink-0 text-[11px] tabular-nums text-emerald-300/80 ${className}`}
    >
      {text}
    </span>
  )
}

/** Página do deck: total em dólar e euro, as cartas mais caras e o aviso de que é estimativa */
export function PricePanel({ price, onCard }: { price: DeckPrice; onCard?: (name: string) => void }) {
  const { t, locale } = useI18n()
  const usd = money(price.usd, 'USD', locale)
  const eur = money(price.eur, 'EUR', locale)
  if (!Number(price.usd) && !Number(price.eur)) return null
  const updated = price.updated_at ? new Date(price.updated_at).toLocaleDateString(locale) : null
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div>
          <h2 className="font-display text-xl text-parchment">{t('Estimated value')}</h2>
          <p className="text-xs text-parchment/50">
            {t('Sum of the card prices on Scryfall (TCGplayer in dollars, Cardmarket in euros), for the printing in this list.')}
          </p>
        </div>
        <p className="font-display text-3xl text-emerald-300 tabular-nums">
          {usd}
          {eur && <span className="ml-3 text-xl text-parchment/60">{eur}</span>}
        </p>
      </div>
      {price.top.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-parchment/60 uppercase">{t('Most expensive cards')}</p>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {price.top.map((c) => (
              <li key={c.name} className="flex items-baseline gap-2">
                <button
                  type="button"
                  onClick={() => onCard?.(c.name)}
                  className="min-w-0 truncate text-left hover:text-gold"
                >
                  {c.quantity > 1 && <span className="text-parchment/50">{c.quantity}× </span>}
                  {c.name}
                </button>
                <span className="ml-auto shrink-0 tabular-nums text-parchment/70">
                  {money(c.usd, 'USD', locale) ?? money(c.eur, 'EUR', locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-parchment/40">
        {price.missing > 0 && <>{t('{n} card(s) without a price on Scryfall are left out.', { n: price.missing })} </>}
        {t('Prices change every day and vary by store, language and condition.')}
        {updated && <> {t('Prices updated on {date}.', { date: updated })}</>}
      </p>
    </section>
  )
}
