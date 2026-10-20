import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { api, ApiError } from '../../lib/api'
import { useT } from '../../lib/i18n'

/**
 * Arte personalizada de uma carta do deck ou de uma ficha (como no untap): enviar uma imagem do
 * computador ou escolher uma das já enviadas. O servidor recorta na proporção da carta e tira os
 * metadados da foto. Os outros jogadores veem a arte.
 */
export default function CardArtDialog({
  card,
  assign: save,
  note,
  current,
  onChange,
  onClose,
}: {
  card: { name: string; image: string }
  /** Grava a arte escolhida (null = a original). Sem ela: deck ainda não salvo */
  assign?: (art: string | null) => Promise<{ arts: Record<string, string> }>
  /** Onde a arte aparece (o padrão é o das cartas do deck) */
  note?: string
  current?: string
  onChange: (arts: Record<string, string>) => void
  onClose: () => void
}) {
  const t = useT()
  const queryClient = useQueryClient()
  const file = useRef<HTMLInputElement>(null)
  const library = useQuery({ queryKey: ['card-arts'], queryFn: api.cardArts, enabled: !!save })
  const assign = useMutation({
    mutationFn: (art: string | null) => save!(art),
    onSuccess: (res) => onChange(res.arts),
  })
  const upload = useMutation({
    mutationFn: (f: File) => api.uploadCardArt(f),
    onSuccess: (art) => {
      queryClient.invalidateQueries({ queryKey: ['card-arts'] })
      assign.mutate(art.id)
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCardArt(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['card-arts'] })
      if (current?.includes(id)) assign.mutate(null)
    },
  })
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const errorText = (err: unknown) => {
    const code = err instanceof ApiError ? err.message : ''
    return (
      {
        not_image: t('That file is not an image we can use (JPG, PNG, WebP or GIF).'),
        too_big: t('Image too large (up to 6 MB).'),
        too_many: t('You reached the limit of uploaded arts. Delete one to send another.'),
      } as Record<string, string>
    )[code] ?? (err instanceof Error ? err.message : '')
  }
  const busy = upload.isPending || assign.isPending
  const arts = library.data?.arts ?? []

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('Custom art')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col rounded-xl border border-line bg-ink"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-2xl">{t('Custom art')}</h2>
          <span className="truncate text-sm text-parchment/60">{card.name}</span>
          <button onClick={onClose} aria-label={t('Close')} className="ml-auto rounded p-1 text-parchment/60 hover:text-parchment">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {!save ? (
          <p className="p-6 text-center text-sm text-parchment/60">{t('Save the deck first to give its cards custom art.')}</p>
        ) : (
          <div className="grid min-h-0 gap-5 overflow-y-auto p-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <div className="space-y-3">
              <img src={current || card.image} alt={card.name} className="aspect-[488/680] w-full rounded-[4.5%] bg-surface object-cover" />
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
              <button
                onClick={() => file.current?.click()}
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
              >
                <ImagePlus className="h-4 w-4" aria-hidden />
                {upload.isPending ? t('Sending…') : t('Upload image')}
              </button>
              {current && (
                <button
                  onClick={() => assign.mutate(null)}
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:border-parchment/40 disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  {t('Use the original art')}
                </button>
              )}
              {(upload.isError || assign.isError || remove.isError) && (
                <p className="text-sm text-red-400">{errorText(upload.error ?? assign.error ?? remove.error)}</p>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs text-parchment/55">
                {note ??
                  t('The image is cropped to the card’s shape. Other players see it at the table and on the deck page: no offensive images.')}
              </p>
              <h3 className="text-xs font-semibold tracking-wide text-parchment/60 uppercase">
                {t('Your uploaded arts')}{' '}
                {library.data && (
                  <span className="text-parchment/40">
                    ({arts.length}/{library.data.max})
                  </span>
                )}
              </h3>
              {library.isPending && <p className="text-sm text-parchment/50">{t('Loading…')}</p>}
              {library.data && arts.length === 0 && <p className="text-sm text-parchment/50">{t('No arts uploaded yet.')}</p>}
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
                {arts.map((a) => {
                  const chosen = !!current?.includes(a.id)
                  return (
                    <li key={a.id} className="group relative">
                      <button
                        onClick={() => assign.mutate(a.id)}
                        disabled={busy}
                        title={t('Use this art')}
                        className={`block w-full overflow-hidden rounded-[4.5%] ring-2 transition ${
                          chosen ? 'ring-gold' : 'ring-transparent hover:ring-parchment/40'
                        }`}
                      >
                        <img src={a.url} alt="" loading="lazy" className="aspect-[488/680] w-full bg-surface object-cover" />
                      </button>
                      <button
                        onClick={() => remove.mutate(a.id)}
                        aria-label={t('Delete this art')}
                        title={t('Delete this art')}
                        className="absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-ink/85 text-parchment/70 opacity-0 ring-1 ring-line transition group-hover:opacity-100 hover:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
