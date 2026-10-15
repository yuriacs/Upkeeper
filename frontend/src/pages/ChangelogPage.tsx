import { useState } from 'react'
import { useTitle } from '../hooks/useTitle'
import { CHANGELOG, type ChangeTag } from '../lib/changelog'
import { useI18n } from '../lib/i18n'
import { SITE_NAME } from '../lib/site'

// Cor de cada tipo de mudança (classes escritas por extenso para o Tailwind encontrar)
const TAG_STYLE: Record<ChangeTag, string> = {
  table: 'border-gold/50 text-gold',
  deal: 'border-sky-400/50 text-sky-300',
  site: 'border-parchment/30 text-parchment/80',
  account: 'border-emerald-400/50 text-emerald-300',
  privacy: 'border-violet-400/50 text-violet-300',
  security: 'border-red-400/50 text-red-300',
  speed: 'border-amber-300/50 text-amber-200',
  fix: 'border-parchment/20 text-parchment/60',
}
// Nos dois idiomas aqui mesmo: "Deal" já é "Sortear" (o verbo) nas traduções do menu
const TAG_LABEL: Record<ChangeTag, { en: string; pt: string }> = {
  table: { en: 'Table', pt: 'Mesa' },
  deal: { en: 'Deals', pt: 'Sorteio' },
  site: { en: 'Site', pt: 'Site' },
  account: { en: 'Account', pt: 'Conta' },
  privacy: { en: 'Privacy', pt: 'Privacidade' },
  security: { en: 'Security', pt: 'Segurança' },
  speed: { en: 'Speed', pt: 'Desempenho' },
  fix: { en: 'Fix', pt: 'Correção' },
}
const TAGS = Object.keys(TAG_LABEL) as ChangeTag[]

/** Novidades: tudo o que mudou no site, dia a dia (o mais novo em cima). */
export default function ChangelogPage() {
  const { t, lang, locale } = useI18n()
  useTitle(t("What's new"))
  const [tag, setTag] = useState<ChangeTag | null>(null)
  const days = CHANGELOG.map((d) => ({ ...d, changes: d.changes.filter((c) => !tag || c.tag === tag) })).filter(
    (d) => d.changes.length,
  )
  // Meio-dia: a data não muda de dia em nenhum fuso
  const dayLabel = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition ${
      active ? 'border-gold bg-gold/15 text-gold' : 'border-line text-parchment/60 hover:text-parchment'
    }`

  return (
    <section className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-3">
        <h1 className="font-display text-3xl text-parchment sm:text-4xl">{t("What's new")}</h1>
        <p className="text-parchment/70">
          {t('Everything that changed on {site}, day by day.', { site: SITE_NAME })}
        </p>
      </div>

      <div role="group" aria-label={t('Filter by type')} className="flex flex-wrap gap-1.5">
        <button onClick={() => setTag(null)} aria-pressed={!tag} className={chip(!tag)}>
          {t('All')}
        </button>
        {TAGS.map((k) => (
          <button key={k} onClick={() => setTag(tag === k ? null : k)} aria-pressed={tag === k} className={chip(tag === k)}>
            {TAG_LABEL[k][lang]}
          </button>
        ))}
      </div>

      <ol className="space-y-10">
        {days.map((day) => (
          <li key={day.date} className="relative border-l border-line pl-5">
            <span className="absolute top-2 -left-[5px] h-2.5 w-2.5 rounded-full bg-gold" aria-hidden />
            <h2 className="font-display text-xl text-parchment first-letter:uppercase">
              <time dateTime={day.date}>{dayLabel(day.date)}</time>
            </h2>
            <ul className="mt-3 space-y-2.5">
              {day.changes.map((c) => (
                <li key={c.en} className="flex items-start gap-3 text-sm leading-relaxed text-parchment/80">
                  <span
                    className={`mt-0.5 w-24 shrink-0 rounded-full border px-2 py-px text-center text-[0.7rem] font-semibold ${TAG_STYLE[c.tag]}`}
                  >
                    {TAG_LABEL[c.tag][lang]}
                  </span>
                  <span>{lang === 'pt' ? c.pt : c.en}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  )
}
