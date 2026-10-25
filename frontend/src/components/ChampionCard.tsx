import { Crown, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import SupporterBadge from './SupporterBadge'
import Trophy from './Trophy'
import { useT } from '../lib/i18n'
import { titleLabel } from '../lib/titles'
import type { TournamentChampion, TournamentKind } from '../lib/types'

/**
 * Destaque do campeão na página do torneio encerrado: foto (com a moldura de Fundador), título de
 * apoiador e quantos torneios do mesmo formato a pessoa já ganhou. No 2x2, a dupla lado a lado.
 */
export default function ChampionCard({
  name,
  players,
  kind,
  teamSize,
}: {
  name: string
  players: TournamentChampion[]
  kind: TournamentKind
  teamSize: number
}) {
  const t = useT()
  const winsText = (n: number) =>
    kind === 'league'
      ? n === 1
        ? t('1st league title')
        : t('{n}× league champion', { n })
      : teamSize === 2
        ? n === 1
          ? t('1st 2v2 bracket title')
          : t('{n}× 2v2 bracket champion', { n })
        : n === 1
          ? t('1st bracket title')
          : t('{n}× bracket champion', { n })
  return (
    <section aria-label={t('Champion')} className="champion-card mx-auto max-w-2xl rounded-2xl px-6 py-8 text-center">
      <span className="champion-shine" aria-hidden />
      <Sparkles className="champion-spark left-[12%] top-6 size-5" aria-hidden />
      <Sparkles className="champion-spark right-[14%] top-10 size-4 [animation-delay:1.2s]" aria-hidden />
      <Sparkles className="champion-spark bottom-8 left-[20%] size-3.5 [animation-delay:2.1s]" aria-hidden />
      <p className="relative flex items-center justify-center gap-2 text-xs font-semibold tracking-[0.3em] text-gold uppercase">
        <Trophy className="size-4" />
        {t('Champion')}
        <Trophy className="size-4" />
      </p>
      <div className="relative mt-5 flex flex-wrap items-start justify-center gap-8">
        {players.length === 0 && <p className="font-display text-4xl text-parchment">{name}</p>}
        {players.map((p) => (
          <div key={p.username} className="flex w-48 flex-col items-center">
            <Crown className="champion-crown size-8 text-gold" aria-hidden />
            <span className={`-mt-1 rounded-full ${p.frame ? 'founder-frame' : ''}`}>
              {p.avatar ? (
                <img src={p.avatar} alt="" className="size-24 rounded-full object-cover ring-4 ring-gold/70 shadow-[0_0_30px_rgb(245_197_66/0.45)]" />
              ) : (
                <span className="grid size-24 place-items-center rounded-full bg-surface font-display text-4xl text-gold ring-4 ring-gold/70 shadow-[0_0_30px_rgb(245_197_66/0.45)]">
                  {p.username.slice(0, 1).toUpperCase()}
                </span>
              )}
            </span>
            <Link
              to={`/u/${encodeURIComponent(p.username)}`}
              className="font-display mt-3 flex max-w-full items-center gap-1.5 truncate text-3xl text-parchment hover:text-gold"
            >
              <span className="truncate">{p.username}</span>
              {p.supporter && <SupporterBadge className="h-4 w-4" />}
            </Link>
            {p.title && <p className="font-display text-lg text-amber-200/90 italic">{t(titleLabel(p.title))}</p>}
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-gold/50 bg-ink/60 px-3 py-1 text-xs font-semibold text-gold">
              <span className="flex" aria-hidden>
                {Array.from({ length: Math.min(p.wins, 5) }, (_, i) => (
                  <Trophy key={i} className="-ml-0.5 size-3.5 first:ml-0" />
                ))}
              </span>
              {winsText(p.wins)}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
