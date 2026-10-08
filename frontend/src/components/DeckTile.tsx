import { Link } from 'react-router-dom'
import { deckPath } from '../lib/paths'
import type { DeckSummary } from '../lib/types'
import { ColorIdentity } from './Mana'
import OwnedToggle from './OwnedToggle'

export function EditionBadge({ name, icon }: { name: string; icon: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-parchment/60" title={name}>
      {icon && <img src={icon} alt="" className="h-3.5 w-3.5 shrink-0 invert opacity-70" loading="lazy" />}
      <span className="truncate">{name}</span>
    </span>
  )
}

export default function DeckTile({
  deck,
  label,
  showOwned = true,
}: {
  deck: DeckSummary
  label?: string
  showOwned?: boolean
}) {
  const art = deck.face_commander?.image_art_crop
  return (
    <Link
      to={deckPath(deck)}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-gold/15 bg-surface shadow-lg shadow-black/40 transition hover:-translate-y-0.5 hover:border-gold/50 focus-visible:outline-2 focus-visible:outline-gold"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-black/40">
        {art ? (
          <img
            src={art}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-gold/10 to-transparent" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/10 to-transparent" />
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          {label ? (
            <span className="max-w-[75%] truncate rounded-full bg-ink/80 px-2.5 py-1 text-xs font-semibold text-gold backdrop-blur">
              {label}
            </span>
          ) : !deck.is_active ? (
            <span className="rounded-full bg-ink/80 px-2.5 py-1 text-[10px] uppercase tracking-wide text-parchment/60">
              fora do sorteio geral
            </span>
          ) : (
            <span />
          )}
          {showOwned && deck.kind !== 'user' && <OwnedToggle slug={deck.slug} />}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4 pt-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg leading-tight text-parchment">{deck.name}</h3>
          <ColorIdentity colors={deck.color_identity} className="mt-1 shrink-0 text-sm" />
        </div>
        {deck.face_commander && <p className="text-sm text-parchment/70">{deck.face_commander.name}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          {deck.edition ? (
            <EditionBadge name={deck.edition.name} icon={deck.edition.icon_svg_uri} />
          ) : (
            <span className="truncate text-xs text-parchment/60">Deck de {deck.owner}</span>
          )}
          <span className="shrink-0 text-xs text-parchment/40">{deck.release_date?.slice(0, 4)}</span>
        </div>
      </div>
    </Link>
  )
}
