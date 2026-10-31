import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import DeckRow from './DeckRow'

/**
 * Os decks que este deck mais enfrentou nas partidas do site (sorteios e mesas): quantas vezes,
 * quantas este ganhou e quantas o outro ganhou (as que sobram, ganhou um terceiro).
 */
export default function DeckMatchups({ kind, slug }: { kind: 'precon' | 'user'; slug: string }) {
  const t = useT()
  const matchups = useQuery({ queryKey: ['matchups', kind, slug], queryFn: () => api.matchups(kind, slug) })
  const rows = matchups.data?.matchups ?? []
  if (!rows.length) return null
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface/60 p-4">
      <div>
        <h2 className="font-display text-xl text-parchment">{t('Most faced decks')}</h2>
        <p className="text-xs text-parchment/50">{t('Games at the same table: wins of this deck and of the other one.')}</p>
      </div>
      <ol className="space-y-3">
        {rows.map((m) => (
          <li key={`${m.deck.kind}-${m.deck.slug}`}>
            <DeckRow deck={m.deck}>
              <p className="w-28 shrink-0 text-right text-sm tabular-nums">
                <span className="font-semibold text-emerald-300">{m.wins}</span>
                <span className="text-parchment/35"> × </span>
                <span className="font-semibold text-red-300">{m.losses}</span>
                <span className="block text-xs text-parchment/45">{t('{n} games', { n: m.games })}</span>
              </p>
            </DeckRow>
          </li>
        ))}
      </ol>
    </section>
  )
}
