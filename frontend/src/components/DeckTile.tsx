import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { displayName } from '../lib/cardName'
import { deckPath } from '../lib/paths'
import type { DeckSummary } from '../lib/types'
import { BracketBadge, PowerBadge } from './Bracket'
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

/**
 * Card de deck guiado pela arte: a arte do comandante ocupa tudo e o texto fica por cima,
 * no rodapé escurecido. `label` (nome do jogador, num sorteio) aparece em destaque laranja.
 */
export default function DeckTile({
  deck,
  label,
  showOwned = true,
}: {
  deck: DeckSummary
  label?: string
  showOwned?: boolean
}) {
  const t = useT()
  const art = deck.face_commander?.image_art_crop
  const sub = deck.edition
    ? [deck.edition.name, deck.release_date?.slice(0, 4)].filter(Boolean).join(' · ')
    : t("{owner}'s deck", { owner: deck.owner ?? '' })
  return (
    <Link
      to={deckPath(deck)}
      className="group relative block aspect-[3/4] overflow-hidden rounded-lg bg-surface shadow-lg shadow-black/50 ring-1 ring-white/5 transition hover:-translate-y-0.5 hover:ring-parchment/30 focus-visible:outline-2 focus-visible:outline-gold"
    >
      {art ? (
        <img
          src={art}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-parchment/10 to-transparent" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent via-35% to-black/90" />

      <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
        {!deck.is_active && !label ? (
          <span className="rounded bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-parchment/70">
            {t('not in the main deal')}
          </span>
        ) : (
          <span />
        )}
        {showOwned && deck.kind !== 'user' && <OwnedToggle slug={deck.slug} />}
      </div>

      <div className="absolute inset-x-3 bottom-3 space-y-1">
        {label && <p className="truncate font-display text-base tracking-wide text-gold">{label}</p>}
        <h3 className="font-display text-xl text-parchment drop-shadow sm:text-2xl-[0_1px_6px_rgba(0,0,0,0.8)]">
          {deck.name}
        </h3>
        {deck.face_commander && (
          <p className="truncate text-sm text-parchment/75">{displayName(deck.face_commander.name)}</p>
        )}
        <div className="flex items-center gap-2 pt-1 text-xs text-parchment/70">
          <ColorIdentity colors={deck.color_identity} className="shrink-0 text-sm" />
          <BracketBadge bracket={deck.bracket} />
          <PowerBadge power={deck.power} />
          {!label && <span className="ml-auto hidden truncate text-parchment/55 sm:inline">{sub}</span>}
        </div>
      </div>
    </Link>
  )
}
