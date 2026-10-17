import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { LogoMark } from '@/components/Logo'
import { useArts } from '@/hooks/useArts'
import { useT } from '@/lib/i18n'

/** Carta inteira em alta (672×936) a partir da arte recortada do Scryfall */
const fullCard = (artCrop: string) => artCrop.replace('/art_crop/', '/large/')

const COUNT = 9
/** Inclinação máxima ao seguir o mouse (graus) */
const TILT = 14

/**
 * Carta para analisar (no modal): inclina seguindo o mouse (com reflexo), vira ao clicar e
 * gira ao arrastar para o lado; ao soltar, para na frente ou no verso.
 */
function HandledCard({ src, name }: { src: string; name: string }) {
  const t = useT()
  const [rot, setRot] = useState(0)
  const [tilt, setTilt] = useState({ x: 0, y: 0, gx: 50, gy: 50 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null)

  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    if (drag.current) {
      const dx = e.clientX - drag.current.x
      if (Math.abs(dx) > 4) drag.current.moved = true
      setRot(drag.current.start + dx * 0.9)
      return
    }
    setTilt({ x: (0.5 - py) * TILT * 2, y: (px - 0.5) * TILT * 2, gx: px * 100, gy: py * 100 })
  }
  const end = () => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    // Clique sem arrastar vira a carta; arrastando, para no lado mais próximo
    setRot((r) => (d && !d.moved ? r + 180 : Math.round(r / 180) * 180))
  }

  const back = Math.round(rot / 180) % 2 !== 0
  return (
    <button
      type="button"
      aria-label={back ? t('Show the front of {name}', { name }) : t('Turn over {name}', { name })}
      onPointerLeave={() => {
        if (drag.current) end()
        setTilt({ x: 0, y: 0, gx: 50, gy: 50 })
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, start: rot, moved: false }
        setDragging(true)
      }}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation()
      }}
      className="handled-card absolute inset-0 touch-pan-y cursor-grab active:cursor-grabbing"
      style={
        {
          '--rx': `${tilt.x}deg`,
          '--ry': `${tilt.y + rot}deg`,
          '--gx': `${tilt.gx}%`,
          '--gy': `${tilt.gy}%`,
          transition: dragging ? 'none' : undefined,
        } as CSSProperties
      }
    >
      <span className="card-face card-front">
        <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
        <span aria-hidden className="card-glare" />
      </span>
      {/* Verso: os mesmos ornamentos do título da capa (fios dourados com losango, Cinzel) */}
      <span className="card-face card-back" aria-hidden>
        {['top-[5%] left-[7%]', 'top-[5%] right-[7%]', 'bottom-[5%] left-[7%]', 'bottom-[5%] right-[7%]'].map((pos) => (
          <span key={pos} className={`back-gem absolute ${pos}`} />
        ))}
        <span className="back-rule absolute top-[11%]">
          <span className="back-gem" />
        </span>
        <span className="flex flex-col items-center">
          <span className="back-eyebrow">Commander online</span>
          <LogoMark className="mt-[6cqw] h-[34cqw] w-[34cqw] drop-shadow-[0_0_18px_rgb(255_140_40/0.6)]" />
          <span className="back-name font-epic mt-[6cqw]">Upkeeper</span>
          <span className="back-rule mt-[4cqw]">
            <span className="back-gem" />
          </span>
        </span>
        <span className="back-rule absolute bottom-[11%]">
          <span className="back-gem" />
        </span>
        <span className="card-glare" />
      </span>
    </button>
  )
}
const INTERVAL = 3200

/** Modal que traz a carta para a frente da tela, grande, para analisar e manusear */
function CardInspector({ card, onClose }: { card: { art: string; commander: string } | null; onClose: () => void }) {
  const t = useT()
  return (
    <Dialog.Root open={!!card} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 p-4 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-75 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-50 data-[state=open]:duration-500">
          {card && (
            <>
              <Dialog.Title className="font-epic text-xl tracking-wide text-parchment sm:text-2xl">{card.commander}</Dialog.Title>
              <div className="inspect-stage relative aspect-[5/7] h-[min(72dvh,calc((100vw-2rem)*1.4))]">
                <div aria-hidden className="absolute -inset-16 -z-10 rounded-full bg-[radial-gradient(circle,rgb(236_185_63/0.3),transparent_65%)] blur-3xl" />
                <HandledCard src={fullCard(card.art)} name={card.commander} />
              </div>
              <Dialog.Description className="text-xs tracking-[0.15em] text-parchment/55 uppercase">
                {t('Move the mouse to tilt · click to turn over · drag to spin')}
              </Dialog.Description>
              <Dialog.Close
                aria-label={t('Close')}
                className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full border border-parchment/20 bg-black/50 text-parchment/80 transition hover:border-gold hover:text-gold"
              >
                <X className="h-5 w-5" aria-hidden />
              </Dialog.Close>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * Carrossel 3D de comandantes em alta definição: a carta do centro em destaque, com brilho
 * dourado, e as vizinhas inclinadas para os lados. Clicar na do centro abre ela grande, num
 * modal, para analisar (inclinar, virar, girar). Avança sozinho (para no hover e com "menos movimento"); as setas e as cartas
 * do lado trazem a carta para o centro.
 */
export default function CardCarousel({ className = '' }: { className?: string }) {
  const t = useT()
  const { items } = useArts()
  // Comandantes sorteados uma vez por visita
  const [seed] = useState(() => Math.random())
  const cards = items.length
    ? Array.from({ length: Math.min(COUNT, items.length) }, (_, i) => items[(Math.floor(seed * items.length) + i * 7) % items.length])
    : []
  const n = cards.length
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const [inspect, setInspect] = useState<{ art: string; commander: string } | null>(null)

  useEffect(() => {
    if (n < 2 || paused || !!inspect || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => setActive((a) => (a + 1) % n), INTERVAL)
    return () => window.clearInterval(id)
  }, [n, paused, inspect])

  if (!n) return <div className={className} />
  const go = (d: number) => setActive((a) => (a + d + n) % n)

  return (
    <div
      className={`relative select-none ${className}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label={t('Commanders')}
    >
      <div className="carousel-stage relative mx-auto aspect-[5/7] w-[var(--card)]">
        {/* Brilho dourado atrás da carta do centro */}
        <div aria-hidden className="absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(circle,rgb(236_185_63/0.35),transparent_65%)] blur-2xl" />
        {cards.map((c, i) => {
          // Distância até o centro, no caminho mais curto (o carrossel dá a volta)
          let off = i - active
          if (off > n / 2) off -= n
          if (off < -n / 2) off += n
          const abs = Math.abs(off)
          const visible = abs <= 2
          return (
            <div
              key={c.art}
              className={`carousel-card absolute inset-0 ${off === 0 ? 'is-center' : ''}`}
              style={
                {
                  '--off': off,
                  '--abs': abs,
                  zIndex: 10 - abs,
                  opacity: visible ? 1 - abs * 0.28 : 0,
                  pointerEvents: visible ? 'auto' : 'none',
                } as CSSProperties
              }
            >
              {off === 0 ? (
                <button
                  type="button"
                  aria-label={t('Inspect {name}', { name: c.commander })}
                  onClick={() => setInspect(c)}
                  className="card-face card-front absolute inset-0 cursor-zoom-in transition hover:brightness-110"
                >
                  <img src={fullCard(c.art)} alt="" draggable={false} className="h-full w-full object-cover" />
                </button>
              ) : (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={c.commander}
                  onClick={() => go(off)}
                  className="card-face absolute inset-0 cursor-pointer"
                >
                  <img
                    src={fullCard(c.art)}
                    alt=""
                    draggable={false}
                    loading={abs <= 1 ? 'eager' : 'lazy'}
                    className="h-full w-full object-cover"
                  />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Nome do comandante e controles */}
      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label={t('Previous')}
          className="grid h-8 w-8 place-items-center rounded-full border border-parchment/20 bg-black/40 text-parchment/70 backdrop-blur transition hover:border-gold hover:text-gold"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <p aria-live="polite" className="font-epic min-w-48 text-center text-sm tracking-wide text-parchment/80">
          {cards[active]?.commander}
        </p>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label={t('Next')}
          className="grid h-8 w-8 place-items-center rounded-full border border-parchment/20 bg-black/40 text-parchment/70 backdrop-blur transition hover:border-gold hover:text-gold"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <CardInspector card={inspect} onClose={() => setInspect(null)} />
    </div>
  )
}
