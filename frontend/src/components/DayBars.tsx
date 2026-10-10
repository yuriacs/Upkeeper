import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import type { DayCount } from '../lib/types'

// "2026-10-09" → data local (sem virar o dia anterior por causa do fuso)
const parse = (iso: string) => new Date(`${iso}T12:00:00`)

/**
 * Barras por dia, uma só série (o título do painel diz o que é).
 * Passar o mouse/dedo mostra o dia e o valor; os dados também ficam numa tabela.
 * `unit`: frases em inglês (singular, plural) com {n}, ex.: ['{n} deal', '{n} deals'].
 */
export default function DayBars({ data, unit }: { data: DayCount[]; unit: [string, string] }) {
  const { t, locale } = useI18n()
  const dayFmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' })
  const longFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: 'long' })
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.count))
  const total = data.reduce((n, d) => n + d.count, 0)
  const label = (n: number) => t(n === 1 ? unit[0] : unit[1], { n: n.toLocaleString(locale) })
  const shown = active ?? data.length - 1

  return (
    <figure className="space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-parchment/60">
          {active === null ? t('Today') : longFmt.format(parse(data[shown].date))}:{' '}
          <strong className="tabular-nums text-parchment">{label(data[shown]?.count ?? 0)}</strong>
        </span>
        <span className="text-xs text-parchment/45">{t('total {total}', { total: label(total) })}</span>
      </div>

      <div className="relative">
        {/* linha de referência no máximo, recessiva */}
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-parchment/10" aria-hidden />
        <span
          className="absolute -top-2 right-0 bg-surface pl-1 text-[10px] tabular-nums text-parchment/40"
          aria-hidden
        >
          {max}
        </span>
        <div
          className="flex h-32 items-end gap-[2px]"
          onMouseLeave={() => setActive(null)}
          role="img"
          aria-label={t('{total} in the last {days} days; busiest day with {max}.', {
            total: label(total),
            days: data.length,
            max: label(max),
          })}
        >
          {data.map((d, i) => (
            <button
              key={d.date}
              type="button"
              tabIndex={-1}
              aria-hidden
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              className="group flex h-full flex-1 items-end"
            >
              <span
                className={`block w-full rounded-t-[4px] transition-colors ${
                  i === active ? 'bg-gold' : 'bg-gold/70 group-hover:bg-gold'
                }`}
                style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 3 : 1, opacity: d.count ? 1 : 0.25 }}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-between border-t border-parchment/15 pt-1 text-[11px] text-parchment/45" aria-hidden>
        <span>{dayFmt.format(parse(data[0].date))}</span>
        <span>{dayFmt.format(parse(data[Math.floor(data.length / 2)].date))}</span>
        <span>{t('today')}</span>
      </div>

      <details className="text-xs text-parchment/50">
        <summary className="cursor-pointer hover:text-gold">{t('Show as table')}</summary>
        <table className="mt-2 w-full tabular-nums">
          <tbody>
            {[...data].reverse().map((d) => (
              <tr key={d.date} className="border-b border-line">
                <td className="py-0.5">{dayFmt.format(parse(d.date))}</td>
                <td className="py-0.5 text-right text-parchment/80">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
