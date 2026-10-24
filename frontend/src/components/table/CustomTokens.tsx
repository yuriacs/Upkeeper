import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { canvasBlob, CENTERED_ART, drawReadyCard, EMPTY_TOKEN, type ArtFrame, type CardSpec } from '../../lib/cardRender'
import { CUSTOM_TOKENS_KEY } from '../../lib/customTokens'
import { useT } from '../../lib/i18n'
import type { SavedToken } from '../../lib/tokenPicks'
import { ArtControls, CardEditor } from '../cardEditor/CardEditor'
import { CardPreview } from '../cardEditor/CardPreview'
import { inputClass, labelClass } from '../cardEditor/styles'

type Mode = 'build' | 'ready'
const FULL_CARD = { x: 0, y: 0, w: 488, h: 680 }

/**
 * Fichas personalizadas (como no untap), para as que não existem no Scryfall (a Jellyfish da
 * Cynette, Jelly Drover...). Dois jeitos: montar no editor (a carta desenhada no formato das
 * fichas atuais, com símbolos de mana e arte enquadrada) ou enviar a imagem de uma ficha já pronta
 * feita em outro lugar. A ficha fica guardada na sua conta e aparece aqui para criar de novo em
 * qualquer partida (e os atalhos de carta a acham pelo nome).
 */
export function CustomTokens({
  onCreate,
  draft,
}: {
  onCreate: (tok: SavedToken) => void
  /** Começo da ficha (atalho de carta cuja ficha não existe no Scryfall) */
  draft?: Partial<CardSpec>
}) {
  const t = useT()
  const queryClient = useQueryClient()
  const library = useQuery({ queryKey: CUSTOM_TOKENS_KEY, queryFn: api.customTokens })
  const [mode, setMode] = useState<Mode>('build')
  const [spec, setSpec] = useState<CardSpec>({ ...EMPTY_TOKEN, ...draft })
  const [art, setArt] = useState<ImageBitmap | null>(null)
  // Ficha pronta: a imagem inteira e o enquadramento dela (nome e P/T vêm do mesmo spec)
  const [ready, setReady] = useState<ImageBitmap | null>(null)
  const [readyFrame, setReadyFrame] = useState<ArtFrame>(CENTERED_ART)
  const canvas = useRef<HTMLCanvasElement>(null)

  const save = useMutation({
    mutationFn: async () => {
      const blob = canvas.current && (await canvasBlob(canvas.current))
      if (!blob) throw new Error('canvas')
      const ext = blob.type === 'image/webp' ? 'webp' : 'png'
      return api.uploadCustomToken(new File([blob], `token.${ext}`, { type: blob.type }), {
        name: spec.name.trim(),
        power: spec.power.trim(),
        toughness: spec.toughness.trim(),
      })
    },
    onSuccess: (tok) => {
      queryClient.invalidateQueries({ queryKey: CUSTOM_TOKENS_KEY })
      onCreate(toSaved(tok))
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCardArt(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CUSTOM_TOKENS_KEY }),
  })

  const code = save.error instanceof ApiError ? save.error.message : ''
  const saveError = save.isError
    ? code === 'too_many'
      ? t('You reached the limit of custom tokens. Delete one to make another.')
      : code === 'uploads_blocked'
        ? t('An admin blocked image uploads from this account after a report.')
        : t('Could not save the token. Try again.')
    : ''
  const tokens = library.data?.arts ?? []
  const set = <K extends keyof CardSpec>(k: K, v: CardSpec[K]) => setSpec((s) => ({ ...s, [k]: v }))
  const canSave = !!spec.name.trim() && (mode === 'build' || !!ready) && !save.isPending

  const footer = (
    <div className="space-y-2">
      <p className="text-xs text-parchment/45">
        {t('The token is saved in your account to use in any game. Other players see it: no offensive images.')}
      </p>
      {saveError && <p className="text-sm text-red-400">{saveError}</p>}
      <button
        onClick={() => save.mutate()}
        disabled={!canSave}
        className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
      >
        {save.isPending ? t('Saving…') : t('Save and create')}
      </button>
    </div>
  )

  return (
    <div className="space-y-5 overflow-y-auto p-4">
      {tokens.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-parchment/60 uppercase">
            {t('Your custom tokens')}{' '}
            <span className="text-parchment/40">
              ({tokens.length}/{library.data?.max})
            </span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {tokens.map((tok) => (
              <div key={tok.id} className="group relative w-[110px]">
                <button onClick={() => onCreate(toSaved(tok))} title={tok.name} className="block w-full">
                  <img src={tok.url} alt={tok.name} loading="lazy" className="w-full rounded-[6%] hover:ring-2 hover:ring-gold" />
                </button>
                <button
                  onClick={() => remove.mutate(tok.id)}
                  aria-label={t('Delete {name}', { name: tok.name ?? '' })}
                  title={t('Delete {name}', { name: tok.name ?? '' })}
                  className="absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-ink/85 text-parchment/70 opacity-0 ring-1 ring-line transition group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-parchment/60 uppercase">{t('New custom token')}</h3>
          <div role="tablist" className="flex gap-1">
            {(['build', 'ready'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  mode === m ? 'border-gold bg-gold/15 text-gold' : 'border-line text-parchment/60 hover:text-parchment'
                }`}
              >
                {m === 'build' ? t('Build in the editor') : t('Upload a finished token')}
              </button>
            ))}
          </div>
        </div>

        {mode === 'build' ? (
          <CardEditor spec={spec} onSpec={setSpec} image={art} onImage={setArt} canvasRef={canvas} footer={footer} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-[15rem_minmax(0,1fr)]">
            <div className="space-y-3">
              <CardPreview
                canvasRef={canvas}
                draw={(ctx) => (ready ? drawReadyCard(ctx, ready, readyFrame) : emptySlot(ctx))}
                version={[ready, readyFrame]}
                image={ready}
                box={FULL_CARD}
                frame={readyFrame}
                onFrame={setReadyFrame}
                label={t('Card preview')}
              />
              {!ready && (
                <p className="text-center text-xs text-parchment/45">
                  {t('Send the image of a whole token card (from another card maker, for example).')}
                </p>
              )}
              <ArtControls
                image={ready}
                frame={readyFrame}
                onFrame={setReadyFrame}
                onImage={setReady}
                hint={t('Fit the card to the frame: drag it on the preview; the mouse wheel zooms.')}
              />
            </div>
            <div className="space-y-3">
              <p className="text-sm text-parchment/60">
                {t('The name and power/toughness are what the table uses (the image is not read).')}
              </p>
              <label className={labelClass}>
                {t('Name')}
                <input value={spec.name} maxLength={80} onChange={(e) => set('name', e.target.value)} className={inputClass} />
              </label>
              <div className="flex gap-3">
                <label className={labelClass}>
                  {t('Power')}
                  <input
                    value={spec.power}
                    maxLength={4}
                    onChange={(e) => set('power', e.target.value)}
                    className={`${inputClass} w-20`}
                  />
                </label>
                <label className={labelClass}>
                  {t('Toughness')}
                  <input
                    value={spec.toughness}
                    maxLength={4}
                    onChange={(e) => set('toughness', e.target.value)}
                    className={`${inputClass} w-20`}
                  />
                </label>
              </div>
              {footer}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

/** Lugar da ficha pronta antes de escolher a imagem: contorno tracejado no formato da carta */
function emptySlot(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, FULL_CARD.w, FULL_CARD.h)
  ctx.fillStyle = '#141414'
  ctx.beginPath()
  ctx.roundRect(0, 0, FULL_CARD.w, FULL_CARD.h, 22)
  ctx.fill()
  ctx.setLineDash([14, 10])
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(232,226,212,0.3)'
  ctx.beginPath()
  ctx.roundRect(14, 14, FULL_CARD.w - 28, FULL_CARD.h - 28, 16)
  ctx.stroke()
}

const toSaved = (tok: { url: string; name?: string; power?: string; toughness?: string }): SavedToken => ({
  name: tok.name || 'Token',
  image: tok.url,
  small: tok.url,
  power: tok.power || undefined,
  toughness: tok.toughness || undefined,
})
