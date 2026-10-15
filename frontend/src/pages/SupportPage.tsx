import { useState, type ReactNode } from 'react'
import { LogoMark } from '../components/Logo'
import { PixBox } from '../components/PixBox'
import { useTitle } from '../hooks/useTitle'
import { useT } from '../lib/i18n'
import { PIX_ENABLED } from '../lib/pix'
import { KOFI_URL, SITE_NAME } from '../lib/site'

function KofiButton({ className = '' }: { className?: string }) {
  const t = useT()
  return (
    <a
      href={KOFI_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-gold px-6 py-3.5 font-display text-lg font-bold text-ink shadow-lg transition hover:brightness-110 ${className}`}
    >
      <span aria-hidden>☕</span> {t('Support on Ko-fi')}
    </a>
  )
}

/**
 * Fim da página: divulgar o site (WhatsApp, Telegram, X, copiar o link ou o menu de compartilhar
 * do celular). Botões só com texto, sem os logos das marcas.
 */
function ShareBox() {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const url = window.location.origin
  const message = t('Found {site}: a free virtual table for Commander, with a precon deck dealer. Come play!', {
    site: SITE_NAME,
  })
  const full = `${message} ${url}`
  const links = [
    { name: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(full)}` },
    {
      name: 'Telegram',
      href: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(message)}`,
    },
    {
      name: 'X',
      href: `https://x.com/intent/post?text=${encodeURIComponent(message)}&url=${encodeURIComponent(url)}`,
    },
  ]
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      /* sem permissão de clipboard: o link aparece abaixo para copiar à mão */
    }
  }
  const share = async () => {
    try {
      await navigator.share({ title: SITE_NAME, text: message, url })
    } catch {
      /* cancelou */
    }
  }
  const button =
    'rounded-lg border border-parchment/25 px-4 py-2 text-sm font-semibold text-parchment/85 transition hover:border-gold hover:text-gold'
  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface/40 p-5 text-center">
      <div className="space-y-1">
        <p className="font-display text-xl text-parchment">{t('Share with your group')}</p>
        <p className="text-sm text-parchment/70">
          {t("Can't donate right now? No problem! Sharing the site with your group already helps a lot.")}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {typeof navigator.share === 'function' && (
          <button
            type="button"
            onClick={share}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-bold text-ink transition hover:brightness-110"
          >
            {t('Share…')}
          </button>
        )}
        {links.map((link) => (
          <a key={link.name} href={link.href} target="_blank" rel="noopener noreferrer" className={button}>
            {link.name}
          </a>
        ))}
        <button type="button" onClick={copy} className={button}>
          {copied ? t('Link copied!') : t('Copy link')}
        </button>
      </div>
      <p className="text-xs text-parchment/40 select-all">{url}</p>
    </div>
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
        <h1 className="font-display text-3xl text-parchment sm:text-4xl">{t('Support {site}', { site: SITE_NAME })}</h1>
        <p className="mx-auto max-w-xl text-balance text-parchment/75">
          {t(
            'The site is and will stay 100% free, with no ads and no paid features. If it livens up your Commander tables, any amount helps keep it online.',
          )}
        </p>
        {PIX_ENABLED ? (
          <div id="pix" className="space-y-3 pt-2">
            <PixBox />
            <p className="text-sm text-parchment/50">
              {t('Outside Brazil?')}{' '}
              <a
                href={KOFI_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gold underline hover:brightness-110"
              >
                {t('Support on Ko-fi')}
              </a>{' '}
              {t('(card or PayPal).')}
            </p>
          </div>
        ) : (
          <>
            <KofiButton className="w-full sm:w-auto" />
            <p className="text-xs text-parchment/40">
              {t("You'll be taken to Ko-fi, which processes the payment securely.")}
            </p>
          </>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-xl text-parchment">{t('Where your support goes')}</h2>
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface/60">
          <Item title={t('Server and database')}>
            {t(
              'Keeping the API always awake (no waiting almost a minute like on the free plan) and storing decks, rooms and deals.',
            )}
          </Item>
          <Item title={t('Custom domain')}>{t('An address that is easy to remember and share with your group.')}</Item>
          <Item title={t("What's next")}>
            {t(
              'Time for new features: table ranking, importing from a Moxfield/Archidekt link and whatever the community asks for.',
            )}
          </Item>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-xl text-parchment">{t('The deal')}</h2>
        <ul className="space-y-2 text-sm leading-relaxed text-parchment/75">
          <li className="flex gap-2">
            <span className="text-gold">✦</span>
            <span>
              <strong className="text-parchment">{t('Supporting unlocks nothing extra.')}</strong>{' '}
              {t(
                "Everyone gets access to everything, with or without a donation. It's a thank-you, not a subscription.",
              )}
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

      <ShareBox />
    </section>
  )
}
