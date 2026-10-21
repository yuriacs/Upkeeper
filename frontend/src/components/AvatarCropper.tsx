import { Minus, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { useT } from '../lib/i18n'

/** Lado da área de recorte na tela (px) e da imagem que vai para o servidor */
const VIEW = 288
const OUT = 512
const MAX_ZOOM = 4

type Pos = { x: number; y: number }

/**
 * Antes de enviar a foto de perfil: arrastar para escolher o pedaço e aproximar (barra, roda do
 * mouse, +/− ou as setas do teclado). O círculo mostra como ela fica na mesa. Sai um quadrado de
 * 512 px, desenhado no navegador; o servidor só confere e reduz.
 */
export default function AvatarCropper({
  file,
  onCancel,
  onConfirm,
}: {
  file: File
  onCancel: () => void
  onConfirm: (photo: File) => void
}) {
  const t = useT()
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(1) // 1 = a foto cobre o quadrado inteiro
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 }) // canto da foto dentro do quadrado
  const drag = useRef<{ start: Pos; from: Pos } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    let alive = true // depois da limpeza (outro arquivo, ou o efeito rodando de novo), ignora
    image.onload = () => {
      if (!alive) return
      setImg(image)
      setFailed(false)
      setZoom(1)
      const s = cover(image)
      setPos({ x: (VIEW - image.naturalWidth * s) / 2, y: (VIEW - image.naturalHeight * s) / 2 })
    }
    image.onerror = () => alive && setFailed(true)
    image.src = url
    return () => {
      alive = false
      URL.revokeObjectURL(url)
    }
  }, [file])
  useEffect(() => {
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onCancel])

  const scale = img ? cover(img) * zoom : 1
  const w = img ? img.naturalWidth * scale : VIEW
  const h = img ? img.naturalHeight * scale : VIEW
  /** A foto sempre cobre o quadrado (sem sobrar fundo vazio) */
  const clamp = (p: Pos, width = w, height = h): Pos => ({
    x: Math.min(0, Math.max(VIEW - width, p.x)),
    y: Math.min(0, Math.max(VIEW - height, p.y)),
  })
  /** Aproximar mantendo o centro do quadrado no mesmo ponto da foto */
  const zoomTo = (next: number) => {
    if (!img) return
    const z = Math.min(MAX_ZOOM, Math.max(1, next))
    const s2 = cover(img) * z
    const cx = (VIEW / 2 - pos.x) / scale
    const cy = (VIEW / 2 - pos.y) / scale
    setZoom(z)
    setPos(clamp({ x: VIEW / 2 - cx * s2, y: VIEW / 2 - cy * s2 }, img.naturalWidth * s2, img.naturalHeight * s2))
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
    canvas.width = canvas.height = OUT
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const k = OUT / VIEW
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, pos.x * k, pos.y * k, w * k, h * k)
    canvas.toBlob((blob) => blob && onConfirm(new File([blob], 'avatar.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.92)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-label={t('Adjust your photo')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-ink p-4"
      >
        <div className="flex items-center gap-3">
          <h2 className="font-display text-2xl">{t('Adjust your photo')}</h2>
          <button onClick={onCancel} aria-label={t('Close')} className="ml-auto rounded p-1 text-parchment/60 hover:text-parchment">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {failed ? (
          <p className="text-sm text-red-400">{t('That file is not an image we can use (JPG, PNG, WebP or GIF).')}</p>
        ) : (
          <>
            <p className="text-sm text-parchment/60">{t('Drag to choose the part that shows and zoom in or out. The circle is how it looks at the table.')}</p>
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
              style={{ width: VIEW, height: VIEW }}
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
              {/* Fora do círculo fica escuro: o que aparece na mesa é o círculo */}
              <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(0,0,0,0.55)] ring-2 ring-gold/70" />
            </div>
            <div className="flex items-center gap-3">
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
            {t('Use this photo')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Escala em que a foto cobre o quadrado inteiro (o lado menor encosta nas bordas) */
function cover(img: HTMLImageElement) {
  return VIEW / Math.min(img.naturalWidth, img.naturalHeight)
}
