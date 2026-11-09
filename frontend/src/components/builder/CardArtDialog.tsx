import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { useT } from '../../lib/i18n'
import type { CardArtItem, CardFace, DeckArts } from '../../lib/types'

/**
 * Arte personalizada de uma carta do deck ou de uma ficha (como no untap): escolher uma das artes
 * daquela carta (enviadas por qualquer pessoa, as mais usadas primeiro) ou enviar uma nova, que
 * fica disponível para todos nessa carta. O servidor recorta na proporção da carta e tira os
 * metadados da foto. Quem enviou não aparece; só essa pessoa apaga a arte. Carta de duas faces
 * (com `card.back` e `currentBack`): abas Frente e Verso, cada face com as artes dela.
 */
export default function CardArtDialog({
  card,
  assign: save,
  note,
  current: currentFront,
  currentBack,
  variants,
  onChange,
  onClose,
}: {
  /** `back`: imagem do verso (cartas de duas faces); com ela, dá para escolher a arte do verso */
  card: { name: string; image: string; oracleId: string; back?: string }
  /** Grava a arte escolhida (null = a original) na face pedida. Sem ela: deck ainda não salvo */
  assign?: (art: string | null, face: CardFace) => Promise<DeckArts>
  /** Onde a arte aparece (o padrão é o das cartas do deck) */
  note?: string
  current?: string
  /** Arte do verso escolhida agora */
  currentBack?: string
  /** Quantas artes a carta usa no deck (uma por cópia); escolher uma aqui troca todas */
  variants?: number
  onChange: (res: DeckArts) => void
  onClose: () => void
}) {
  const t = useT()
  const queryClient = useQueryClient()
  const file = useRef<HTMLInputElement>(null)
  const [face, setFace] = useState<CardFace>('front')
  const twoFaced = !!card.back
  const current = face === 'back' ? currentBack : currentFront
  const original = face === 'back' && card.back ? card.back : card.image
  const gallery = useQuery({
    queryKey: ['card-arts', card.oracleId, face],
    queryFn: () => api.cardArts(card.oracleId, face),
    enabled: !!save,
  })
  const assign = useMutation({
    mutationFn: (art: string | null) => save!(art, face),
    onSuccess: (res) => {
      onChange(res)
      // A ordem (mais usadas) e as artes antigas que ganharam esta carta mudam
      queryClient.invalidateQueries({ queryKey: ['card-arts', card.oracleId] })
    },
  })
  const upload = useMutation({
    mutationFn: (f: File) => api.uploadCardArt(f, card.oracleId, face),
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
        uploads_blocked: t('An admin blocked image uploads from this account after a report.'),
      } as Record<string, string>
    )[code] ?? (err instanceof Error ? err.message : '')
  }
  const busy = upload.isPending || assign.isPending
  const arts = gallery.data?.arts ?? []
  const loose = gallery.data?.loose ?? []
  const tile = (a: CardArtItem) => {
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
        {a.mine && (
          <button
            onClick={() => remove.mutate(a.id)}
            aria-label={t('Delete this art')}
            title={t('Delete this art (it disappears for everyone using it)')}
            className="absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-ink/85 text-parchment/70 opacity-0 ring-1 ring-line transition group-hover:opacity-100 hover:text-red-300 focus-visible:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </li>
    )
  }

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

        {save && twoFaced && (
          <div role="tablist" aria-label={t('Card face')} className="flex gap-1 border-b border-line px-4 pt-3">
            {(['front', 'back'] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={face === f}
                onClick={() => {
                  setFace(f)
                  upload.reset()
                  assign.reset()
                  remove.reset()
                }}
                className={`-mb-px rounded-t-md border px-3 py-1.5 text-sm ${
                  face === f ? 'border-line border-b-ink bg-ink text-gold' : 'border-transparent text-parchment/60 hover:text-parchment'
                }`}
              >
                {f === 'front' ? t('Front face') : t('Back face')}
                {(f === 'front' ? currentFront : currentBack) && <span className="ml-1.5 text-gold" aria-hidden>•</span>}
              </button>
            ))}
          </div>
        )}
        {!save ? (
          <p className="p-6 text-center text-sm text-parchment/60">{t('Save the deck first to give its cards custom art.')}</p>
        ) : (
          <div className="grid min-h-0 gap-5 overflow-y-auto p-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <div className="space-y-3">
              <img src={current || original} alt={card.name} className="aspect-[488/680] w-full rounded-[4.5%] bg-surface object-cover" />
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
              {face === 'back' && (
                <p className="text-xs text-parchment/60">{t('Shows when the card is turned to its back at the table, and on the back in the deckbuilder.')}</p>
              )}
              {face === 'front' && !!variants && variants > 1 && (
                <p className="text-xs text-parchment/60">
                  {t('This card uses {n} different arts in the deck, one per copy. Picking one here puts it on every copy.', { n: variants })}
                </p>
              )}
              {(upload.isError || assign.isError || remove.isError) && (
                <p className="text-sm text-red-400">{errorText(upload.error ?? assign.error ?? remove.error)}</p>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs text-parchment/55">
                {note ??
                  t('The image is cropped to the card’s shape. Other players see it at the table and on the deck page: no offensive images.')}{' '}
                {t('Arts you upload stay available to everyone for this card.')}
              </p>
              <h3 className="text-xs font-semibold tracking-wide text-parchment/60 uppercase">
                {face === 'back' ? t('Arts for the back of this card') : t('Arts for this card')}{' '}
                {gallery.data && (
                  <span className="font-normal tracking-normal text-parchment/40 normal-case">
                    {t('(you uploaded {n} of {max})', { n: gallery.data.mine, max: gallery.data.max })}
                  </span>
                )}
              </h3>
              {gallery.isPending && <p className="text-sm text-parchment/50">{t('Loading…')}</p>}
              {gallery.data && arts.length === 0 && (
                <p className="text-sm text-parchment/50">{t('No arts for this card yet. Be the first to upload one.')}</p>
              )}
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">{arts.map(tile)}</ul>
              {loose.length > 0 && (
                <>
                  <h3 className="pt-2 text-xs font-semibold tracking-wide text-parchment/60 uppercase">{t('Your older arts')}</h3>
                  <p className="text-xs text-parchment/45">{t('Sent before arts belonged to a card: the one you pick joins this card.')}</p>
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">{loose.map(tile)}</ul>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
