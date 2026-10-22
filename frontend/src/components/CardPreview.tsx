import { useEffect, useState, type ReactNode } from 'react'
import type { Card } from '../lib/types'
import { useT } from '../lib/i18n'

/** Imagem flutuante que acompanha o mouse (só em dispositivos com hover). */
export function HoverPreview({ card, x, y }: { card: Card | null; x: number; y: number }) {
  if (!card?.image_normal) return null
  const width = 250
  const height = 349
  // Fica à direita do cursor; se não couber, vai para a esquerda. Nunca sai da tela na vertical.
  const left = x + 24 + width > window.innerWidth ? x - 24 - width : x + 24
  const top = Math.min(Math.max(8, y - height / 2), window.innerHeight - height - 8)
  return (
    <img
      src={card.image_normal}
      alt=""
      className="pointer-events-none fixed z-50 rounded-[4.75%] shadow-2xl shadow-black"
      style={{ left, top, width, height }}
    />
  )
}

/** Modal com a carta grande; vira para o verso nas cartas de duas faces. `extra`: botões a mais embaixo. */
export function CardModal({ card, onClose, extra }: { card: Card | null; onClose: () => void; extra?: ReactNode }) {
  const t = useT()
  const [showBack, setShowBack] = useState(false)

  // O estado do verso reinicia sozinho: o modal recebe key = id da carta
  useEffect(() => {
    if (!card) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, onClose])

  if (!card) return null
  const src = showBack && card.image_back ? card.image_back : card.image_normal

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={card.name}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 p-4 backdrop-blur-sm"
    >
      {src ? (
        <img
          src={src}
          alt={card.name}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[75vh] w-auto max-w-full rounded-[4.75%] shadow-2xl"
        />
      ) : (
        <div className="max-w-sm rounded-lg bg-surface p-6" onClick={(e) => e.stopPropagation()}>
          <p className="font-display text-lg text-parchment">{card.name}</p>
          <p className="mt-1 text-sm text-parchment/70">{card.type_line}</p>
          <p className="mt-3 whitespace-pre-line text-sm">{card.oracle_text}</p>
        </div>
      )}
      <div className="flex gap-3" onClick={(e) => e.stopPropagation()}>
        {card.image_back && (
          <button
            onClick={() => setShowBack((v) => !v)}
            className="rounded-lg border border-parchment/40 px-4 py-2 text-sm text-gold hover:bg-parchment/5"
          >
            {showBack ? t('Show front') : t('Show back')}
          </button>
        )}
        <button onClick={onClose} className="rounded-lg bg-parchment/10 px-4 py-2 text-sm hover:bg-parchment/20">
          {t('Close')}
        </button>
      </div>
      {extra && <div onClick={(e) => e.stopPropagation()}>{extra}</div>}
    </div>
  )
}
