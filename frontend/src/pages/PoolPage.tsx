import { useTitle } from '../hooks/useTitle'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import DeckTile from '../components/DeckTile'
import DeckTileSkeleton from '../components/DeckTileSkeleton'
import { useMyDecks } from '../hooks/useMyDecks'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'

export default function PoolPage() {
  const t = useT()
  useTitle(t('My pool'))
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
        <h1 className="font-display text-3xl text-gold">{t('My pool')}</h1>
        <p className="text-parchment/70">
          {t(total === 1 ? '{n} deck from' : '{n} decks from', { n: total })}{' '}
          <strong className="text-parchment">{user?.username}</strong>.{' '}
          {t('In deck pool deals, your decks go to the other players — and you get someone else’s deck.')}
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-xl text-gold">{t('Built decks ({n})', { n: myDecks.data?.length ?? 0 })}</h2>
          <Link
            to="/minha-pool/novo"
            className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-110"
          >
            + {t('Import deck')}
          </Link>
        </div>
        {myDecks.isPending && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <DeckTileSkeleton />
          </div>
        )}
        {myDecks.data?.length === 0 && (
          <p className="rounded-xl border border-dashed border-gold/20 p-6 text-center text-sm text-parchment/60">
            {t('Paste the list of one of your decks (from Moxfield, Archidekt or plain text) to add it to your deck pool.')}
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
          <h2 className="font-display text-xl text-gold">{t('Precons I own ({n})', { n: myPrecons.slugs.length })}</h2>
          <Link to="/catalogo" className="text-sm text-gold/80 hover:underline">
            {t('Mark more in the catalog')} →
          </Link>
        </div>
        {myPrecons.slugs.length === 0 && (
          <p className="rounded-xl border border-dashed border-gold/20 p-6 text-center text-sm text-parchment/60">
            {t('Use the marker in the corner of each deck in the catalog to say which precons you own.')}
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
