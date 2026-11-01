import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import ImageCropper from './ImageCropper'
import { FounderBadge } from './SupporterBadge'

function errorText(error: Error, t: (text: string) => string): string {
  const code = error instanceof ApiError ? error.message : ''
  if (code === 'not_image') return t('That file is not an image we can use (JPG, PNG, WebP or GIF).')
  if (code === 'too_big') return t('Image too large (up to 6 MB).')
  if (code === 'uploads_blocked') return t('An admin blocked image uploads from this account after a report.')
  if (code === 'not_founder') return t('Only for founders with active perks.')
  return error.message
}

/**
 * Fundo do campo de um deck montado (enfeite de Fundador, accounts/supporter.py). Na mesa, carregar
 * este deck troca o fundo do campo; sem fundo aqui, vale o do perfil. Todo deck começa sem nenhum.
 * Só aparece para o dono do deck que é Fundador.
 */
export default function DeckPlaymat({ deckId }: { deckId: string }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const info = user?.supporter
  const founder = !!info?.founder
  const active = !!info?.founder_perks
  const queryClient = useQueryClient()
  const key = ['deck-playmat', deckId]
  const current = useQuery({
    queryKey: key,
    queryFn: () => api.deckPlaymat(deckId),
    enabled: founder,
    staleTime: 5 * 60_000,
  })
  const done = (r: { playmat: string | null }) => queryClient.setQueryData(key, r)
  const upload = useMutation({ mutationFn: (f: File) => api.uploadDeckPlaymat(deckId, f), onSuccess: done })
  const remove = useMutation({ mutationFn: () => api.removeDeckPlaymat(deckId), onSuccess: done })
  const file = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<File | null>(null)
  if (!founder) return null

  const mine = current.data?.playmat ?? null
  const fallback = info?.active ? info.playmat : null
  const busy = upload.isPending || remove.isPending
  const error = upload.error ? errorText(upload.error, t) : (remove.error?.message ?? '')

  return (
    <div className="flex max-w-xl flex-wrap items-center gap-3 rounded-lg border border-gold/30 bg-ink/50 p-3 backdrop-blur-sm">
      {mine ? (
        <img src={mine} alt="" className="aspect-[3/1] w-40 shrink-0 rounded-md object-cover ring-1 ring-gold/50" />
      ) : fallback ? (
        <span className="relative w-40 shrink-0">
          <img src={fallback} alt="" className="aspect-[3/1] w-40 rounded-md object-cover opacity-40 ring-1 ring-line" />
          <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-parchment/80">
            {t('Profile background')}
          </span>
        </span>
      ) : (
        <span className="grid aspect-[3/1] w-40 shrink-0 place-items-center rounded-md border border-dashed border-line text-[11px] text-parchment/40">
          {t('No background')}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-parchment">
          <FounderBadge /> {t('Battlefield background for this deck')}
        </p>
        <p className="text-xs text-parchment/55">
          {active
            ? t('At the table, loading this deck switches your battlefield to this background. Without one, your profile background is used.')
            : t('A founder perk. It comes back when you support again.')}
        </p>
        {active ? (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => file.current?.click()}
              disabled={busy || current.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-2.5 py-1 text-xs font-semibold text-ink hover:brightness-110 disabled:opacity-50"
            >
              <ImagePlus className="h-3.5 w-3.5" aria-hidden />
              {upload.isPending ? t('Sending…') : mine ? t('Change image') : t('Choose image')}
            </button>
            {mine && (
              <button
                onClick={() => remove.mutate()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs hover:border-red-400/50 hover:text-red-300 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {t('Use profile background')}
              </button>
            )}
          </div>
        ) : (
          <Link to="/support" className="text-xs text-gold underline-offset-4 hover:underline">
            {t('Support again')}
          </Link>
        )}
        {error && <p className="text-xs text-red-300">{error}</p>}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) {
            upload.reset()
            setPicked(f)
          }
          e.target.value = ''
        }}
      />
      {picked && (
        <ImageCropper
          file={picked}
          aspect={3}
          out={[1920, 640]}
          dimPreview
          title={t('Frame your background')}
          help={t('Drag to choose the part that shows and zoom in or out. The frame has the shape of your battlefield at the table.')}
          confirmLabel={t('Use this background')}
          onCancel={() => setPicked(null)}
          onConfirm={(image) => {
            setPicked(null)
            upload.mutate(image)
          }}
        />
      )}
    </div>
  )
}
