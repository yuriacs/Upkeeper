import { Star } from 'lucide-react'
import { useT } from '../../lib/i18n'
import type { BuilderCard } from '../../lib/deckbuilder'

/** Estrela de favorita numa carta: cheia e sempre à vista quando é favorita; vazia só ao passar o mouse */
export default function FavoriteButton({
  card,
  on,
  onToggle,
  className = '',
}: {
  card: BuilderCard
  on: boolean
  onToggle: () => void
  className?: string
}) {
  const t = useT()
  if (!card.oracleId) return null
  const label = on ? t('Remove {name} from favorites', { name: card.name }) : t('Add {name} to favorites', { name: card.name })
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      title={label}
      aria-label={label}
      aria-pressed={on}
      className={`grid h-7 w-7 place-items-center rounded-full bg-ink/85 ring-1 ring-line transition focus-visible:opacity-100 ${
        on ? 'text-gold' : 'text-parchment/70 opacity-0 group-hover:opacity-100 hover:text-gold'
      } ${className}`}
    >
      <Star className="h-4 w-4" fill={on ? 'currentColor' : 'none'} aria-hidden />
    </button>
  )
}
