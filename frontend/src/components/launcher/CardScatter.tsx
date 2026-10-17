import { useState, type CSSProperties } from 'react'
import { HOME_ART } from '@/lib/homeArt'

/** Lugares das cartas no fundo (% da capa): espalhadas, mais concentradas à direita */
const SLOTS = [
  { x: 4, y: 58, r: -14 },
  { x: 16, y: 8, r: 9 },
  { x: 30, y: 62, r: -6 },
  { x: 42, y: 14, r: 12 },
  { x: 52, y: 60, r: -11 },
  { x: 62, y: 4, r: 6 },
  { x: 70, y: 52, r: 15 },
  { x: 80, y: 12, r: -8 },
  { x: 88, y: 56, r: 10 },
  { x: 95, y: 6, r: -13 },
]

/**
 * Fundo da capa: cartas de comandantes sorteadas a cada visita, espalhadas e inclinadas,
 * apagadas para não brigar com o título. Imagens salvas no próprio site; baixam depois do resto.
 */
export default function CardScatter({ className = '' }: { className?: string }) {
  const items = HOME_ART
  const [seed] = useState(() => Math.random())
  if (!items.length) return null
  const start = Math.floor(seed * items.length)
  const cards = SLOTS.map((slot, i) => ({ ...slot, card: items[(start + i * 13) % items.length].card }))

  return (
    <div aria-hidden className={`card-scatter pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {cards.map((c, i) => (
        <img
          key={i}
          src={c.card}
          alt=""
          loading="lazy"
          fetchPriority="low"
          decoding="async"
          onError={(e) => (e.currentTarget.style.display = 'none')}
          className="scatter-card absolute w-[clamp(120px,13vw,230px)] rounded-[4.5%]"
          style={{ left: `${c.x}%`, top: `${c.y}%`, '--r': `${c.r}deg`, '--d': `${i * 0.6}s` } as CSSProperties}
        />
      ))}
      {/* Escurece em volta e atrás do texto, deixando as cartas como pano de fundo */}
      <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/55 to-ink/20" />
      <div className="absolute inset-0 bg-gradient-to-b from-ink/70 via-transparent to-ink" />
    </div>
  )
}
