import { useEffect, useRef, type RefObject } from 'react'
import { CARD_H, CARD_W, MAX_ZOOM, paint, type ArtFrame } from '../../lib/cardRender'

type Box = { x: number; y: number; w: number; h: number }
type Sized = { width: number; height: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * Prévia da carta num canvas em 2×. Com uma imagem, arrastar dentro de `box` (a área da arte, em
 * medidas de carta) escolhe a parte que aparece e a roda do mouse dá zoom.
 */
export function CardPreview({
  canvasRef,
  draw,
  version,
  image,
  box,
  frame,
  onFrame,
  label,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  draw: (ctx: CanvasRenderingContext2D) => void
  /** Muda quando o desenho precisa ser refeito */
  version: unknown
  image: Sized | null
  box: Box
  frame: ArtFrame
  onFrame: (frame: ArtFrame) => void
  label: string
}) {
  const drag = useRef<{ x: number; y: number; frame: ArtFrame } | null>(null)
  const latest = useRef({ frame, onFrame, image, box })
  latest.current = { frame, onFrame, image, box }

  useEffect(() => {
    if (canvasRef.current) paint(canvasRef.current, draw)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` resume tudo o que o desenho usa
  }, [version])

  /** Pixels da tela → medidas de carta */
  const toCard = (canvas: HTMLCanvasElement, dx: number, dy: number) => {
    const r = canvas.getBoundingClientRect()
    return { dx: (dx * CARD_W) / r.width, dy: (dy * CARD_H) / r.height }
  }

  /** Quanto a imagem passa do espaço da arte (para o arrasto andar junto com o mouse) */
  const overflow = (f: ArtFrame) => {
    const { image: img, box: b } = latest.current
    if (!img) return { ox: 0, oy: 0 }
    const scale = Math.max(b.w / img.width, b.h / img.height) * Math.max(1, f.zoom)
    return { ox: img.width * scale - b.w, oy: img.height * scale - b.h }
  }

  // Roda do mouse: zoom (listener não passivo, para a janela não rolar junto)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const wheel = (e: WheelEvent) => {
      const { frame: f, onFrame: set, image: img } = latest.current
      if (!img) return
      e.preventDefault()
      set({ ...f, zoom: clamp(f.zoom * (1 - e.deltaY * 0.0015), 1, MAX_ZOOM) })
    }
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => canvas.removeEventListener('wheel', wheel)
  }, [canvasRef])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className={`mx-auto w-56 touch-none rounded-[4.5%] shadow-lg shadow-black/50 select-none sm:w-full ${image ? 'cursor-grab active:cursor-grabbing' : ''}`}
      onPointerDown={(e) => {
        if (!image) return
        const canvas = e.currentTarget
        const r = canvas.getBoundingClientRect()
        const cx = ((e.clientX - r.left) * CARD_W) / r.width
        const cy = ((e.clientY - r.top) * CARD_H) / r.height
        if (cx < box.x || cx > box.x + box.w || cy < box.y || cy > box.y + box.h) return
        canvas.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, frame }
      }}
      onPointerMove={(e) => {
        const start = drag.current
        if (!start) return
        const { dx, dy } = toCard(e.currentTarget, e.clientX - start.x, e.clientY - start.y)
        const { ox, oy } = overflow(start.frame)
        onFrame({
          ...start.frame,
          x: ox > 0 ? clamp(start.frame.x - (2 * dx) / ox, -1, 1) : 0,
          y: oy > 0 ? clamp(start.frame.y - (2 * dy) / oy, -1, 1) : 0,
        })
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    />
  )
}
