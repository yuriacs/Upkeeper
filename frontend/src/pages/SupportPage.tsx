import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gem, Gift, ImageIcon, Layers, Medal, UserRound, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuthDialog } from '../components/auth/AuthDialog'
import { LogoMark } from '../components/Logo'
import { PixBox } from '../components/PixBox'
import { useTitle } from '../hooks/useTitle'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n, useT } from '../lib/i18n'
import { formatReais, PIX_ENABLED } from '../lib/pix'
import { KOFI_URL, SITE_NAME } from '../lib/site'
import type { DonationClaim } from '../lib/types'

// Igual a FOUNDER_UNTIL em accounts/supporter.py (fim do dia, horário de Brasília)
const FOUNDER_UNTIL = '2026-12-31T23:59:59-03:00'

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
  const message = t(
    'Found {site}: play Commander online for free, and the site randomly picks which precon each player uses. Come play!',
    {
      site: SITE_NAME,
    },
  )
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
            className="rounded-lg btn-ember px-4 py-2 text-sm font-bold text-ink transition hover:brightness-110"
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

/** Fundador: selo permanente para quem apoiar até a data limite (ou somar R$ 100 depois) */
function FounderPromo() {
  const { t, locale } = useI18n()
  const date = new Date(FOUNDER_UNTIL).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  const [open] = useState(() => Date.now() <= Date.parse(FOUNDER_UNTIL))
  return (
    <div className="flex gap-3 rounded-lg border border-amber-300/40 bg-amber-300/5 p-4 text-left">
      <Medal className="mt-0.5 h-6 w-6 shrink-0 text-amber-300" aria-hidden />
      <div className="space-y-1">
        <p className="font-display text-lg text-amber-200">{t('Founder badge')}</p>
        <p className="text-sm text-parchment/75">
          {open
            ? t(
                'Anyone who supports the site until {date} becomes a Founder: a badge that never expires and your name on the credits page. After that, it takes {total} in donations.',
                { date, total: formatReais(10_000, locale) },
              )
            : t('Reach {total} in donations to become a Founder: a badge that never expires and your name on the credits page.', {
                total: formatReais(10_000, locale),
              })}{' '}
          <Link to="/credits" className="text-gold underline hover:brightness-110">
            {t('See the founders')}
          </Link>
        </p>
        <p className="text-sm text-parchment/60">
          {t('While the perks are active, founders also get sleeves with their own image, foil sleeves, an animated photo frame and a title below their name.')}
        </p>
      </div>
    </div>
  )
}

/** Perks de apoiador: só enfeites, nada de Magic fica pago */
function Perks() {
  const t = useT()
  const perks = [
    { Icon: Gem, title: t('Badge and golden name'), text: t('Next to your name on your profile, in the ranking and at the tables.') },
    { Icon: Layers, title: t('Card sleeves'), text: t('Pick the color of the back of your cards at the table.') },
    { Icon: ImageIcon, title: t('Battlefield background'), text: t('Your own image behind your battlefield, for everyone at the table.') },
    { Icon: Users, title: t('Supporters wall'), text: t('Your name and photo on this page, if you want.') },
  ]
  return (
    <div className="space-y-3">
      <h2 className="font-display text-xl text-parchment">{t('Supporter perks')}</h2>
      <p className="text-sm text-parchment/70">
        {t('Any donation unlocks these for 30 days. Donating again adds 30 more.')}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {perks.map(({ Icon, title, text }) => (
          <div key={title} className="flex gap-3 rounded-lg border border-gold/25 bg-surface/60 p-4">
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />
            <div>
              <p className="font-semibold text-parchment">{title}</p>
              <p className="text-sm text-parchment/65">{text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * "Já doei": depois do Pix, o aviso entra na fila do admin, que confere os centavos no extrato e ativa.
 * Dá para dar os 30 dias de presente a outra conta.
 */
function DonationNotice({ claim }: { claim: DonationClaim }) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const [giving, setGiving] = useState(false)
  const [gift, setGift] = useState('')
  const saved = () => queryClient.invalidateQueries({ queryKey: ['donation'] })
  const send = useMutation({ mutationFn: () => api.claimDonation(giving ? gift.trim() : ''), onSuccess: saved })
  const cancel = useMutation({ mutationFn: api.cancelDonation, onSuccess: saved })
  const ending = `,${String(claim.cents).padStart(2, '0')}`
  if (claim.claimed_at) {
    const when = new Date(claim.claimed_at).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    return (
      <div className="space-y-2 rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-4 text-left text-sm text-parchment/80">
        <p className="font-semibold text-emerald-300">{t('Thanks! Your notice is in the queue.')}</p>
        <p>
          {claim.gift
            ? t('We will check the Pix ending in {cents} ({when}) and activate the perks for {name}, usually within a day.', {
                cents: ending,
                when,
                name: claim.gift,
              })
            : t('We will check the Pix ending in {cents} ({when}) and activate your perks, usually within a day.', {
                cents: ending,
                when,
              })}
        </p>
        <button
          type="button"
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending}
          className="text-parchment/50 underline hover:text-parchment disabled:opacity-50"
        >
          {t('Cancel notice')}
        </button>
      </div>
    )
  }
  const notFound = send.error instanceof ApiError && send.error.status === 404
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        send.mutate()
      }}
      className="space-y-3 rounded-lg border border-line bg-surface/40 p-4 text-left text-sm text-parchment/75"
    >
      <div className="space-y-1">
        <p className="font-semibold text-parchment">{t('Already sent the Pix?')}</p>
        <p>{t('Let us know so we can find your donation (ending in {cents}) and activate the perks.', { cents: ending })}</p>
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={giving}
          onChange={(e) => {
            setGiving(e.target.checked)
            send.reset()
          }}
          className="accent-gold"
        />
        <Gift className="h-4 w-4 text-gold" aria-hidden />
        {t("It's a gift: the 30 days go to a friend")}
      </label>
      {giving && (
        <input
          value={gift}
          onChange={(e) => {
            setGift(e.target.value)
            send.reset()
          }}
          placeholder={t("Friend's username")}
          spellCheck={false}
          autoCapitalize="none"
          className="w-full rounded-lg border border-line bg-ink px-3 py-2 focus:border-gold focus:outline-none"
        />
      )}
      {send.isError && (
        <p className="text-red-400">{notFound ? t('No account with that username.') : send.error.message}</p>
      )}
      <button
        disabled={send.isPending || (giving && !gift.trim())}
        className="w-full rounded-lg bg-gold px-4 py-2.5 font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
      >
        {t('I donated')}
      </button>
    </form>
  )
}

/** Como os perks chegam à conta: os centavos do Pix (e o "Já doei") ou o nome de usuário no Ko-fi */
function HowToGetPerks({ username }: { username: string | null }) {
  const t = useT()
  const { openAuth } = useAuthDialog()
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface/40 p-4 text-left text-sm text-parchment/75">
      <p className="font-semibold text-parchment">{t('How the perks reach your account')}</p>
      {username ? (
        <p>
          {t(
            "On Ko-fi, write your username ({name}) in the message, and your friend's too if it is a gift.",
            { name: username },
          )}
        </p>
      ) : (
        <p>
          <button type="button" onClick={() => openAuth('login')} className="text-gold underline hover:brightness-110">
            {t('Sign in')}
          </button>{' '}
          {t('before donating: the Pix amount gets cents that identify your account. On Ko-fi, write your username in the message.')}
        </p>
      )}
      <p className="text-parchment/55">
        {t('Activation is done by hand, usually within a day. Your perks show up in My account.')}
      </p>
    </div>
  )
}

/** Mural: apoiadores ativos que escolheram aparecer */
function Wall() {
  const t = useT()
  const wall = useQuery({ queryKey: ['supporters-wall'], queryFn: api.supportersWall, staleTime: 60_000 })
  const list = wall.data?.supporters ?? []
  if (!list.length) return null
  return (
    <div className="space-y-3">
      <h2 className="font-display text-xl text-parchment">{t('Thank you!')}</h2>
      <ul className="flex flex-wrap gap-2">
        {list.map((s) => (
          <li key={s.username}>
            <Link
              to={`/u/${encodeURIComponent(s.username)}`}
              className="flex items-center gap-2 rounded-full border border-gold/30 bg-surface/60 py-1 pr-3 pl-1 text-sm text-gold hover:border-gold"
            >
              {s.avatar ? (
                <img src={s.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <span className="grid h-7 w-7 place-items-center rounded-full bg-ink">
                  <UserRound className="h-4 w-4 text-parchment/40" aria-hidden />
                </span>
              )}
              {s.username}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SupportPage() {
  const t = useT()
  const { user } = useAuth()
  useTitle(t('Support the project'))
  const donation = useQuery({
    queryKey: ['donation', user?.username],
    queryFn: api.myDonation,
    enabled: !!user && PIX_ENABLED,
    staleTime: 10 * 60_000,
  })
  return (
    <section className="mx-auto max-w-2xl space-y-10">
      <div className="space-y-4 text-center">
        <LogoMark className="mx-auto h-14 w-14 text-gold" />
        <h1 className="font-display text-3xl text-parchment sm:text-4xl">{t('Support {site}', { site: SITE_NAME })}</h1>
        <p className="mx-auto max-w-xl text-balance text-parchment/75">
          {t(
            'The site is and will stay 100% free, with no ads. If it livens up your Commander tables, any amount helps keep it online, and you get a few cosmetic perks as a thank-you.',
          )}
        </p>
        {PIX_ENABLED ? (
          <div id="pix" className="space-y-3 pt-2">
            <PixBox username={user?.username} cents={user ? donation.data?.cents : null} />
            {user && donation.data && <DonationNotice claim={donation.data} />}
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
        <HowToGetPerks username={user?.username ?? null} />
      </div>

      <FounderPromo />

      <Perks />

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
              <strong className="text-parchment">{t('Perks are cosmetic only.')}</strong>{' '}
              {t(
                'Decks, deals, the virtual table and everything about Magic stay free for everyone, with or without a donation. Perks are a thank-you, not a subscription.',
              )}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-gold">✦</span>
            <span>
              {t(
                "No minimum amount and no monthly commitment: it's a one-time contribution, when and if you want. Perks simply end after 30 days if you don't donate again.",
              )}
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

      <Wall />

      <ShareBox />
    </section>
  )
}
