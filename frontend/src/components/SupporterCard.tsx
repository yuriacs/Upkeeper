import { useMutation } from '@tanstack/react-query'
import { ImagePlus, Sparkles, Trash2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type SupporterChoices } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n, useT } from '../lib/i18n'
import { formatReais } from '../lib/pix'
import { SITE_NAME } from '../lib/site'
import { SLEEVES, sleeveLook, sleeveStyle } from '../lib/sleeves'
import { TITLES } from '../lib/titles'
import type { SupporterInfo } from '../lib/types'
import { LogoMark } from './Logo'
import SupporterBadge, { FounderBadge } from './SupporterBadge'

/**
 * Fundador: selo permanente para quem apoiar até a data limite ou somar o total (accounts/supporter.py).
 * Já Fundador, dá para sair da página de créditos; senão, mostra quanto falta.
 */
function FounderBox({ info, onCredits, busy }: { info: SupporterInfo; onCredits: (v: boolean) => void; busy: boolean }) {
  const { t, locale } = useI18n()
  const deadline = new Date(info.founder_until)
  const [open] = useState(() => Date.now() <= deadline.getTime())
  const date = deadline.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  const total = formatReais(info.founder_total_cents, locale)
  let body: ReactNode
  if (info.founder)
    body = (
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={info.in_credits}
          disabled={busy}
          onChange={(e) => onCredits(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]"
        />
        <span>
          <span className="font-semibold text-parchment">{t('Show me on the credits page')}</span>
          <span className="block text-xs text-parchment/55">
            {t('Your username and photo on the')}{' '}
            <Link to="/credits" className="text-gold hover:underline">
              {t('Credits')}
            </Link>
            .
          </span>
        </span>
      </label>
    )
  else
    body = (
      <p className="text-xs text-parchment/60">
        {open
          ? t('Any donation until {date} makes you a Founder, with a badge that never expires.', { date })
          : t('Reach {total} in donations to become a Founder, with a badge that never expires.', { total })}
      </p>
    )
  return (
    <div className="space-y-2 rounded-lg border border-amber-300/30 bg-amber-300/5 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">
        <FounderBadge className="h-4 w-4" />
        {info.founder ? t('You are a {site} founder. Thank you!', { site: SITE_NAME }) : t('Founder badge')}
      </p>
      {info.total_cents > 0 && (
        <p className="text-xs text-parchment/60">
          {t('Donated in total: {total}', { total: formatReais(info.total_cents, locale) })}
        </p>
      )}
      {body}
    </div>
  )
}

/** Mensagem de um envio de imagem que deu errado (fundo do campo ou sleeve) */
function uploadError(error: Error, t: (text: string) => string): string {
  const code = error instanceof ApiError ? error.message : ''
  if (code === 'not_image') return t('That file is not an image we can use (JPG, PNG, WebP or GIF).')
  if (code === 'too_big') return t('Image too large (up to 6 MB).')
  if (code === 'uploads_blocked') return t('An admin blocked image uploads from this account after a report.')
  if (code === 'not_supporter') return t('Your supporter perks have expired.')
  if (code === 'not_founder') return t('Only for founders with active perks.')
  return error.message
}

/**
 * Enfeites de Fundador com o apoio ativo: sleeve com imagem própria (moderada), brilho foil, moldura
 * animada na foto e um título da lista abaixo do nome no perfil.
 */
function FounderPerks({
  info,
  choose,
  busy,
  onSleeve,
}: {
  info: SupporterInfo
  choose: (data: SupporterChoices) => void
  busy: boolean
  onSleeve: (sleeve_image: string | null) => void
}) {
  const t = useT()
  const file = useRef<HTMLInputElement>(null)
  const upload = useMutation({ mutationFn: (f: File) => api.uploadSleeve(f), onSuccess: (r) => onSleeve(r.sleeve_image) })
  const remove = useMutation({ mutationFn: () => api.removeSleeve(), onSuccess: (r) => onSleeve(r.sleeve_image) })
  const on = info.founder_perks
  const look = sleeveLook({ sleeve: info.sleeve, sleeve_image: info.sleeve_image, foil: info.foil })
  const error = upload.error ? uploadError(upload.error, t) : (remove.error?.message ?? '')
  const sending = upload.isPending || remove.isPending
  return (
    <fieldset disabled={!on || busy} className="space-y-4 rounded-lg border border-amber-300/30 p-3 disabled:opacity-60">
      <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-amber-200">
        <Sparkles className="h-4 w-4" aria-hidden /> {t('Founder perks')}
      </legend>
      <p className="text-xs text-parchment/55">
        {on
          ? t('Extras for founders while the perks are active.')
          : info.founder
            ? t('Your founder badge is permanent; these extras come back when you support again.')
            : t('Extras for founders while the perks are active.')}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <span style={look.style} className={`grid h-20 w-14 shrink-0 place-items-center overflow-hidden rounded-[6%] border ${look.className}`}>
          {look.logo && <LogoMark className="h-1/3 w-1/3 opacity-70" />}
        </span>
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold text-parchment">{t('Sleeve with your image')}</p>
          <p className="text-xs text-parchment/55">
            {t('Replaces the color on the back of your cards (cropped to card shape). Use only images you are allowed to share: other players can report it.')}
          </p>
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload.mutate(f)
              e.target.value = ''
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => file.current?.click()}
              disabled={sending}
              className="inline-flex items-center gap-2 rounded-lg bg-gold px-3 py-1.5 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
            >
              <ImagePlus className="h-4 w-4" aria-hidden />
              {upload.isPending ? t('Sending…') : info.sleeve_image ? t('Change image') : t('Choose image')}
            </button>
            {info.sleeve_image && (
              <button
                type="button"
                onClick={() => remove.mutate()}
                disabled={sending}
                className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-red-400/50 hover:text-red-300 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                {t('Remove')}
              </button>
            )}
          </div>
        </div>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={info.foil}
          onChange={(e) => choose({ foil: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]"
        />
        <span>
          <span className="font-semibold text-parchment">{t('Foil sleeves')}</span>
          <span className="block text-xs text-parchment/55">{t('A shine sweeping across the back of your cards.')}</span>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={info.frame}
          onChange={(e) => choose({ frame: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]"
        />
        <span>
          <span className="font-semibold text-parchment">{t('Animated frame')}</span>
          <span className="block text-xs text-parchment/55">{t('A golden ring around your photo at the table and on your profile.')}</span>
        </span>
      </label>

      <label className="block space-y-1 text-sm">
        <span className="font-semibold text-parchment">{t('Title')}</span>
        <span className="block text-xs text-parchment/55">{t('Shown below your name on your profile.')}</span>
        <select
          value={info.title}
          onChange={(e) => choose({ title: e.target.value })}
          className="rounded-lg border border-line bg-ink px-3 py-2 focus:border-gold focus:outline-none"
        >
          <option value="">{t('No title')}</option>
          {TITLES.map((title) => (
            <option key={title.key} value={title.key}>
              {t(title.label)}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </fieldset>
  )
}

/**
 * Apoiador (minha conta): até quando vale e as escolhas dos enfeites. Nada aqui libera Magic: são só
 * selo, nome dourado, sleeve, fundo do campo e o mural (accounts/supporter.py).
 */
export default function SupporterCard() {
  const { t, locale } = useI18n()
  const { user, updateUser } = useAuth()
  const file = useRef<HTMLInputElement>(null)
  const info = user?.supporter
  const merge = (patch: Partial<SupporterInfo>) =>
    user && info && updateUser({ ...user, supporter: { ...info, ...patch } })
  const choose = useMutation({
    mutationFn: (data: SupporterChoices) => api.updateSupporter(data),
    onSuccess: (r) => user && updateUser({ ...user, supporter: r }),
  })
  const upload = useMutation({ mutationFn: (f: File) => api.uploadPlaymat(f), onSuccess: (r) => merge(r) })
  const remove = useMutation({ mutationFn: () => api.removePlaymat(), onSuccess: (r) => merge(r) })
  if (!user || !info) return null

  if (!info.ever)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface/60 p-4">
        <div className="min-w-0">
          <p className="font-semibold">{t('Supporter perks')}</p>
          <p className="text-sm text-parchment/60">
            {t('Donate any amount and get a badge, a golden name, card sleeves and your own battlefield background for {days} days.', {
              days: info.days,
            })}
          </p>
        </div>
        <Link to="/support" className="rounded-lg btn-ember px-4 py-2 text-sm font-bold text-ink hover:brightness-110">
          {t('Support')}
        </Link>
        <div className="w-full">
          <FounderBox info={info} onCredits={() => undefined} busy />
        </div>
      </div>
    )

  const until = info.until ? new Date(info.until).toLocaleDateString(locale, { day: 'numeric', month: 'long' }) : ''
  const error = upload.error ? uploadError(upload.error, t) : (choose.error?.message ?? remove.error?.message ?? '')
  const busy = upload.isPending || remove.isPending

  return (
    <div className="space-y-5 rounded-lg border border-gold/40 bg-surface/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold">
            <SupporterBadge className="h-4 w-4" /> {t('Supporter perks')}
          </p>
          <p className={`text-sm ${info.active ? 'text-emerald-300' : 'text-parchment/60'}`}>
            {info.active
              ? t('Active until {date}. Thank you!', { date: until })
              : t('Expired on {date}. Your choices are saved and come back when you support again.', { date: until })}
          </p>
        </div>
        <Link to="/support" className="rounded-lg border border-gold/50 px-3 py-1.5 text-sm text-gold hover:bg-gold/10">
          {info.active ? t('Renew') : t('Support again')}
        </Link>
      </div>

      <FounderBox info={info} onCredits={(v) => choose.mutate({ in_credits: v })} busy={choose.isPending} />

      <fieldset disabled={!info.active || choose.isPending} className="space-y-2 disabled:opacity-60">
        <legend className="text-sm font-semibold text-parchment">{t('Card sleeves')}</legend>
        <p className="text-xs text-parchment/55">{t('The back of your face-down cards and your library, for everyone at the table.')}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('Card sleeves')}>
          {SLEEVES.map((s) => {
            const on = (info.sleeve || 'ember') === s.key
            return (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={on}
                title={s.name}
                onClick={() => choose.mutate({ sleeve: s.key === 'ember' ? '' : s.key })}
                className={`rounded-md p-0.5 transition ${on ? 'ring-2 ring-gold' : 'ring-1 ring-transparent hover:ring-parchment/30'}`}
              >
                <span
                  style={sleeveStyle(s.key)}
                  className="grid h-14 w-10 place-items-center rounded-[6%] border"
                >
                  <LogoMark className="h-1/3 w-1/3 opacity-70" />
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className={`space-y-2 ${info.active ? '' : 'opacity-60'}`}>
        <p className="text-sm font-semibold text-parchment">{t('Battlefield background')}</p>
        <p className="text-xs text-parchment/55">
          {t('An image of yours behind your battlefield at the table (cropped to 16:9, shown darkened). Use only images you are allowed to share: other players can report it.')}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {info.playmat ? (
            <img src={info.playmat} alt="" className="aspect-video w-48 rounded-md object-cover ring-1 ring-line" />
          ) : (
            <span className="grid aspect-video w-48 place-items-center rounded-md border border-dashed border-line text-xs text-parchment/40">
              {t('No background')}
            </span>
          )}
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload.mutate(f)
              e.target.value = ''
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => file.current?.click()}
              disabled={busy || !info.active}
              className="inline-flex items-center gap-2 rounded-lg bg-gold px-3 py-1.5 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
            >
              <ImagePlus className="h-4 w-4" aria-hidden />
              {upload.isPending ? t('Sending…') : info.playmat ? t('Change image') : t('Choose image')}
            </button>
            {info.playmat && (
              <button
                onClick={() => remove.mutate()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-red-400/50 hover:text-red-300 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                {t('Remove')}
              </button>
            )}
          </div>
        </div>
      </div>

      {info.founder && (
        <FounderPerks
          info={info}
          choose={(data) => choose.mutate(data)}
          busy={choose.isPending}
          onSleeve={(sleeve_image) => merge({ sleeve_image })}
        />
      )}

      <label className={`flex items-start gap-3 text-sm ${info.active ? '' : 'opacity-60'}`}>
        <input
          type="checkbox"
          checked={info.on_wall}
          disabled={!info.active || choose.isPending}
          onChange={(e) => choose.mutate({ on_wall: e.target.checked })}
          className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]"
        />
        <span>
          <span className="font-semibold text-parchment">{t('Show me on the supporters wall')}</span>
          <span className="block text-xs text-parchment/55">
            {t('Your username and photo on the Support page while your perks are active.')}
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <p className="text-xs text-parchment/45">
        {t('Perks are cosmetic only: everything about Magic on the site stays free for everyone. Tables you are already sitting at update when you come back.')}
      </p>
    </div>
  )
}
