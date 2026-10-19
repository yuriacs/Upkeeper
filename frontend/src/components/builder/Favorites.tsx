import { useQuery } from '@tanstack/react-query'
import { Crown, Lightbulb, Search, Star } from 'lucide-react'
import { useState } from 'react'
import { canCommand, fetchByOracle, type BuilderCard } from '../../lib/deckbuilder'
import { useFavorites } from '../../lib/favorites'
import { useI18n } from '../../lib/i18n'
import { money } from '../../lib/money'
import FavoriteButton from './FavoriteButton'
import { CARD_TYPES, cardTypeLabel } from './labels'

type Sort = 'recent' | 'name' | 'cmc'

/**
 * Cartas favoritas do deckbuilder: as que o usuário marcou com a estrela (na busca, nas sugestões ou
 * no deck), com filtro por nome, tipo e cores do comandante, como na busca. As cartas vêm do
 * Scryfall na edição mais barata; só as que ainda não foram buscadas são buscadas de novo.
 */
export function Favorites({
  identity,
  inDeck,
  onAdd,
  onMaybe,
  onCommander,
  onHover,
}: {
  identity: string[]
  inDeck: Map<string, number>
  onAdd: (c: BuilderCard) => void
  onMaybe: (c: BuilderCard) => void
  onCommander: (c: BuilderCard) => void
  onHover: (c: BuilderCard | null) => void
}) {
  const { t, locale } = useI18n()
  const favorites = useFavorites()
  const [text, setText] = useState('')
  const [type, setType] = useState<string>('')
  const [inColors, setInColors] = useState(true)
  const [sort, setSort] = useState<Sort>('recent')

  // Cartas já buscadas (por oracle id; null = o Scryfall não achou)
  const [known, setKnown] = useState(() => new Map<string, BuilderCard | null>())
  const missing = favorites.ids.filter((id) => !known.has(id))
  const loading = useQuery({
    queryKey: ['favorite-cards', 'resolve', missing],
    queryFn: async ({ signal }) => {
      const found = await fetchByOracle(missing, signal)
      if (signal.aborted) return 0
      setKnown((prev) => {
        const next = new Map(prev)
        for (const id of missing) next.set(id, found.find((c) => c.oracleId === id) ?? null)
        return next
      })
      return found.length
    },
    enabled: missing.length > 0,
    staleTime: Infinity,
  })

  const order = new Map(favorites.ids.map((id, i) => [id, i]))
  const q = text.trim().toLowerCase()
  const cards = favorites.ids
    .map((id) => known.get(id))
    .filter((c): c is BuilderCard => !!c)
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .filter((c) => !type || c.typeLine.toLowerCase().includes(type))
    // Com comandante escolhido: só o que cabe nas cores dele
    .filter((c) => !inColors || !identity.length || c.identity.every((x) => identity.includes(x)))
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'cmc'
          ? a.cmc - b.cmc || a.name.localeCompare(b.name)
          : (order.get(a.oracleId) ?? 0) - (order.get(b.oracleId) ?? 0),
    )
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition ${
      on ? 'border-gold bg-gold/15 text-gold' : 'border-line text-parchment/60 hover:text-parchment'
    }`
  const select = 'rounded-lg border border-line bg-ink px-2 py-1 text-sm'

  if (!favorites.loading && favorites.ids.length === 0)
    return (
      <div className="space-y-2 rounded-lg border border-dashed border-line p-6 text-center text-sm text-parchment/60">
        <Star className="mx-auto h-6 w-6 text-gold/70" aria-hidden />
        <p>{t('No favorite cards yet.')}</p>
        <p className="text-parchment/45">
          {t('Mark the cards you use the most with the star: in the search, in the suggestions or in your deck.')}
        </p>
      </div>
    )

  return (
    <section className="min-w-0 space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-parchment/40" aria-hidden />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('Filter favorites by name')}
          aria-label={t('Filter favorites by name')}
          className="w-full rounded-lg border border-line bg-surface py-2.5 pr-3 pl-9 focus:border-gold focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('Card type')} className={select}>
          {CARD_TYPES.map((k) => (
            <option key={k} value={k}>
              {cardTypeLabel(t, k)}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t('Sort by')} className={select}>
          <option value="recent">{t('Recently added')}</option>
          <option value="name">{t('Name')}</option>
          <option value="cmc">{t('Mana value')}</option>
        </select>
        {identity.length > 0 && (
          <button onClick={() => setInColors((v) => !v)} aria-pressed={inColors} className={chip(inColors)}>
            {t('Commander’s colors only')}
          </button>
        )}
        <span className="ml-auto text-xs text-parchment/40">
          {t('{n} of {total} favorites', { n: cards.length, total: favorites.ids.length })}
        </span>
      </div>

      {(favorites.loading || loading.isFetching) && <p className="text-sm text-parchment/50">{t('Loading…')}</p>}
      {!loading.isFetching && cards.length === 0 && favorites.ids.length > 0 && (
        <p className="text-sm text-parchment/50">{t('No favorite matches these filters.')}</p>
      )}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
        {cards.map((c) => {
          const n = inDeck.get(c.name) ?? 0
          return (
            <li key={c.oracleId} className="group relative" onMouseEnter={() => onHover(c)} onMouseLeave={() => onHover(null)}>
              <button
                onClick={() => onAdd(c)}
                title={t('Add {name}', { name: c.name })}
                className="block w-full overflow-hidden rounded-[4.5%] transition hover:ring-2 hover:ring-gold"
              >
                <img src={c.small} alt={c.name} loading="lazy" className="aspect-[488/680] w-full bg-surface" />
              </button>
              <span className="pointer-events-none absolute right-1 bottom-1 rounded-full bg-ink/90 px-1.5 text-[0.7rem] font-semibold text-emerald-300 tabular-nums ring-1 ring-line">
                {c.priceUsd != null ? money(c.priceUsd, 'USD', locale) : '—'}
              </span>
              {n > 0 && (
                <span className="pointer-events-none absolute top-1 left-1 rounded-full bg-gold px-1.5 text-xs font-bold text-ink">
                  {n}
                </span>
              )}
              <div className="absolute top-1 right-1 flex flex-col gap-1">
                {canCommand(c) && (
                  <button
                    onClick={() => onCommander(c)}
                    title={t('Make {name} your commander', { name: c.name })}
                    aria-label={t('Make {name} your commander', { name: c.name })}
                    className="grid h-7 w-7 place-items-center rounded-full bg-ink/85 text-gold opacity-0 ring-1 ring-line transition group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Crown className="h-4 w-4" aria-hidden />
                  </button>
                )}
                <button
                  onClick={() => onMaybe(c)}
                  title={t('Add {name} to the maybeboard', { name: c.name })}
                  aria-label={t('Add {name} to the maybeboard', { name: c.name })}
                  className="grid h-7 w-7 place-items-center rounded-full bg-ink/85 text-sky-300 opacity-0 ring-1 ring-line transition group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Lightbulb className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <FavoriteButton
                card={c}
                on={favorites.has(c.oracleId)}
                onToggle={() => favorites.toggle(c.oracleId)}
                className="absolute bottom-1 left-1"
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
