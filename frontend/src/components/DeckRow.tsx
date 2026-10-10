import { Link } from 'react-router-dom'
import { deckPath } from '../lib/paths'
import type { DeckSummary } from '../lib/types'
import { ColorIdentity } from './Mana'

/** Linha compacta de deck: arte do comandante, nome e cores. */
export default function DeckRow({ deck, children }: { deck: DeckSummary; children?: React.ReactNode }) {
  const art = deck.face_commander?.image_art_crop
  return (
    <div className="flex items-center gap-3">
      <div className="h-11 w-16 shrink-0 overflow-hidden rounded-md border border-gold/15 bg-ink">
        {art && <img src={art} alt="" loading="lazy" className="size-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <Link to={deckPath(deck)} className="block truncate font-medium hover:text-gold">
          {deck.name}
        </Link>
        <div className="flex items-center gap-2 text-xs text-parchment/50">
          <ColorIdentity colors={deck.color_identity} />
          <span className="truncate">{deck.edition?.name ?? (deck.owner ? `deck de ${deck.owner}` : '')}</span>
        </div>
      </div>
      {children}
    </div>
  )
}

/** Taxa de vitória: número + barra fina (uma só cor; o trilho é neutro). */
export function WinRate({ rate, games, wins }: { rate: number; games: number; wins: number }) {
  const pct = Math.round(rate * 100)
  return (
    <div className="w-24 shrink-0 space-y-1 text-right" title={`${wins} vitória(s) em ${games} partida(s)`}>
      <p className="text-sm tabular-nums">
        <span className="font-semibold text-gold">{pct}%</span>{' '}
        <span className="text-xs text-parchment/45">
          {wins}/{games}
        </span>
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-parchment/10">
        <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
