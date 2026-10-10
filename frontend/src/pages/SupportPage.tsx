import type { ReactNode } from 'react'
import { LogoMark } from '../components/Logo'
import { useTitle } from '../hooks/useTitle'
import { useT } from '../lib/i18n'
import { KOFI_URL, SITE_NAME } from '../lib/site'

function KofiButton({ className = '' }: { className?: string }) {
  const t = useT()
  return (
    <a
      href={KOFI_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-gold px-6 py-3.5 font-display text-lg font-bold text-ink shadow-lg shadow-gold/20 transition hover:brightness-110 ${className}`}
    >
      <span aria-hidden>☕</span> {t('Support on Ko-fi')}
    </a>
  )
}

function Item({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1 p-4">
      <p className="font-semibold text-parchment">{title}</p>
      <p className="text-sm leading-relaxed text-parchment/70">{children}</p>
    </div>
  )
}

export default function SupportPage() {
  const t = useT()
  useTitle(t('Support the project'))
  return (
    <section className="mx-auto max-w-2xl space-y-10">
      <div className="space-y-4 text-center">
        <LogoMark className="mx-auto h-14 w-14 text-gold" />
        <h1 className="font-display text-3xl text-gold sm:text-4xl">{t('Support {site}', { site: SITE_NAME })}</h1>
        <p className="mx-auto max-w-xl text-balance text-parchment/75">
          {t(
            'The site is and will stay 100% free, with no ads and no paid features. If it livens up your Commander tables, a coffee helps keep it online.',
          )}
        </p>
        <KofiButton className="w-full sm:w-auto" />
        <p className="text-xs text-parchment/40">
          {t("You'll be taken to Ko-fi, which processes the payment securely.")}
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-xl text-gold">{t('Where your support goes')}</h2>
        <div className="divide-y divide-gold/10 overflow-hidden rounded-xl border border-gold/15 bg-surface/60">
          <Item title={t('Server and database')}>
            {t(
              'Keeping the API always awake (no waiting almost a minute like on the free plan) and storing decks, rooms and deals.',
            )}
          </Item>
          <Item title={t('Custom domain')}>{t('An address that is easy to remember and share with your group.')}</Item>
          <Item title={t("What's next")}>
            {t('Time for new features: table ranking, importing from a Moxfield/Archidekt link and whatever the community asks for.')}
          </Item>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-xl text-gold">{t('The deal')}</h2>
        <ul className="space-y-2 text-sm leading-relaxed text-parchment/75">
          <li className="flex gap-2">
            <span className="text-gold">✦</span>
            <span>
              <strong className="text-parchment">{t('Supporting unlocks nothing extra.')}</strong>{' '}
              {t("Everyone gets access to everything, with or without a donation. It's a thank-you, not a subscription.")}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-gold">✦</span>
            <span>
              {t("No minimum amount and no monthly commitment: it's a one-time contribution, when and if you want.")}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-gold">✦</span>
            <span>
              {t(
                '{site} is an unofficial fan project, not affiliated with Wizards of the Coast. Donations support the site, not Magic: The Gathering.',
                { site: SITE_NAME },
              )}
            </span>
          </li>
        </ul>
      </div>

      <div className="space-y-3 rounded-xl border border-gold/15 bg-surface/40 p-5 text-center">
        <p className="text-parchment/80">
          {t("Can't donate right now? No problem! Sharing the site with your group already helps a lot.")}
        </p>
        <KofiButton />
      </div>
    </section>
  )
}
