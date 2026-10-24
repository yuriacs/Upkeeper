import { ImagePlus, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { COLOR_NAMES } from '../../lib/colors'
import { useT } from '../../lib/i18n'
import {
  artBox,
  CARD_COLORS,
  CENTERED_ART,
  drawCard,
  loadCardFonts,
  loadImageFile,
  MAX_ZOOM,
  type ArtFrame,
  type CardSpec,
} from '../../lib/cardRender'
import { ColorIdentity, ManaCost } from '../Mana'
import { CardPreview } from './CardPreview'
import { inputClass, labelClass } from './styles'

/** Símbolos da barra do texto (os mais usados nas fichas e cartas) */
const SYMBOLS = ['T', 'Q', 'W', 'U', 'B', 'R', 'G', 'C', 'X', '1', '2', '3', 'E']


/** As fontes da carta (nome em Spectral, texto em MPlantin, símbolos): o desenho espera por elas */
function useCardFonts() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    loadCardFonts().then(() => setReady(true))
  }, [])
  return ready
}

/** Enviar/trocar/tirar a imagem e enquadrá-la (zoom e posição); arrastar na prévia faz o mesmo */
export function ArtControls({
  image,
  frame,
  onFrame,
  onImage,
  hint,
}: {
  image: ImageBitmap | null
  frame: ArtFrame
  onFrame: (frame: ArtFrame) => void
  onImage: (image: ImageBitmap | null) => void
  hint?: ReactNode
}) {
  const t = useT()
  const file = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const slider = (label: string, value: number, min: number, max: number, set: (v: number) => void) => (
    <label className="flex items-center gap-2 text-xs text-parchment/60">
      <span className="w-20 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="w-full accent-gold"
      />
    </label>
  )
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            setError('')
            const bitmap = await loadImageFile(f)
            if (!bitmap) setError(t('That file is not an image we can use (JPG, PNG, WebP or GIF).'))
            else {
              onImage(bitmap)
              onFrame(CENTERED_ART)
            }
          }}
        />
        <button
          onClick={() => file.current?.click()}
          className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40"
        >
          <ImagePlus className="h-4 w-4" aria-hidden />
          {image ? t('Change image') : t('Add an image')}
        </button>
        {image && (
          <>
            <button
              onClick={() => onFrame(CENTERED_ART)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-parchment/60 hover:text-parchment"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t('Reset framing')}
            </button>
            <button
              onClick={() => onImage(null)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-parchment/60 hover:text-parchment"
            >
              <X className="h-4 w-4" aria-hidden />
              {t('Remove image')}
            </button>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {image && (
        <div className="space-y-1">
          {slider(t('Zoom'), frame.zoom, 1, MAX_ZOOM, (zoom) => onFrame({ ...frame, zoom }))}
          {slider(t('Horizontal'), frame.x, -1, 1, (x) => onFrame({ ...frame, x }))}
          {slider(t('Vertical'), frame.y, -1, 1, (y) => onFrame({ ...frame, y }))}
          <p className="text-xs text-parchment/40">{hint ?? t('Drag the image on the preview to frame it; the mouse wheel zooms.')}</p>
        </div>
      )}
    </div>
  )
}

/**
 * Editor de carta (como o mtgcardbuilder): a prévia desenhada no formato das cartas atuais e os
 * campos ao lado. O texto aceita símbolos de mana ({T}, {W}, {2}...) e texto de lembrete entre
 * parênteses. Serve às fichas personalizadas e, com layout "card", a um criador de cartas.
 */
export function CardEditor({
  spec,
  onSpec,
  image,
  onImage,
  canvasRef,
  footer,
}: {
  spec: CardSpec
  onSpec: (spec: CardSpec) => void
  image: ImageBitmap | null
  onImage: (image: ImageBitmap | null) => void
  canvasRef: RefObject<HTMLCanvasElement | null>
  /** Abaixo dos campos (aviso e botão de salvar) */
  footer?: ReactNode
}) {
  const t = useT()
  const fonts = useCardFonts()
  const text = useRef<HTMLTextAreaElement>(null)
  const set = <K extends keyof CardSpec>(k: K, v: CardSpec[K]) => onSpec({ ...spec, [k]: v })
  const toggleColor = (c: CardSpec['colors'][number]) =>
    set(
      'colors',
      spec.colors.includes(c) ? spec.colors.filter((x) => x !== c) : CARD_COLORS.filter((x) => x === c || spec.colors.includes(x)),
    )
  /** Põe o símbolo onde está o cursor do texto */
  const insert = (code: string) => {
    const el = text.current
    const at = el ? el.selectionStart : spec.text.length
    const end = el ? el.selectionEnd : at
    const sym = `{${code}}`
    set('text', spec.text.slice(0, at) + sym + spec.text.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + sym.length, at + sym.length)
    })
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="space-y-3">
        <CardPreview
          canvasRef={canvasRef}
          draw={(ctx) => drawCard(ctx, spec, image)}
          version={[spec, image, fonts]}
          image={image}
          box={artBox(spec)}
          frame={spec.art}
          onFrame={(art) => set('art', art)}
          label={t('Card preview')}
        />
        <ArtControls image={image} frame={spec.art} onFrame={(art) => set('art', art)} onImage={onImage} />
      </div>
      <div className="space-y-3">
        <label className={labelClass}>
          {t('Name')}
          <input value={spec.name} maxLength={80} onChange={(e) => set('name', e.target.value)} className={inputClass} />
        </label>
        {spec.layout === 'card' && (
          <label className={labelClass}>
            {t('Mana cost')}
            <input
              value={spec.manaCost}
              maxLength={40}
              onChange={(e) => set('manaCost', e.target.value)}
              placeholder="{2}{U}{U}"
              className={inputClass}
            />
          </label>
        )}
        <label className={labelClass}>
          {t('Type')}
          <input
            value={spec.type}
            maxLength={60}
            onChange={(e) => set('type', e.target.value)}
            placeholder="Creature — Cat Soldier"
            className={inputClass}
          />
        </label>
        <div className={labelClass}>
          {t('Colors')}
          <div className="flex flex-wrap gap-1.5">
            {CARD_COLORS.map((c) => (
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
        <div className={labelClass}>
          <label htmlFor="card-editor-text">{t('Text')}</label>
          <div className="flex flex-wrap gap-1" role="toolbar" aria-label={t('Insert a mana symbol')}>
            {SYMBOLS.map((s) => (
              <button
                key={s}
                onClick={() => insert(s)}
                title={`{${s}}`}
                aria-label={t('Insert {symbol}', { symbol: `{${s}}` })}
                className="grid h-7 w-7 place-items-center rounded-md border border-line text-base hover:border-gold"
              >
                <ManaCost cost={`{${s}}`} />
              </button>
            ))}
          </div>
          <textarea
            id="card-editor-text"
            ref={text}
            value={spec.text}
            maxLength={600}
            rows={4}
            onChange={(e) => set('text', e.target.value)}
            placeholder={t('Flying, lifelink…')}
            className={inputClass}
          />
          <p className="font-normal text-parchment/40">
            {t('Symbols are written like {T} or {2}{U}; text in (parentheses) comes out in italics, like reminder text.')}
          </p>
        </div>
        <label className={labelClass}>
          {t('Flavor text')}
          <textarea
            value={spec.flavor}
            maxLength={300}
            rows={2}
            onChange={(e) => set('flavor', e.target.value)}
            className={`${inputClass} italic`}
          />
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className={labelClass}>
            {t('Power')}
            <input value={spec.power} maxLength={4} onChange={(e) => set('power', e.target.value)} className={`${inputClass} w-20`} />
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
          <label className={`${labelClass} min-w-40 flex-1`}>
            {t('Artist')}
            <input value={spec.artist} maxLength={40} onChange={(e) => set('artist', e.target.value)} className={inputClass} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-parchment/60">
          <span className="shrink-0">{t('Text size')}</span>
          <input
            type="range"
            min={0.6}
            max={1.4}
            step={0.05}
            value={spec.fontScale}
            onChange={(e) => set('fontScale', Number(e.target.value))}
            className="w-full accent-gold"
          />
        </label>
        {footer}
      </div>
    </div>
  )
}
