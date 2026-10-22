import { useMutation } from '@tanstack/react-query'
import { ImagePlus, Trash2, UserRound } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import AvatarCropper from './AvatarCropper'

/**
 * Foto de perfil (opcional): aparece na mesa, no lugar do ícone da cadeira, e no perfil público.
 * Antes de enviar, o jogador ajusta o recorte (AvatarCropper); o servidor ainda confere a imagem e
 * tira os metadados da foto (como a localização).
 */
export default function AvatarCard() {
  const t = useT()
  const { user, updateUser } = useAuth()
  const file = useRef<HTMLInputElement>(null)
  // Foto escolhida, esperando o ajuste do recorte
  const [picked, setPicked] = useState<File | null>(null)
  const done = (avatar: string | null) => user && updateUser({ ...user, avatar })
  const upload = useMutation({ mutationFn: (f: File) => api.uploadAvatar(f), onSuccess: (r) => done(r.avatar) })
  const remove = useMutation({ mutationFn: () => api.removeAvatar(), onSuccess: (r) => done(r.avatar) })
  if (!user) return null
  const busy = upload.isPending || remove.isPending
  const code = upload.error instanceof ApiError ? upload.error.message : ''
  const error = upload.isError
    ? code === 'not_image'
      ? t('That file is not an image we can use (JPG, PNG, WebP or GIF).')
      : code === 'too_big'
        ? t('Image too large (up to 6 MB).')
        : code === 'uploads_blocked'
          ? t('An admin blocked image uploads from this account after a report.')
          : upload.error.message
    : remove.isError
      ? remove.error.message
      : ''

  return (
    <div className="flex items-center gap-4 rounded-lg border border-line bg-surface/60 p-4">
      {user.avatar ? (
        <img src={user.avatar} alt="" className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-gold/60" />
      ) : (
        <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-ink ring-2 ring-line">
          <UserRound className="h-9 w-9 text-parchment/30" aria-hidden />
        </span>
      )}
      <div className="min-w-0 space-y-2">
        <div>
          <p className="font-semibold">{t('Profile photo')}</p>
          <p className="text-sm text-parchment/60">
            {t('Shows at the tables, in place of your seat icon, and on your public profile. Everyone at the table sees it.')}
          </p>
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
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => file.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-gold px-3 py-1.5 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
            {upload.isPending ? t('Sending…') : user.avatar ? t('Change photo') : t('Add a photo')}
          </button>
          {user.avatar && (
            <button
              onClick={() => remove.mutate()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-red-400/50 hover:text-red-300 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {t('Remove photo')}
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {picked && (
          <AvatarCropper
            file={picked}
            onCancel={() => setPicked(null)}
            onConfirm={(photo) => {
              setPicked(null)
              upload.mutate(photo)
            }}
          />
        )}
        <p className="text-xs text-parchment/45">
          {t('The photo is cropped square and its hidden data (like where it was taken) is removed. Tables you are already sitting at show it when you come back.')}
        </p>
      </div>
    </div>
  )
}
