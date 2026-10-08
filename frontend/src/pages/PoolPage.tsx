import { useTitle } from '../hooks/useTitle'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import DeckTile from '../components/DeckTile'
import DeckTileSkeleton from '../components/DeckTileSkeleton'
import { useMyDecks } from '../hooks/useMyDecks'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'

export default function PoolPage() {
  useTitle('Minha deckpool')
  const { user } = useAuth()
  const myPrecons = useMyDecks()
  const myDecks = useQuery({ queryKey: ['me', 'decks', user?.id], queryFn: api.myDecks })
  const precons = useQuery({
    queryKey: ['me', 'precon-tiles', myPrecons.slugs],
    queryFn: () => api.decks({ slugs: myPrecons.slugs.join(',') }, 1, 200),
    enabled: myPrecons.slugs.length > 0,
  })

  const total = myPrecons.slugs.length + (myDecks.data?.length ?? 0)

  return (
    <section className="space-y-10">
      <div className="space-y-2">
        <h1 className="font-display text-3xl text-gold">Minha deckpool</h1>
        <p className="text-parchment/70">
          {total} {total === 1 ? 'deck' : 'decks'} de <strong className="text-parchment">{user?.username}</strong>. Nos
          sorteios por deckpool, os seus decks vão para os outros jogadores — e você recebe um deck de outra pessoa.
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-xl text-gold">Decks montados ({myDecks.data?.length ?? 0})</h2>
          <Link
            to="/minha-pool/novo"
            className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-110"
          >
            + Importar deck
          </Link>
        </div>
        {myDecks.isPending && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <DeckTileSkeleton />
          </div>
        )}
        {myDecks.data?.length === 0 && (
          <p className="rounded-xl border border-dashed border-gold/20 p-6 text-center text-sm text-parchment/60">
            Cole a lista de um deck seu (do Moxfield, Archidekt ou texto simples) para incluí-lo na deckpool.
          </p>
        )}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {myDecks.data?.map((deck) => (
            <DeckTile key={deck.slug} deck={deck} />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-xl text-gold">Precons que eu tenho ({myPrecons.slugs.length})</h2>
          <Link to="/catalogo" className="text-sm text-gold/80 hover:underline">
            Marcar mais no catálogo →
          </Link>
        </div>
        {myPrecons.slugs.length === 0 && (
          <p className="rounded-xl border border-dashed border-gold/20 p-6 text-center text-sm text-parchment/60">
            Use o marcador no canto de cada deck do catálogo para dizer quais precons você tem.
          </p>
        )}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {precons.data?.results.map((deck) => (
            <DeckTile key={deck.slug} deck={deck} />
          ))}
        </div>
      </div>
    </section>
  )
}
