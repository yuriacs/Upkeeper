import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ExternalLink, Lightbulb, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { roleOf, type BuilderCard, type BuilderDeck } from '../../lib/deckbuilder'
import { bySynergy, fetchSuggestions, resolveCards, type EdhrecCard } from '../../lib/edhrec'
import { useFavorites } from '../../lib/favorites'
import { useI18n } from '../../lib/i18n'
import FavoriteButton from './FavoriteButton'
import { money } from '../../lib/money'
import { roleLabel, type T } from './labels'

const PAGE = 24

/** Nome das listas do EDHREC no site (as que não estão aqui aparecem como vêm) */
const listLabel = (t: T, tag: string, header: string) =>
  ({
    topcards: t('Most played'),
    highliftcards: t('Strong fit'),
    creatures: t('Creatures'),
    instants: t('Instants'),
    sorceries: t('Sorceries'),
    utilityartifacts: t('Artifacts'),
    manaartifacts: t('Mana rocks'),
    enchantments: t('Enchantments'),
    planeswalkers: t('Planeswalkers'),
    battles: t('Battles'),
    utilitylands: t('Utility lands'),
    lands: t('Lands'),
  })[tag] ?? header

const front = (name: string) => name.split(' // ')[0].toLowerCase()

/**
 * Sugestões de cartas para o comandante escolhido, pelos dados do EDHREC: as de maior sinergia,
 * as mais jogadas e as listas por tipo. Some o que já está no deck; cada carta mostra a sinergia,
 * em quantos decks aparece, o preço da edição mais barata e a função (ramp, compra...).
 */
export function Suggestions({
  deck,
  onAdd,
  onMaybe,
  onHover,
}: {
  deck: BuilderDeck
  onAdd: (c: BuilderCard) => void
  onMaybe: (c: BuilderCard) => void
  onHover: (c: BuilderCard | null) => void
}) {
  const { t, locale } = useI18n()
  const favorites = useFavorites()
  const commanders = deck.commanders.map((c) => c.name)
  const page = useQuery({
    queryKey: ['edhrec', commanders],
    queryFn: () => fetchSuggestions(commanders),
    enabled: commanders.length > 0,
    staleTime: 3_600_000,
    retry: 1,
  })
  const [tab, setTab] = useState('synergy')
  const [shown, setShown] = useState(PAGE)

  // O que já está no deck (ou é comandante) não aparece
  const taken = useMemo(
    () => new Set([...deck.cards.map((e) => front(e.card.name)), ...deck.commanders.map((c) => front(c.name))]),
    [deck.cards, deck.commanders],
  )
  const inMaybe = useMemo(() => new Set(deck.maybe.map((e) => front(e.card.name))), [deck.maybe])
  const lists = page.data?.lists ?? []
  const pool: EdhrecCard[] =
    tab === 'synergy' ? bySynergy(lists) : (lists.find((l) => l.tag === tab)?.cards ?? [])
  const free = pool.filter((c) => !taken.has(front(c.name)))
  const visible = free.slice(0, shown)
  const names = visible.map((c) => c.name)

  // Cartas já buscadas no Scryfall (null = não achou): só as que faltam são buscadas
  const [known, setKnown] = useState(() => new Map<string, BuilderCard | null>())
  const missing = names.filter((n) => !known.has(n))
  const cards = useQuery({
    queryKey: ['edhrec-cards', missing],
    queryFn: async ({ signal }) => {
      const found = await resolveCards(missing, signal)
      if (signal.aborted) return 0 // a lista mudou no meio: busca de novo depois
      setKnown((prev) => {
        const next = new Map(prev)
        for (const n of missing) next.set(n, found.get(n) ?? null)
        return next
      })
      return found.size
    },
    enabled: missing.length > 0,
    staleTime: Infinity,
  })
  const resolved = new Map([...known].filter((e): e is [string, BuilderCard] => !!e[1]))
  const oracleCards = names
    .map((n) => resolved.get(n))
    .filter((c): c is BuilderCard => !!c?.oracleId)
    .map((c) => ({ oracle_id: c.oracleId, name: c.name }))
  const roles = useQuery({
    queryKey: ['card-roles', oracleCards.map((c) => c.oracle_id).join(',')],
    queryFn: () => api.cardRoles(oracleCards).then((r) => r.roles),
    enabled: oracleCards.length > 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  })

  if (!commanders.length)
    return <p className="py-10 text-center text-sm text-parchment/50">{t('Choose a commander to see suggestions.')}</p>
  if (page.isPending) return <p className="py-10 text-center text-sm text-parchment/50">{t('Loading…')}</p>
  if (!page.data)
    return (
      <p className="py-10 text-center text-sm text-parchment/50">
        {page.isError ? t('Suggestions are unavailable right now. Try again later.') : t('No suggestions for this commander yet.')}
      </p>
    )

  const tabs: [string, string][] = [
    ['synergy', t('High synergy')],
    ...lists.map((l) => [l.tag, listLabel(t, l.tag, l.header)] as [string, string]),
  ]
  const pick = (key: string) => {
    setTab(key)
    setShown(PAGE)
  }
  const pct = (n: number) => `${Math.round(n * 100)}%`

  return (
    <section className="min-w-0 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => pick(key)}
            aria-pressed={tab === key}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              tab === key ? 'border-gold bg-gold/15 text-gold' : 'border-line text-parchment/60 hover:text-parchment'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-parchment/45">
        {t('Synergy: how much more the card shows up with this commander than in other decks of the same colors. Cards already in your deck are hidden.')}
      </p>

      {free.length === 0 && <p className="text-sm text-parchment/50">{t('You already have every card in this list.')}</p>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
        {visible.map((s) => {
          const c = resolved.get(s.name)
          const role = c ? roleOf({ card: c, qty: 1 }, roles.data ?? {}) : null
          return (
            <li
              key={s.name}
              className="group relative"
              onMouseEnter={() => c && onHover(c)}
              onMouseLeave={() => onHover(null)}
            >
              <button
                onClick={() => c && onAdd(c)}
                disabled={!c}
                title={c ? t('Add {name}', { name: c.name }) : s.name}
                className="block w-full overflow-hidden rounded-[4.5%] transition enabled:hover:ring-2 enabled:hover:ring-gold"
              >
                {c ? (
                  <img src={c.small} alt={c.name} loading="lazy" className="aspect-[488/680] w-full bg-surface" />
                ) : (
                  <span className="grid aspect-[488/680] w-full place-items-center bg-surface p-2 text-center text-xs text-parchment/60">
                    {cards.isFetching ? t('Loading…') : s.name}
                  </span>
                )}
              </button>
              {/* Sinergia e em quantos decks aparece */}
              <span
                title={t('In {n} of {total} decks with this commander', { n: s.decks, total: s.of })}
                className="pointer-events-none absolute top-1 left-1 flex flex-col items-start gap-0.5"
              >
                <span
                  className={`rounded-full px-1.5 text-[0.7rem] font-bold tabular-nums ring-1 ring-line ${
                    s.synergy > 0 ? 'bg-emerald-950/90 text-emerald-300' : 'bg-ink/90 text-parchment/60'
                  }`}
                >
                  {s.synergy > 0 ? '+' : ''}
                  {pct(s.synergy)}
                </span>
                {s.of > 0 && (
                  <span className="rounded-full bg-ink/90 px-1.5 text-[0.65rem] text-parchment/70 tabular-nums ring-1 ring-line">
                    {t('{p} of decks', { p: pct(s.decks / s.of) })}
                  </span>
                )}
              </span>
              {role && role !== 'other' && role !== 'land' && (
                <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-ink/90 px-1.5 text-[0.65rem] text-sky-200 ring-1 ring-line">
                  {roleLabel(t, role)}
                </span>
              )}
              {c && (
                <span className="pointer-events-none absolute right-1 bottom-1 rounded-full bg-ink/90 px-1.5 text-[0.7rem] font-semibold text-emerald-300 tabular-nums ring-1 ring-line">
                  {c.priceUsd != null ? money(c.priceUsd, 'USD', locale) : '—'}
                </span>
              )}
              {c && (
                <div className="absolute top-1 right-1 flex flex-col gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    onClick={() => onAdd(c)}
                    title={t('Add {name}', { name: c.name })}
                    aria-label={t('Add {name}', { name: c.name })}
                    className="grid h-7 w-7 place-items-center rounded-full bg-ink/85 text-gold ring-1 ring-line"
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    onClick={() => onMaybe(c)}
                    disabled={inMaybe.has(front(c.name))}
                    title={t('Add {name} to the maybeboard', { name: c.name })}
                    aria-label={t('Add {name} to the maybeboard', { name: c.name })}
                    className="grid h-7 w-7 place-items-center rounded-full bg-ink/85 text-sky-300 ring-1 ring-line disabled:opacity-40"
                  >
                    <Lightbulb className="h-4 w-4" aria-hidden />
                  </button>
                  <FavoriteButton card={c} on={favorites.has(c.oracleId)} onToggle={() => favorites.toggle(c.oracleId)} className="!opacity-100" />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {free.length > shown && (
        <button
          onClick={() => setShown((n) => n + PAGE)}
          className="w-full rounded-lg border border-line py-2 text-sm text-parchment/70 hover:border-parchment/40"
        >
          {t('Load more')}
        </button>
      )}
      <a
        href={`https://edhrec.com/commanders/${page.data.slug}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-parchment/45 underline-offset-4 hover:text-gold hover:underline"
      >
        {t('Data from EDHREC ({n} decks)', { n: page.data.total.toLocaleString(locale) })}
        <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </section>
  )
}
