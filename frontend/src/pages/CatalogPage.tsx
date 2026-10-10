import LoadError from '../components/LoadError'
import { POWER_FILTERS } from '../lib/analysis'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import DeckTile from '../components/DeckTile'
import DeckTileSkeleton from '../components/DeckTileSkeleton'
import { useTitle } from '../hooks/useTitle'
import { COLOR_NAMES } from '../lib/colors'
import { useT } from '../lib/i18n'
import { useDebounce } from '../hooks/useDebounce'
import { useMyDecks } from '../hooks/useMyDecks'
import { api, type DeckFilters } from '../lib/api'

const WUBRG = ['W', 'U', 'B', 'R', 'G']

export default function CatalogPage() {
  const t = useT()
  useTitle(t('Catalog'))
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const debouncedSearch = useDebounce(search)

  const myDecks = useMyDecks()
  const onlyMine = params.get('meus') === '1'

  const filters: DeckFilters = {
    search: params.get('search') ?? '',
    colors: params.get('colors') ?? '',
    edition: params.get('edition') ?? '',
    year: params.get('year') ?? '',
    bracket: params.get('bracket') ?? '',
    ordering: params.get('ordering') ?? '',
  }
  const powerRange = params.get('poder') ?? ''
  const [powerMin, powerMax] = powerRange.split('-')
  // "Meus decks" vira um filtro por slugs na API (a lista fica só no navegador)
  const withPower: DeckFilters = { ...filters, power_min: powerMin || '', power_max: powerMax || '' }
  const apiFilters: DeckFilters = onlyMine ? { ...withPower, slugs: myDecks.slugs.join(',') || '-' } : withPower

  const setFilter = (key: keyof DeckFilters | 'meus' | 'poder', value: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )
  }

  // A busca digitada vai para a URL só depois de uma pausa
  useEffect(() => {
    if (debouncedSearch !== (params.get('search') ?? '')) setFilter('search', debouncedSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage à busca digitada
  }, [debouncedSearch])

  const editions = useQuery({ queryKey: ['editions'], queryFn: api.editions, staleTime: Infinity })
  const years = [...new Set((editions.data ?? []).map((e) => e.release_date?.slice(0, 4)).filter(Boolean))]
    .sort()
    .reverse() as string[]

  const decks = useInfiniteQuery({
    queryKey: ['decks', apiFilters],
    queryFn: ({ pageParam }) => api.decks(apiFilters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.next ? all.length + 1 : undefined),
    staleTime: 5 * 60_000, // o catálogo só muda quando importamos coleções novas
  })

  // Cores: identidade exata. "C" (incolor) é exclusivo das demais.
  const selectedColors = filters.colors === 'C' ? [] : (filters.colors ?? '').split('').filter(Boolean)
  const toggleColor = (c: string) => {
    if (c === 'C') return setFilter('colors', filters.colors === 'C' ? '' : 'C')
    const next = selectedColors.includes(c) ? selectedColors.filter((x) => x !== c) : [...selectedColors, c]
    setFilter('colors', WUBRG.filter((x) => next.includes(x)).join(''))
  }

  const total = decks.data?.pages[0]?.count
  const results = decks.data?.pages.flatMap((p) => p.results) ?? []
  const hasFilters = Object.values(filters).some(Boolean) || onlyMine || !!powerRange

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="font-display text-3xl text-gold">{t('Precon catalog')}</h1>
        {total !== undefined && (
          <p className="text-sm text-parchment/50">
            {t(total === 1 ? '{n} deck' : '{n} decks', { n: total })}
          </p>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-gold/15 bg-surface/60 p-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('Search by deck or commander…')}
          className="w-full rounded-lg border border-gold/20 bg-ink px-4 py-2.5 placeholder:text-parchment/40 focus:border-gold focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1" role="group" aria-label={t('Color identity')}>
            {[...WUBRG, 'C'].map((c) => {
              const active = c === 'C' ? filters.colors === 'C' : selectedColors.includes(c)
              return (
                <button
                  key={c}
                  onClick={() => toggleColor(c)}
                  aria-pressed={active}
                  title={t(COLOR_NAMES[c])}
                  className={`rounded-full p-1.5 text-lg transition ${
                    active ? 'bg-gold/25 ring-2 ring-gold' : 'opacity-50 hover:opacity-100'
                  }`}
                >
                  <i className={`ms ms-${c.toLowerCase()} ms-cost ms-shadow`} aria-hidden />
                </button>
              )
            })}
          </div>
          <select
            value={filters.edition}
            onChange={(e) => setFilter('edition', e.target.value)}
            className="w-full rounded-lg border border-gold/20 bg-ink px-3 py-2 text-sm sm:w-auto sm:min-w-48 sm:max-w-xs sm:flex-1"
            aria-label={t('Edition')}
          >
            <option value="">{t('All editions')}</option>
            {editions.data?.map((e) => (
              <option key={e.code} value={e.code}>
                {e.name} ({e.deck_count})
              </option>
            ))}
          </select>
          <select
            value={filters.year}
            onChange={(e) => setFilter('year', e.target.value)}
            className="rounded-lg border border-gold/20 bg-ink px-3 py-2 text-sm"
            aria-label={t('Year')}
          >
            <option value="">{t('All years')}</option>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          <select
            value={filters.bracket}
            onChange={(e) => setFilter('bracket', e.target.value)}
            className="rounded-lg border border-gold/20 bg-ink px-3 py-2 text-sm"
            aria-label="Bracket"
            title={t('Bracket estimated with the official Commander system')}
          >
            <option value="">{t('All brackets')}</option>
            <option value="2">Bracket 2 · Core</option>
            <option value="3">Bracket 3 · Upgraded</option>
            <option value="4">Bracket 4+ · Optimized</option>
          </select>
          <select
            value={powerRange}
            onChange={(e) => setFilter('poder', e.target.value)}
            className="rounded-lg border border-gold/20 bg-ink px-3 py-2 text-sm"
            aria-label={t('Power level')}
            title={t('Estimated power level (1 to 10)')}
          >
            {POWER_FILTERS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </select>
          <select
            value={filters.ordering}
            onChange={(e) => setFilter('ordering', e.target.value)}
            className="rounded-lg border border-gold/20 bg-ink px-3 py-2 text-sm"
            aria-label={t('Sort')}
          >
            <option value="">{t('Newest')}</option>
            <option value="name">{t('Name (A–Z)')}</option>
            <option value="-power">{t('Strongest')}</option>
            <option value="power">{t('Weakest')}</option>
          </select>
          <button
            onClick={() => setFilter('meus', onlyMine ? '' : '1')}
            aria-pressed={onlyMine}
            className={`rounded-lg border px-3 py-2 text-sm transition ${
              onlyMine ? 'border-gold bg-gold/15 text-gold' : 'border-gold/20 text-parchment/70 hover:border-gold/50'
            }`}
          >
            {t('My decks ({n})', { n: myDecks.slugs.length })}
          </button>
          {hasFilters && (
            <button
              onClick={() => {
                setSearch('')
                setParams({}, { replace: true })
              }}
              className="text-sm text-parchment/60 hover:text-gold"
            >
              {t('Clear filters')}
            </button>
          )}
        </div>
        {selectedColors.length > 0 && (
          <p className="text-xs text-parchment/40">{t('Showing decks with exactly these colors.')}</p>
        )}
      </div>

      {decks.isPending && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <DeckTileSkeleton key={i} />
          ))}
        </div>
      )}
      {decks.isError && !results.length && (
        <LoadError error={decks.error} onRetry={() => decks.refetch()} retrying={decks.isFetching} />
      )}
      {decks.isSuccess && results.length === 0 && (
        <p className="py-10 text-center text-parchment/60">
          {onlyMine && myDecks.slugs.length === 0
            ? t("You haven't marked any decks yet. Use the marker in the corner of each deck.")
            : t('No decks found with these filters.')}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((deck) => (
          <DeckTile key={deck.slug} deck={deck} />
        ))}
      </div>

      {decks.hasNextPage && (
        <div className="flex justify-center">
          <button
            onClick={() => decks.fetchNextPage()}
            disabled={decks.isFetchingNextPage}
            className="rounded-lg border border-gold/40 px-6 py-2.5 text-gold hover:bg-gold/10 disabled:opacity-50"
          >
            {decks.isFetchingNextPage ? t('Loading…') : t('Load more')}
          </button>
        </div>
      )}
    </section>
  )
}
