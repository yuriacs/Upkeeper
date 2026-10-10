import type { MouseEvent } from 'react'
import { useMyDecks } from '../hooks/useMyDecks'
import { useT } from '../lib/i18n'

/** Botão "Tenho este deck". Funciona dentro de um <Link> sem disparar a navegação. */
export default function OwnedToggle({ slug, variant = 'icon' }: { slug: string; variant?: 'icon' | 'full' }) {
  const t = useT()
  const { has, toggle } = useMyDecks()
  const owned = has(slug)
  const onClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggle(slug)
  }
  const label = owned ? t('Remove from My decks') : t('Mark as my deck')

  if (variant === 'full') {
    return (
      <button
        onClick={onClick}
        aria-pressed={owned}
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
          owned ? 'border-gold bg-gold/15 text-gold' : 'border-gold/30 text-parchment/70 hover:border-gold/60'
        }`}
      >
        <BookmarkIcon filled={owned} />
        {owned ? t('You own this deck') : t('I own this deck')}
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      aria-pressed={owned}
      aria-label={label}
      title={label}
      className={`rounded-full p-2 backdrop-blur transition ${
        owned ? 'bg-gold text-ink' : 'bg-ink/70 text-parchment/80 hover:text-gold'
      }`}
    >
      <BookmarkIcon filled={owned} />
    </button>
  )
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" strokeLinejoin="round" />
    </svg>
  )
}
