import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { COLOR_NAMES } from '../../lib/colors'
import { CUSTOM_TOKENS_KEY } from '../../lib/customTokens'
import { useT } from '../../lib/i18n'
import { drawToken, loadTokenFonts, TOKEN_COLORS, TOKEN_H, TOKEN_W, type TokenSpec } from '../../lib/tokenCard'
import type { SavedToken } from '../../lib/tokenPicks'
import { ColorIdentity } from '../Mana'

const EMPTY: TokenSpec = { name: '', type: 'Creature — ', colors: [], text: '', power: '1', toughness: '1' }
/** Imagem grande demais para abrir no navegador sem travar (o servidor ainda reduz para 488 × 680) */
const MAX_ART = 15 * 1024 * 1024

/**
 * Fichas personalizadas (como no untap), para as que não existem no Scryfall (a Jellyfish da
 * Cynette, Jelly Drover...): nome, tipo, cores, texto, força/resistência e uma imagem opcional do
 * computador. O site desenha a carta da ficha; ela fica guardada na sua conta e aparece aqui para
 * criar de novo em qualquer partida (e os atalhos de carta a acham pelo nome).
 */
export function CustomTokens({
  onCreate,
  draft,
}: {
  onCreate: (tok: SavedToken) => void
  /** Começo da ficha (atalho de carta cuja ficha não existe no Scryfall) */
  draft?: Partial<TokenSpec>
}) {
  const t = useT()
  const queryClient = useQueryClient()
  const library = useQuery({ queryKey: CUSTOM_TOKENS_KEY, queryFn: api.customTokens })
  const [spec, setSpec] = useState<TokenSpec>({ ...EMPTY, ...draft })
  const [art, setArt] = useState<ImageBitmap | null>(null)
  const [artError, setArtError] = useState('')
  const [fontsReady, setFontsReady] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadTokenFonts().then(() => setFontsReady(true))
  }, [])
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (ctx) drawToken(ctx, spec, art)
  }, [spec, art, fontsReady])

  const set = <K extends keyof TokenSpec>(k: K, v: TokenSpec[K]) => setSpec((s) => ({ ...s, [k]: v }))
  const toggleColor = (c: string) =>
    set('colors', spec.colors.includes(c) ? spec.colors.filter((x) => x !== c) : TOKEN_COLORS.filter((x) => x === c || spec.colors.includes(x)))

  const pickArt = async (f: File) => {
    setArtError('')
    if (!f.type.startsWith('image/') || f.size > MAX_ART) {
      setArtError(t('That file is not an image we can use (JPG, PNG, WebP or GIF).'))
      return
    }
    try {
      setArt(await createImageBitmap(f))
    } catch {
      setArtError(t('That file is not an image we can use (JPG, PNG, WebP or GIF).'))
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const blob = await new Promise<Blob | null>((ok) => canvas.current?.toBlob(ok, 'image/png'))
      if (!blob) throw new Error('canvas')
      return api.uploadCustomToken(new File([blob], 'token.png', { type: 'image/png' }), {
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
  const input = 'w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm focus:border-gold focus:outline-none'
  const label = 'block space-y-1 text-xs font-semibold text-parchment/60'

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
        <h3 className="text-xs font-semibold tracking-wide text-parchment/60 uppercase">{t('New custom token')}</h3>
        <div className="grid gap-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
          <canvas
            ref={canvas}
            width={TOKEN_W}
            height={TOKEN_H}
            role="img"
            aria-label={t('Token preview')}
            className="mx-auto w-52 rounded-[4.5%] sm:w-full"
          />
          <div className="space-y-3">
            <label className={label}>
              {t('Name')}
              <input value={spec.name} maxLength={80} onChange={(e) => set('name', e.target.value)} className={input} />
            </label>
            <label className={label}>
              {t('Type')}
              <input
                value={spec.type}
                maxLength={60}
                onChange={(e) => set('type', e.target.value)}
                placeholder="Creature — Cat Soldier"
                className={input}
              />
            </label>
            <div className={label}>
              {t('Colors')}
              <div className="flex flex-wrap gap-1.5">
                {TOKEN_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => toggleColor(c)}
                    aria-pressed={spec.colors.includes(c)}
                    title={t(COLOR_NAMES[c])}
                    className={`rounded-full p-1 ring-2 transition ${spec.colors.includes(c) ? 'ring-gold' : 'opacity-50 ring-transparent hover:opacity-100'}`}
                  >
                    <ColorIdentity colors={c} />
                  </button>
                ))}
                {spec.colors.length === 0 && <span className="self-center text-parchment/40">{t('Colorless')}</span>}
              </div>
            </div>
            <label className={label}>
              {t('Text')}
              <textarea
                value={spec.text}
                maxLength={300}
                rows={3}
                onChange={(e) => set('text', e.target.value)}
                placeholder={t('Flying, lifelink…')}
                className={input}
              />
            </label>
            <div className="flex gap-3">
              <label className={label}>
                {t('Power')}
                <input value={spec.power} maxLength={4} onChange={(e) => set('power', e.target.value)} className={`${input} w-20`} />
              </label>
              <label className={label}>
                {t('Toughness')}
                <input
                  value={spec.toughness}
                  maxLength={4}
                  onChange={(e) => set('toughness', e.target.value)}
                  className={`${input} w-20`}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={file}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) pickArt(f)
                  e.target.value = ''
                }}
              />
              <button
                onClick={() => file.current?.click()}
                className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40"
              >
                <ImagePlus className="h-4 w-4" aria-hidden />
                {art ? t('Change image') : t('Add an image')}
              </button>
              {art && (
                <button
                  onClick={() => setArt(null)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-parchment/60 hover:text-parchment"
                >
                  <X className="h-4 w-4" aria-hidden />
                  {t('Remove image')}
                </button>
              )}
            </div>
            {artError && <p className="text-sm text-red-400">{artError}</p>}
            <p className="text-xs text-parchment/45">
              {t('The token is saved in your account to use in any game. Other players see it: no offensive images.')}
            </p>
            {saveError && <p className="text-sm text-red-400">{saveError}</p>}
            <button
              onClick={() => save.mutate()}
              disabled={!spec.name.trim() || save.isPending}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
            >
              {save.isPending ? t('Saving…') : t('Save and create')}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

const toSaved = (tok: { url: string; name?: string; power?: string; toughness?: string }): SavedToken => ({
  name: tok.name || 'Token',
  image: tok.url,
  small: tok.url,
  power: tok.power || undefined,
  toughness: tok.toughness || undefined,
})
