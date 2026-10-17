import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Crown, Minus, Plus, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ColorIdentity, ManaCost } from '../components/Mana'
import { useDebounce } from '../hooks/useDebounce'
import { useTitle } from '../hooks/useTitle'
import { api, ApiError } from '../lib/api'
import {
  buildQuery,
  canCommand,
  clearDraft,
  curve,
  DECK_SIZE,
  deckCount,
  deckIdentity,
  deckPrice,
  fromSavedDeck,
  groupOf,
  GROUPS,
  loadDraft,
  maxCopies,
  problems,
  saveDraft,
  searchCards,
  toDecklist,
  type BuilderCard,
  type BuilderDeck,
  type Group,
  type Problem,
  type SearchFilters,
  type SearchPage,
} from '../lib/deckbuilder'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/money'

type T = (s: string, v?: Record<string, string | number>) => string

const EMPTY: BuilderDeck = { name: '', commanders: [], cards: [] }
const TYPES = ['', 'creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle']

const groupLabel = (t: T, g: Group) =>
  ({
    creature: t('Creatures'),
    planeswalker: t('Planeswalkers'),
    instant: t('Instants'),
    sorcery: t('Sorceries'),
    artifact: t('Artifacts'),
    enchantment: t('Enchantments'),
    battle: t('Battles'),
    land: t('Lands'),
    other: t('Other'),
  })[g]

const typeLabel = (t: T, k: string) => (k ? groupLabel(t, k as Group) : t('All types'))

function problemText(t: T, p: Problem): string {
  switch (p.kind) {
    case 'no_commander':
      return t('Choose a commander (search with “Commanders” on, or use the crown on a card).')
    case 'bad_commander':
      return t('{name} can’t be a commander.', { name: p.name })
    case 'bad_pair':
      return t('These two can’t be commanders together (they need Partner, Background or similar).')
    case 'size':
      return p.n < DECK_SIZE
        ? t('{n} of 100 cards: {missing} to go.', { n: p.n, missing: DECK_SIZE - p.n })
        : t('{n} cards: {extra} too many.', { n: p.n, extra: p.n - DECK_SIZE })
    case 'identity':
      return t('Outside the commander’s colors: {names}', { names: p.names.join(', ') })
    case 'copies':
      return t('More copies than allowed (Commander is singleton): {names}', { names: p.names.join(', ') })
    case 'illegal':
      return t('Not legal in Commander: {names}', { names: p.names.join(', ') })
  }
}

/**
 * Deckbuilder: busca no Scryfall à esquerda, o deck à direita (comandantes, cartas por tipo, regras e
 * estatísticas). Salva pela mesma API da importação; o rascunho fica no navegador enquanto monta.
 */
export default function DeckBuilderPage() {
  const { id } = useParams()
  const { t } = useI18n()
  useTitle(id ? t('Edit deck') : t('Build a deck'))
  const existing = useQuery({ queryKey: ['me', 'deck', id], queryFn: () => api.myDeck(id!), enabled: !!id })
  if (id && existing.isPending) return <p className="text-center text-parchment/60">{t('Loading…')}</p>
  if (id && existing.isError) return <p className="text-center text-red-400">{existing.error.message}</p>
  return <Builder key={id ?? 'new'} id={id} saved={existing.data ? fromSavedDeck(existing.data) : null} />
}

function Builder({ id, saved }: { id?: string; saved: BuilderDeck | null }) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Rascunho do navegador (alterações ainda não salvas) tem prioridade sobre o deck salvo
  const [restored] = useState(() => loadDraft(id))
  const [deck, setDeck] = useState<BuilderDeck>(() => restored ?? saved ?? EMPTY)
  const [dirty, setDirty] = useState(!!restored)
  const [hover, setHover] = useState<BuilderCard | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (dirty) saveDraft(deck, id)
  }, [deck, dirty, id])

  const update = (fn: (d: BuilderDeck) => BuilderDeck) => {
    setDeck(fn)
    setDirty(true)
  }
  const add = (card: BuilderCard) =>
    update((d) => {
      if (d.commanders.some((c) => c.name === card.name) && maxCopies(card) === 1) return d
      const found = d.cards.find((e) => e.card.id === card.id)
      return found
        ? { ...d, cards: d.cards.map((e) => (e === found ? { ...e, qty: e.qty + 1 } : e)) }
        : { ...d, cards: [...d.cards, { card, qty: 1 }] }
    })
  const changeQty = (cardId: string, delta: number) =>
    update((d) => ({
      ...d,
      cards: d.cards.map((e) => (e.card.id === cardId ? { ...e, qty: e.qty + delta } : e)).filter((e) => e.qty > 0),
    }))
  const setCommander = (card: BuilderCard) =>
    update((d) => {
      if (d.commanders.some((c) => c.id === card.id)) return d
      // Até 2 comandantes; o terceiro troca o segundo. A carta sai da lista principal
      const commanders = d.commanders.length < 2 ? [...d.commanders, card] : [d.commanders[0], card]
      return { ...d, commanders, cards: d.cards.filter((e) => e.card.name !== card.name) }
    })
  const removeCommander = (cardId: string) => update((d) => ({ ...d, commanders: d.commanders.filter((c) => c.id !== cardId) }))

  const issues = problems(deck)
  const identity = deckIdentity(deck)
  const total = deckCount(deck)
  const price = deckPrice(deck)
  const inDeck = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of deck.cards) m.set(e.card.name, (m.get(e.card.name) ?? 0) + e.qty)
    for (const c of deck.commanders) m.set(c.name, (m.get(c.name) ?? 0) + 1)
    return m
  }, [deck])

  const save = useMutation({
    mutationFn: () =>
      api.saveMyDeck(
        { name: deck.name.trim(), decklist: toDecklist(deck), commanders: deck.commanders.map((c) => c.name) },
        id,
      ),
    onSuccess: (res) => {
      clearDraft(id)
      queryClient.invalidateQueries({ queryKey: ['me'] })
      queryClient.invalidateQueries({ queryKey: ['deck', 'user', res.slug] })
      navigate(`/deck-usuario/${res.slug}`, { state: { warnings: res.warnings } })
    },
  })
  const error = save.error instanceof ApiError ? save.error : null
  const discard = () => {
    clearDraft(id)
    setDeck(saved ?? EMPTY)
    setDirty(false)
  }
  const copyList = async () => {
    try {
      await navigator.clipboard.writeText(toDecklist(deck))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* sem permissão de área de transferência */
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl text-parchment">{id ? t('Edit deck') : t('Build a deck')}</h1>
        <Link to="/minha-pool/novo" className="text-sm text-parchment/50 underline-offset-4 hover:text-gold hover:underline">
          {t('Or paste a list (import)')}
        </Link>
        {dirty && (
          <span className="ml-auto flex items-center gap-2 text-xs text-parchment/50">
            {restored ? t('Unsaved draft restored.') : t('Draft saved in this browser.')}
            <button onClick={discard} className="text-gold underline hover:brightness-110">
              {id ? t('Discard changes') : t('Start over')}
            </button>
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <SearchPanel identity={identity} inDeck={inDeck} onAdd={add} onCommander={setCommander} onHover={setHover} />

        <aside className="space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:pr-1">
          <input
            value={deck.name}
            onChange={(e) => update((d) => ({ ...d, name: e.target.value.slice(0, 100) }))}
            placeholder={t('Deck name')}
            aria-label={t('Deck name')}
            className="font-display w-full rounded-lg border border-line bg-surface px-3 py-2 text-xl focus:border-gold focus:outline-none"
          />

          <section className="space-y-2 rounded-lg border border-line bg-surface/60 p-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-gold uppercase">{t('Commander')}</h2>
              {identity.length > 0 && <ColorIdentity colors={identity.join('')} />}
            </div>
            {deck.commanders.length === 0 ? (
              <p className="text-sm text-parchment/50">{t('No commander yet.')}</p>
            ) : (
              <ul className="space-y-1">
                {deck.commanders.map((c) => (
                  <li key={c.id} className="flex items-center gap-2" onMouseEnter={() => setHover(c)}>
                    <img src={c.small} alt="" className="h-10 w-7 rounded object-cover" />
                    <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
                    <button
                      onClick={() => removeCommander(c.id)}
                      aria-label={t('Remove {name}', { name: c.name })}
                      className="rounded p-1 text-parchment/50 hover:text-red-300"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface/60 p-3">
            <span className={`font-display text-2xl tabular-nums ${total === DECK_SIZE ? 'text-emerald-300' : 'text-parchment'}`}>
              {total}/{DECK_SIZE}
            </span>
            <span className="text-sm text-emerald-300/90 tabular-nums" title={t('Estimated value: sum of the card prices on Scryfall')}>
              {money(price, 'USD', locale)}
            </span>
            <Curve values={curve(deck)} />
          </section>

          {issues.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200">
              {issues.map((p, i) => (
                <li key={i}>• {problemText(t, p)}</li>
              ))}
            </ul>
          )}

          <DeckList deck={deck} onQty={changeQty} onCommander={setCommander} onHover={setHover} />

          {error && (
            <div className="space-y-1 rounded-lg border border-red-400/30 bg-red-400/5 p-3 text-sm text-red-300">
              <p>{error.message}</p>
              {error.details.length > 0 && (
                <ul className="list-inside list-disc text-xs text-red-300/80">
                  {error.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pb-2">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !deck.name.trim() || !deck.commanders.length}
              title={!deck.name.trim() ? t('Give the deck a name') : !deck.commanders.length ? t('Choose a commander') : undefined}
              className="font-display flex-1 rounded-md bg-gold px-5 py-2.5 text-xl tracking-wide text-ink transition hover:brightness-110 disabled:opacity-40"
            >
              {save.isPending ? t('Saving…') : id ? t('Save changes') : t('Save deck')}
            </button>
            <button
              onClick={copyList}
              title={t('Copy the list as text')}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 text-sm text-parchment/80 hover:border-parchment/40"
            >
              <Copy className="h-4 w-4" aria-hidden />
              {copied ? t('Copied!') : t('Copy list')}
            </button>
          </div>
          {issues.length > 0 && deck.commanders.length > 0 && (
            <p className="text-xs text-parchment/40">
              {t('You can save an unfinished deck and keep building it later.')}
            </p>
          )}
        </aside>
      </div>

      {hover?.image && (
        <img
          src={hover.image}
          alt=""
          aria-hidden
          className="pointer-events-none fixed bottom-4 left-4 z-30 hidden w-64 rounded-[4.5%] shadow-2xl shadow-black xl:block"
        />
      )}
    </div>
  )
}

/** Busca de cartas no Scryfall: texto, tipo, custo, dentro das cores do comandante, ou comandantes */
function SearchPanel({
  identity,
  inDeck,
  onAdd,
  onCommander,
  onHover,
}: {
  identity: string[]
  inDeck: Map<string, number>
  onAdd: (c: BuilderCard) => void
  onCommander: (c: BuilderCard) => void
  onHover: (c: BuilderCard | null) => void
}) {
  const { t } = useI18n()
  const [filters, setFilters] = useState<SearchFilters>({
    text: '',
    type: '',
    cmc: '',
    inIdentity: true,
    commander: identity.length === 0,
  })
  const set = (patch: Partial<SearchFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const query = buildQuery({ ...filters, text: useDebounce(filters.text, 400) }, identity)
  const [pages, setPages] = useState<{ query: string; data: SearchPage[] }>({ query: '', data: [] })
  const [failed, setFailed] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  useEffect(() => {
    const ctrl = new AbortController()
    searchCards(query, ctrl.signal)
      .then((page) => {
        setPages({ query, data: [page] })
        setFailed(null)
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) setFailed(String(err))
      })
    return () => ctrl.abort()
  }, [query])
  const loading = pages.query !== query && !failed
  const cards = pages.query === query ? pages.data.flatMap((p) => p.cards) : []
  const last = pages.data.at(-1)
  const more = async () => {
    if (!last?.next) return
    setLoadingMore(true)
    try {
      const page = await searchCards(query, undefined, last.next)
      setPages((p) => (p.query === query ? { query, data: [...p.data, page] } : p))
    } finally {
      setLoadingMore(false)
    }
  }
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition ${
      on ? 'border-gold bg-gold/15 text-gold' : 'border-line text-parchment/60 hover:text-parchment'
    }`

  return (
    <section className="min-w-0 space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-parchment/40" aria-hidden />
        <input
          autoFocus
          value={filters.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder={filters.commander ? t('Search commanders (e.g. Atraxa)') : t('Search cards (name, or Scryfall syntax: o:draw)')}
          aria-label={t('Search cards')}
          className="w-full rounded-lg border border-line bg-surface py-2.5 pr-3 pl-9 focus:border-gold focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => set({ commander: !filters.commander })} aria-pressed={filters.commander} className={chip(filters.commander)}>
          <Crown className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          {t('Commanders')}
        </button>
        {!filters.commander && (
          <button onClick={() => set({ inIdentity: !filters.inIdentity })} aria-pressed={filters.inIdentity} className={chip(filters.inIdentity)}>
            {t('Commander’s colors only')}
          </button>
        )}
        <select
          value={filters.type}
          onChange={(e) => set({ type: e.target.value })}
          aria-label={t('Card type')}
          className="rounded-lg border border-line bg-ink px-2 py-1 text-sm"
        >
          {TYPES.map((k) => (
            <option key={k} value={k}>
              {typeLabel(t, k)}
            </option>
          ))}
        </select>
        <select
          value={filters.cmc}
          onChange={(e) => set({ cmc: e.target.value })}
          aria-label={t('Mana value')}
          className="rounded-lg border border-line bg-ink px-2 py-1 text-sm"
        >
          <option value="">{t('Any mana value')}</option>
          {['0', '1', '2', '3', '4', '5', '6'].map((n) => (
            <option key={n} value={n}>
              {t('Mana value {n}', { n })}
            </option>
          ))}
          <option value="7">{t('Mana value 7+')}</option>
        </select>
        <span className="ml-auto text-xs text-parchment/40">
          {!loading && !failed && pages.data[0] ? t('{n} cards', { n: pages.data[0].total }) : ''}
        </span>
      </div>

      {failed && <p className="text-sm text-red-300">{t('Could not reach Scryfall. Try again in a moment.')}</p>}
      {loading && <p className="text-sm text-parchment/50">{t('Loading…')}</p>}
      {!loading && !failed && cards.length === 0 && <p className="text-sm text-parchment/50">{t('No cards found.')}</p>}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
        {cards.map((c) => {
          const n = inDeck.get(c.name) ?? 0
          const commanderPick = filters.commander && canCommand(c)
          return (
            <li key={c.id} className="group relative" onMouseEnter={() => onHover(c)} onMouseLeave={() => onHover(null)}>
              <button
                onClick={() => {
                  if (!commanderPick) return onAdd(c)
                  onCommander(c)
                  set({ commander: false, text: '' }) // escolheu o comandante: agora busca as cartas do deck
                }}
                title={commanderPick ? t('Make {name} your commander', { name: c.name }) : t('Add {name}', { name: c.name })}
                className="block w-full overflow-hidden rounded-[4.5%] transition hover:ring-2 hover:ring-gold"
              >
                <img src={c.small} alt={c.name} loading="lazy" className="w-full" />
              </button>
              {n > 0 && (
                <span className="pointer-events-none absolute top-1 left-1 rounded-full bg-gold px-1.5 text-xs font-bold text-ink">
                  {n}
                </span>
              )}
              {!filters.commander && canCommand(c) && (
                <button
                  onClick={() => onCommander(c)}
                  title={t('Make {name} your commander', { name: c.name })}
                  aria-label={t('Make {name} your commander', { name: c.name })}
                  className="absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-full bg-ink/85 text-gold opacity-0 ring-1 ring-line transition group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Crown className="h-4 w-4" aria-hidden />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {last?.next && !loading && (
        <button
          onClick={more}
          disabled={loadingMore}
          className="w-full rounded-lg border border-line py-2 text-sm text-parchment/70 hover:border-parchment/40 disabled:opacity-50"
        >
          {loadingMore ? t('Loading…') : t('Load more')}
        </button>
      )}
    </section>
  )
}

/** Cartas do deck por tipo, com quantidade (+/−), custo, preço e a coroa para virar comandante */
function DeckList({
  deck,
  onQty,
  onCommander,
  onHover,
}: {
  deck: BuilderDeck
  onQty: (id: string, delta: number) => void
  onCommander: (c: BuilderCard) => void
  onHover: (c: BuilderCard | null) => void
}) {
  const { t, locale } = useI18n()
  if (!deck.cards.length) return <p className="text-sm text-parchment/50">{t('Click cards on the left to add them.')}</p>
  const groups = GROUPS.map((g) => ({
    g,
    cards: deck.cards.filter((e) => groupOf(e.card) === g).sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name)),
  })).filter((x) => x.cards.length)
  return (
    <div className="space-y-3">
      {groups.map(({ g, cards }) => (
        <section key={g}>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-parchment/60 uppercase">
            {groupLabel(t, g)} ({cards.reduce((n, e) => n + e.qty, 0)})
          </h3>
          <ul className="divide-y divide-line/60 rounded-lg border border-line bg-surface/40">
            {cards.map((e) => (
              <li
                key={e.card.id}
                onMouseEnter={() => onHover(e.card)}
                onMouseLeave={() => onHover(null)}
                className="flex items-center gap-1.5 px-2 py-1 text-sm"
              >
                <QtyButton label={t('Remove one')} onClick={() => onQty(e.card.id, -1)}>
                  {e.qty > 1 ? <Minus className="h-3.5 w-3.5" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                </QtyButton>
                <span className="w-5 text-center tabular-nums">{e.qty}</span>
                <QtyButton label={t('Add one')} onClick={() => onQty(e.card.id, 1)} disabled={e.qty >= maxCopies(e.card)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </QtyButton>
                <span className="min-w-0 flex-1 truncate">{e.card.name}</span>
                {canCommand(e.card) && deck.commanders.length < 2 && (
                  <button
                    onClick={() => onCommander(e.card)}
                    title={t('Make {name} your commander', { name: e.card.name })}
                    aria-label={t('Make {name} your commander', { name: e.card.name })}
                    className="rounded p-0.5 text-parchment/40 hover:text-gold"
                  >
                    <Crown className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
                <ManaCost cost={e.card.manaCost.split(' // ')[0]} className="shrink-0 text-xs" />
                <span className="w-14 shrink-0 text-right text-xs text-parchment/50 tabular-nums">
                  {e.card.priceUsd != null ? money(e.card.priceUsd * e.qty, 'USD', locale) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function QtyButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-6 w-6 place-items-center rounded border border-line text-parchment/70 transition enabled:hover:border-gold enabled:hover:text-gold disabled:opacity-30"
    >
      {children}
    </button>
  )
}

/** Curva de mana em barras (sem terrenos), de 0 a 7+ */
function Curve({ values }: { values: number[] }) {
  const { t } = useI18n()
  const max = Math.max(1, ...values)
  return (
    <div className="ml-auto flex h-10 items-end gap-1" role="img" aria-label={t('Mana curve')}>
      {values.map((v, i) => (
        <div key={i} className="flex w-4 flex-col items-center gap-0.5" title={`${i === 7 ? '7+' : i}: ${v}`}>
          <div className="w-full rounded-t bg-gold/70" style={{ height: `${(v / max) * 26}px` }} />
          <span className="text-[0.55rem] leading-none text-parchment/40">{i === 7 ? '7+' : i}</span>
        </div>
      ))}
    </div>
  )
}
