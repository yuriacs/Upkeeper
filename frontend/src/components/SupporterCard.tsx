import { useMutation } from '@tanstack/react-query'
import { ImagePlus, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { SLEEVES, sleeveStyle } from '../lib/sleeves'
import type { SupporterInfo } from '../lib/types'
import { LogoMark } from './Logo'
import SupporterBadge from './SupporterBadge'

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
    mutationFn: (data: { sleeve?: string; on_wall?: boolean }) => api.updateSupporter(data),
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
      </div>
    )

  const until = info.until ? new Date(info.until).toLocaleDateString(locale, { day: 'numeric', month: 'long' }) : ''
  const code = upload.error instanceof ApiError ? upload.error.message : ''
  const error = upload.isError
    ? code === 'not_image'
      ? t('That file is not an image we can use (JPG, PNG, WebP or GIF).')
      : code === 'too_big'
        ? t('Image too large (up to 6 MB).')
        : code === 'uploads_blocked'
          ? t('An admin blocked image uploads from this account after a report.')
          : code === 'not_supporter'
            ? t('Your supporter perks have expired.')
            : upload.error.message
    : (choose.error?.message ?? remove.error?.message ?? '')
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
