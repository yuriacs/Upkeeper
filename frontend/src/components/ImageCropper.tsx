import { Minus, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { useT } from '../lib/i18n'

const MAX_ZOOM = 4

type Pos = { x: number; y: number }

/**
 * Antes de enviar uma imagem: arrastar para escolher o pedaço e aproximar (barra, roda do mouse,
 * +/− ou as setas do teclado), numa moldura no formato em que ela vai aparecer. Sai uma imagem de
 * `out` px desenhada no navegador; o servidor só confere e reduz.
 */
export default function ImageCropper({
  file,
  aspect,
  out,
  round = false,
  dimPreview = false,
  title,
  help,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  file: File
  /** Largura ÷ altura da moldura (1 = quadrado; 3 = três vezes mais larga) */
  aspect: number
  /** Tamanho da imagem que sai [largura, altura] */
  out: [number, number]
  /** Círculo dentro da moldura (foto de perfil) */
  round?: boolean
  /** Opção de ver a imagem escurecida, como fica atrás das cartas na mesa */
  dimPreview?: boolean
  title: string
  help: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: (image: File) => void
}) {
  const t = useT()
  // Tamanho da moldura na tela: cabe na janela (celular) sem passar do máximo
  const [view] = useState(() => {
    const max = aspect > 1 ? 640 : 288
    const w = Math.min(max, (typeof window === 'undefined' ? max : window.innerWidth) - 64)
    return { w, h: w / aspect }
  })
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(1) // 1 = a imagem cobre a moldura inteira
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 }) // canto da imagem dentro da moldura
  const [dim, setDim] = useState(false)
  const drag = useRef<{ start: Pos; from: Pos } | null>(null)
  const cover = (image: HTMLImageElement) => Math.max(view.w / image.naturalWidth, view.h / image.naturalHeight)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    let alive = true // depois da limpeza (outro arquivo, ou o efeito rodando de novo), ignora
    image.onload = () => {
      if (!alive) return
      setImg(image)
      setFailed(false)
      setZoom(1)
      const s = Math.max(view.w / image.naturalWidth, view.h / image.naturalHeight)
      setPos({ x: (view.w - image.naturalWidth * s) / 2, y: (view.h - image.naturalHeight * s) / 2 })
    }
    image.onerror = () => alive && setFailed(true)
    image.src = url
    return () => {
      alive = false
      URL.revokeObjectURL(url)
    }
  }, [file, view])
  useEffect(() => {
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onCancel])

  const scale = img ? cover(img) * zoom : 1
  const w = img ? img.naturalWidth * scale : view.w
  const h = img ? img.naturalHeight * scale : view.h
  /** A imagem sempre cobre a moldura (sem sobrar fundo vazio) */
  const clamp = (p: Pos, width = w, height = h): Pos => ({
    x: Math.min(0, Math.max(view.w - width, p.x)),
    y: Math.min(0, Math.max(view.h - height, p.y)),
  })
  /** Aproximar mantendo o centro da moldura no mesmo ponto da imagem */
  const zoomTo = (next: number) => {
    if (!img) return
    const z = Math.min(MAX_ZOOM, Math.max(1, next))
    const s2 = cover(img) * z
    const cx = (view.w / 2 - pos.x) / scale
    const cy = (view.h / 2 - pos.y) / scale
    setZoom(z)
    setPos(clamp({ x: view.w / 2 - cx * s2, y: view.h / 2 - cy * s2 }, img.naturalWidth * s2, img.naturalHeight * s2))
  }

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { start: { x: e.clientX, y: e.clientY }, from: pos }
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    setPos(clamp({ x: d.from.x + e.clientX - d.start.x, y: d.from.y + e.clientY - d.start.y }))
  }
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 20 : 5
    const moves: Record<string, Pos> = {
      ArrowLeft: { x: step, y: 0 },
      ArrowRight: { x: -step, y: 0 },
      ArrowUp: { x: 0, y: step },
      ArrowDown: { x: 0, y: -step },
    }
    if (moves[e.key]) setPos(clamp({ x: pos.x + moves[e.key].x, y: pos.y + moves[e.key].y }))
    else if (e.key === '+' || e.key === '=') zoomTo(zoom + 0.1)
    else if (e.key === '-') zoomTo(zoom - 0.1)
    else return
    e.preventDefault()
  }

  const confirm = () => {
    if (!img) return
    const canvas = document.createElement('canvas')
    ;[canvas.width, canvas.height] = out
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const k = out[0] / view.w
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, pos.x * k, pos.y * k, w * k, h * k)
    canvas.toBlob((blob) => blob && onConfirm(new File([blob], 'image.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.92)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: view.w + 34 }}
        className="w-full space-y-4 rounded-xl border border-line bg-ink p-4"
      >
        <div className="flex items-center gap-3">
          <h2 className="font-display text-2xl">{title}</h2>
          <button onClick={onCancel} aria-label={t('Close')} className="ml-auto rounded p-1 text-parchment/60 hover:text-parchment">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {failed ? (
          <p className="text-sm text-red-400">{t('That file is not an image we can use (JPG, PNG, WebP or GIF).')}</p>
        ) : (
          <>
            <p className="text-sm text-parchment/60">{help}</p>
            <div
              tabIndex={0}
              role="application"
              aria-label={t('Photo crop area: arrow keys move, + and − zoom')}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onWheel={(e: WheelEvent<HTMLDivElement>) => zoomTo(zoom - Math.sign(e.deltaY) * 0.1)}
              onKeyDown={keys}
              style={{ width: view.w, height: view.h }}
              className="relative mx-auto cursor-grab touch-none overflow-hidden rounded-lg bg-surface select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-gold active:cursor-grabbing"
            >
              {img && (
                <img
                  src={img.src}
                  alt=""
                  draggable={false}
                  style={{ width: w, height: h, transform: `translate(${pos.x}px, ${pos.y}px)` }}
                  className="pointer-events-none absolute top-0 left-0 max-w-none"
                />
              )}
              {/* Escurecida como fica atrás das cartas na mesa */}
              {dim && <div className="pointer-events-none absolute inset-0 bg-ink/65" />}
              {round ? (
                // Fora do círculo fica escuro: o que aparece na mesa é o círculo
                <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(0,0,0,0.55)] ring-2 ring-gold/70" />
              ) : (
                <div className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-gold/70 ring-inset" />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => zoomTo(zoom - 0.25)}
                aria-label={t('Zoom out')}
                className="rounded-full border border-line p-1 hover:border-parchment/40"
              >
                <Minus className="h-4 w-4" aria-hidden />
              </button>
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => zoomTo(Number(e.target.value))}
                aria-label={t('Zoom')}
                className="min-w-0 flex-1 accent-[#ecb93f]"
              />
              <button
                onClick={() => zoomTo(zoom + 0.25)}
                aria-label={t('Zoom in')}
                className="rounded-full border border-line p-1 hover:border-parchment/40"
              >
                <Plus className="h-4 w-4" aria-hidden />
              </button>
              {dimPreview && (
                <label className="flex items-center gap-2 text-sm text-parchment/70">
                  <input type="checkbox" checked={dim} onChange={(e) => setDim(e.target.checked)} className="accent-[#ecb93f]" />
                  {t('Preview as at the table')}
                </label>
              )}
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-parchment/40">
            {t('Cancel')}
          </button>
          <button
            onClick={confirm}
            disabled={!img}
            className="rounded-lg bg-gold px-4 py-1.5 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
