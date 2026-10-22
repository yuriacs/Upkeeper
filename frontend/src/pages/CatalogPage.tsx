import LoadError from '../components/LoadError'
import { POWER_FILTERS } from '../lib/analysis'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Bookmark, Library, Search, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/animate-ui/components/radix/tabs'
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
/** Cor de cada mana para o brilho do filtro de identidade */
const GEM: Record<string, string> = { W: '#f6e7b0', U: '#3fa2ff', B: '#a070e0', R: '#ff5631', G: '#37c06a', C: '#b9b9c4' }

export default function CatalogPage() {
  const t = useT()
  useTitle(t('Catalog'))
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const debouncedSearch = useDebounce(search)

  const myDecks = useMyDecks()
  const onlyMine = params.get('mine') === '1'

  const filters: DeckFilters = {
    search: params.get('search') ?? '',
    colors: params.get('colors') ?? '',
    edition: params.get('edition') ?? '',
    year: params.get('year') ?? '',
    bracket: params.get('bracket') ?? '',
    ordering: params.get('ordering') ?? '',
  }
  const powerRange = params.get('power') ?? ''
  const [powerMin, powerMax] = powerRange.split('-')
  // "Meus decks" vira um filtro por slugs na API (a lista fica só no navegador)
  const withPower: DeckFilters = { ...filters, power_min: powerMin || '', power_max: powerMax || '' }
  const apiFilters: DeckFilters = onlyMine ? { ...withPower, slugs: myDecks.slugs.join(',') || '-' } : withPower

  const setFilter = (key: keyof DeckFilters | 'mine' | 'power', value: string) => {
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
  
  // Campo de filtro padronizado: rótulo pequeno em cima e o select com seta própria
  const selectClass =
    'h-9 w-full appearance-none rounded-lg border border-parchment/15 bg-ink/70 bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23ecb93f%27 stroke-width=%272%27%3E%3Cpath d=%27M6 9l6 6 6-6%27/%3E%3C/svg%3E")] bg-[length:1rem] bg-[right_0.7rem_center] bg-no-repeat pr-9 pl-3 text-sm text-parchment transition hover:border-parchment/30 focus:border-gold focus:outline-none'
  const field = (label: string, control: ReactNode) => (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-[0.65rem] font-semibold tracking-[0.18em] text-parchment/50 uppercase">{label}</span>
      {control}
    </label>
  )
  const editionName = editions.data?.find((e) => e.code === filters.edition)?.name
  const POWER_LABEL = POWER_FILTERS.find((o) => o.value === powerRange)?.label
  // Filtros ativos viram etiquetas que dá para remover uma a uma
  const chips: [string, () => void][] = [
    ...(filters.search ? [[`“${filters.search}”`, () => (setSearch(''), setFilter('search', ''))] as [string, () => void]] : []),
    ...(filters.colors ? [[filters.colors === 'C' ? t(COLOR_NAMES.C) : filters.colors.split('').map((c) => t(COLOR_NAMES[c])).join(' + '), () => setFilter('colors', '')] as [string, () => void]] : []),
    ...(filters.edition ? [[editionName ?? filters.edition, () => setFilter('edition', '')] as [string, () => void]] : []),
    ...(filters.year ? [[filters.year, () => setFilter('year', '')] as [string, () => void]] : []),
    ...(filters.bracket ? [[`Bracket ${filters.bracket}`, () => setFilter('bracket', '')] as [string, () => void]] : []),
    ...(powerRange && POWER_LABEL ? [[t(POWER_LABEL), () => setFilter('power', '')] as [string, () => void]] : []),
  ]

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[0.7rem] font-semibold tracking-[0.3em] text-gold uppercase">{t('Catalog')}</p>
          <h1 className="font-epic mt-1 text-3xl font-semibold text-parchment">
            {onlyMine ? t('My decks') : t('Precon catalog')}
          </h1>
        </div>
        {total !== undefined && (
          <p className="text-sm text-parchment/50">
            {t(total === 1 ? '{n} deck' : '{n} decks', { n: total })}
          </p>
        )}
      </div>

      {/* Abas: catálogo inteiro ou só os decks marcados como meus */}
      <Tabs value={onlyMine ? 'mine' : 'all'} onValueChange={(v) => setFilter('mine', v === 'mine' ? '1' : '')}>
        <TabsList className="h-12 w-full max-w-md rounded-full border border-parchment/10 bg-black/50 p-1.5 shadow-[inset_0_1px_3px_rgb(0_0_0/0.6)]">
          <TabsTrigger
            value="all"
            className="gap-2 rounded-full text-[0.95rem] font-semibold text-parchment/70 hover:text-parchment data-[state=active]:text-[#1a1204]"
          >
            <Library className="h-4 w-4" aria-hidden />
            {t('Precons')}
          </TabsTrigger>
          <TabsTrigger
            value="mine"
            className="gap-2 rounded-full text-[0.95rem] font-semibold text-parchment/70 hover:text-parchment data-[state=active]:text-[#1a1204]"
          >
            <Bookmark className="h-4 w-4" aria-hidden />
            {t('My decks ({n})', { n: myDecks.slugs.length })}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Resultados à esquerda; filtros à direita, acompanhando a rolagem */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <aside aria-label={t('Filters')} className="lg:sticky lg:top-24 lg:order-2">
          <div className="space-y-4 rounded-xl border border-parchment/10 bg-ink/80 p-4 backdrop-blur lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">
            <div className="flex flex-col gap-3">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-gold/70" aria-hidden />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('Search by deck or commander…')}
                  aria-label={t('Search by deck or commander…')}
                  className="h-9 w-full rounded-lg border border-parchment/15 bg-ink/70 pr-4 pl-9 text-sm placeholder:text-parchment/35 transition hover:border-parchment/30 focus:border-gold focus:outline-none"
                />
              </div>
              <div>
                {field(
                  t('Sort'),
                  <select value={filters.ordering} onChange={(e) => setFilter('ordering', e.target.value)} className={selectClass}>
                    <option value="">{t('Newest')}</option>
                    <option value="name">{t('Name (A–Z)')}</option>
                    <option value="-power">{t('Strongest')}</option>
                    <option value="power">{t('Weakest')}</option>
                    <option value="-price_usd">{t('Most expensive')}</option>
                    <option value="price_usd">{t('Cheapest')}</option>
                  </select>,
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[0.65rem] font-semibold tracking-[0.18em] text-parchment/50 uppercase">{t('Color identity')}</span>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('Color identity')}>
                {[...WUBRG, 'C'].map((c) => {
                  const active = c === 'C' ? filters.colors === 'C' : selectedColors.includes(c)
                  return (
                    <button
                      key={c}
                      onClick={() => toggleColor(c)}
                      aria-pressed={active}
                      style={{ '--gem': GEM[c] } as CSSProperties}
                      className={`mana-gem ${active ? 'is-on' : ''}`}
                    >
                      <i className={`ms ms-${c.toLowerCase()} ms-cost ms-shadow`} aria-hidden />
                      <span>{t(COLOR_NAMES[c])}</span>
                    </button>
                  )
                })}
                {selectedColors.length > 0 && (
                  <span className="ml-1 text-xs text-parchment/40">{t('Showing decks with exactly these colors.')}</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
              {field(
                t('Edition'),
                <select value={filters.edition} onChange={(e) => setFilter('edition', e.target.value)} className={selectClass}>
                  <option value="">{t('All editions')}</option>
                  {editions.data?.map((e) => (
                    <option key={e.code} value={e.code}>
                      {e.name} ({e.deck_count})
                    </option>
                  ))}
                </select>,
              )}
              {field(
                t('Year'),
                <select value={filters.year} onChange={(e) => setFilter('year', e.target.value)} className={selectClass}>
                  <option value="">{t('All years')}</option>
                  {years.map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>,
              )}
              {field(
                'Bracket',
                <select
                  value={filters.bracket}
                  onChange={(e) => setFilter('bracket', e.target.value)}
                  className={selectClass}
                  title={t('Bracket estimated with the official Commander system')}
                >
                  <option value="">{t('All brackets')}</option>
                  <option value="2">Bracket 2 · Core</option>
                  <option value="3">Bracket 3 · Upgraded</option>
                  <option value="4">Bracket 4+ · Optimized</option>
                </select>,
              )}
              {field(
                t('Power level'),
                <select
                  value={powerRange}
                  onChange={(e) => setFilter('power', e.target.value)}
                  className={selectClass}
                  title={t('Estimated power level (1 to 10)')}
                >
                  {POWER_FILTERS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.label)}
                    </option>
                  ))}
                </select>,
              )}
            </div>

            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-parchment/10 pt-3">
                {chips.map(([label, remove]) => (
                  <button
                    key={label}
                    onClick={remove}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 py-1 pr-2 pl-3 text-xs font-semibold text-gold transition hover:border-gold"
                  >
                    {label}
                    <X className="h-3.5 w-3.5" aria-label={t('Remove')} />
                  </button>
                ))}
                <button
                  onClick={() => {
                    setSearch('')
                    setParams(onlyMine ? { meus: '1' } : {}, { replace: true })
                  }}
                  className="ml-1 text-xs text-parchment/55 underline-offset-4 hover:text-gold hover:underline"
                >
                  {t('Clear filters')}
                </button>
              </div>
            )}
          </div>
        </aside>
        <div className="min-w-0 space-y-6 lg:order-1">
          {decks.isPending && (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
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

          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
            {results.map((deck, i) => (
              <DeckTile key={deck.slug} deck={deck} index={i} />
            ))}
          </div>

          {decks.hasNextPage && (
            <div className="flex justify-center">
              <button
                onClick={() => decks.fetchNextPage()}
                disabled={decks.isFetchingNextPage}
                className="rounded-lg border border-parchment/25 px-6 py-2.5 text-gold hover:bg-parchment/5 disabled:opacity-50"
              >
                {decks.isFetchingNextPage ? t('Loading…') : t('Load more')}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
