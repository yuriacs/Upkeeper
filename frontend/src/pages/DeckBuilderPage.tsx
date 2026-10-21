import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleHelp, Copy, Crown, Hand, ImagePlus, LayoutGrid, Lightbulb, List, Plus, Search, Sparkles, Star, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ColorIdentity } from '../components/Mana'
import { ColorBalance, DeckView, Playtest, type GroupBy, type SortBy, type ViewAs } from '../components/builder/DeckView'
import { CARD_TYPES, cardTypeLabel } from '../components/builder/labels'
import { Suggestions } from '../components/builder/Suggestions'
import { Favorites } from '../components/builder/Favorites'
import FavoriteButton from '../components/builder/FavoriteButton'
import CardArtDialog from '../components/builder/CardArtDialog'
import { LiveEstimate } from '../components/builder/LiveEstimate'
import { useFavorites } from '../lib/favorites'
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
  fetchMaybe,
  findByName,
  fromSavedDeck,
  loadDraft,
  maxCopies,
  readDecklistText,
  problems,
  saveDraft,
  searchCards,
  toDecklist,
  type BuilderCard,
  type BuilderDeck,
  type DeckEntry,
  type Problem,
  type Role,
  type SearchField,
  type SearchFilters,
  type SearchPage,
} from '../lib/deckbuilder'
import { setBuilderHover, useBuilderHover } from '../lib/builderHover'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/money'
import { COLOR_NAMES } from '../lib/colors'

type T = (s: string, v?: Record<string, string | number>) => string

const EMPTY: BuilderDeck = { name: '', commanders: [], cards: [], maybe: [] }
const TYPES = CARD_TYPES

const typeLabel = cardTypeLabel

/** Preferências de exibição do deck (só neste navegador) */
const VIEW_KEY = 'precon-builder-view'
type ViewPrefs = { groupBy: GroupBy; sortBy: SortBy; viewAs: ViewAs }
function readPrefs(): ViewPrefs {
  const fallback: ViewPrefs = { groupBy: 'role', sortBy: 'cmc', viewAs: 'list' }
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') }
  } catch {
    return fallback
  }
}
function writePrefs(p: ViewPrefs) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(p))
  } catch {
    /* navegador sem armazenamento */
  }
}

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
  return (
    <Builder
      key={id ?? 'new'}
      id={id}
      saved={existing.data ? fromSavedDeck(existing.data) : null}
      savedText={existing.data?.decklist_text ?? ''}
      savedArts={existing.data?.arts}
    />
  )
}

function Builder({
  id,
  saved,
  savedText,
  savedArts,
}: {
  id?: string
  saved: BuilderDeck | null
  savedText: string
  savedArts?: Record<string, string>
}) {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Rascunho do navegador (alterações ainda não salvas) tem prioridade sobre o deck salvo
  const [restored] = useState(() => loadDraft(id))
  const [deck, setDeck] = useState<BuilderDeck>(() => restored ?? saved ?? EMPTY)
  const [dirty, setDirty] = useState(!!restored)
  const [copied, setCopied] = useState(false)
  const [prefs, setPrefs] = useState(readPrefs)
  const [filter, setFilter] = useState('')
  const [playtest, setPlaytest] = useState(false)
  // Artes personalizadas das cartas (só em deck já salvo: ficam ligadas ao deck)
  const [arts, setArts] = useState<Record<string, string>>(() => savedArts ?? {})
  const [artFor, setArtFor] = useState<BuilderCard | null>(null)
  const [leftTab, setLeftTab] = useState<'search' | 'suggest' | 'favorites'>('search')
  // Maybeboard do deck salvo: só existe no texto da lista, então as cartas vêm do Scryfall
  const [savedMaybe, setSavedMaybe] = useState<DeckEntry[]>([])
  useEffect(() => {
    const lines = readDecklistText(savedText).maybe
    if (!lines.length) return
    let alive = true
    fetchMaybe(lines).then((maybe) => {
      if (!alive) return
      setSavedMaybe(maybe)
      if (!restored) setDeck((d) => ({ ...d, maybe }))
    })
    return () => {
      alive = false
    }
  }, [savedText, restored])
  useEffect(() => {
    if (dirty) saveDraft(deck, id)
  }, [deck, dirty, id])
  const setPref = (patch: Partial<ViewPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch }
      writePrefs(next)
      return next
    })

  // Função de cada carta (ramp, compra...) para agrupar: vem do backend pelas tags do Scryfall
  const oracleCards = useMemo(() => {
    const seen = new Map<string, string>()
    for (const e of [...deck.cards, ...deck.maybe]) if (e.card.oracleId) seen.set(e.card.oracleId, e.card.name)
    return [...seen]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 300)
      .map(([oracle_id, name]) => ({ oracle_id, name }))
  }, [deck.cards, deck.maybe])
  const roles = useQuery({
    queryKey: ['card-roles', oracleCards.map((c) => c.oracle_id).join(',')],
    queryFn: () => api.cardRoles(oracleCards).then((r) => r.roles),
    enabled: oracleCards.length > 0 && prefs.groupBy === 'role',
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  })

  const update = (fn: (d: BuilderDeck) => BuilderDeck) => {
    setDeck(fn)
    setDirty(true)
  }
  const addTo = (d: BuilderDeck, card: BuilderCard, qty = 1, category?: string): BuilderDeck => {
    if (d.commanders.some((c) => c.name === card.name) && maxCopies(card) === 1) return d
    const found = d.cards.find((e) => e.card.id === card.id)
    return found
      ? { ...d, cards: d.cards.map((e) => (e === found ? { ...e, qty: Math.min(maxCopies(card), e.qty + qty) } : e)) }
      : { ...d, cards: [...d.cards, { card, qty, ...(category ? { category } : {}) }] }
  }
  const add = (card: BuilderCard) => update((d) => addTo(d, card))
  const changeQty = (cardId: string, delta: number) =>
    update((d) => ({
      ...d,
      cards: d.cards.map((e) => (e.card.id === cardId ? { ...e, qty: e.qty + delta } : e)).filter((e) => e.qty > 0),
    }))
  const setCategory = (cardId: string, category: Role | undefined) =>
    update((d) => ({
      ...d,
      cards: d.cards.map((e) => (e.card.id !== cardId ? e : category ? { ...e, category } : { card: e.card, qty: e.qty })),
    }))
  const addMaybe = (card: BuilderCard) =>
    update((d) => (d.maybe.some((e) => e.card.name === card.name) ? d : { ...d, maybe: [...d.maybe, { card, qty: 1 }] }))
  const toMaybe = (cardId: string) =>
    update((d) => {
      const e = d.cards.find((x) => x.card.id === cardId)
      if (!e) return d
      const cards = d.cards.filter((x) => x !== e)
      return { ...d, cards, maybe: d.maybe.some((m) => m.card.name === e.card.name) ? d.maybe : [...d.maybe, e] }
    })
  const fromMaybe = (cardId: string) =>
    update((d) => {
      const e = d.maybe.find((x) => x.card.id === cardId)
      if (!e) return d
      return { ...addTo(d, e.card, e.qty, e.category), maybe: d.maybe.filter((x) => x !== e) }
    })
  const removeMaybe = (cardId: string) => update((d) => ({ ...d, maybe: d.maybe.filter((e) => e.card.id !== cardId) }))
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
    setDeck(saved ? { ...saved, maybe: savedMaybe } : EMPTY)
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

  const select = 'rounded-lg border border-line bg-ink px-2 py-1 text-sm text-parchment'
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          {/* Buscar no Scryfall ou ver sugestões para o comandante (EDHREC) */}
          <div role="tablist" className="mb-3 flex gap-1 rounded-lg border border-line p-1">
            {(
              [
                ['search', t('Search'), Search],
                ['suggest', t('Suggestions'), Sparkles],
                ['favorites', t('Favorite cards'), Star],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={leftTab === key}
                onClick={() => setLeftTab(key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-semibold transition ${
                  leftTab === key ? 'bg-gold/15 text-gold' : 'text-parchment/60 hover:text-parchment'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <div className={leftTab === 'search' ? '' : 'hidden'}>
            <SearchPanel identity={identity} inDeck={inDeck} onAdd={add} onMaybe={addMaybe} onCommander={setCommander} onHover={setBuilderHover} />
          </div>
          {leftTab === 'suggest' && <Suggestions deck={deck} onAdd={add} onMaybe={addMaybe} onHover={setBuilderHover} />}
          {leftTab === 'favorites' && (
            <Favorites identity={identity} inDeck={inDeck} onAdd={add} onMaybe={addMaybe} onCommander={setCommander} onHover={setBuilderHover} />
          )}
        </div>

        <section className="min-w-0 space-y-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
            <div className="space-y-3">
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
                    {deck.commanders.map((c) => {
                      const art = c.oracleId ? arts[c.oracleId] : undefined
                      return (
                        <li
                          key={c.id}
                          className="flex items-center gap-2"
                          onMouseEnter={() => setBuilderHover(art ? { ...c, image: art, small: art } : c)}
                          onMouseLeave={() => setBuilderHover(null)}
                        >
                          <img src={art ?? c.small} alt="" className="h-10 w-7 rounded object-cover" />
                          <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
                          {c.oracleId && (
                            <button
                              onClick={() => setArtFor(c)}
                              aria-label={t('Custom art for {name}', { name: c.name })}
                              title={t('Custom art for {name}', { name: c.name })}
                              className={`rounded p-1 hover:text-gold ${art ? 'text-gold' : 'text-parchment/50'}`}
                            >
                              <ImagePlus className="h-4 w-4" aria-hidden />
                            </button>
                          )}
                          <button
                            onClick={() => removeCommander(c.id)}
                            aria-label={t('Remove {name}', { name: c.name })}
                            className="rounded p-1 text-parchment/50 hover:text-red-300"
                          >
                            <X className="h-4 w-4" aria-hidden />
                          </button>
                        </li>
                      )
                    })}
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
            </div>
            <div className="space-y-3">
              <ColorBalance deck={deck} />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => save.mutate()}
                  disabled={save.isPending || !deck.name.trim() || !deck.commanders.length}
                  title={!deck.name.trim() ? t('Give the deck a name') : !deck.commanders.length ? t('Choose a commander') : undefined}
                  className="font-display flex-1 rounded-md btn-ember px-5 py-2.5 text-xl tracking-wide text-ink transition hover:brightness-110 disabled:opacity-40"
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
                <p className="text-xs text-parchment/40">{t('You can save an unfinished deck and keep building it later.')}</p>
              )}
            </div>
          </div>

          {issues.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200">
              {issues.map((p, i) => (
                <li key={i}>• {problemText(t, p)}</li>
              ))}
            </ul>
          )}
          <LiveEstimate deck={deck} />
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

          {/* Barra do deck: agrupar, ordenar, lista ou imagens, filtro, adicionar pelo nome e mão de teste */}
          <div className="flex flex-wrap items-center gap-2 border-y border-line py-2">
            <label className="flex items-center gap-1.5 text-xs text-parchment/60">
              {t('Group by')}
              <select value={prefs.groupBy} onChange={(e) => setPref({ groupBy: e.target.value as GroupBy })} className={select}>
                <option value="role">{t('Function (ramp, draw...)')}</option>
                <option value="type">{t('Card type')}</option>
                <option value="cmc">{t('Mana value')}</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-parchment/60">
              {t('Sort by')}
              <select value={prefs.sortBy} onChange={(e) => setPref({ sortBy: e.target.value as SortBy })} className={select}>
                <option value="cmc">{t('Mana value')}</option>
                <option value="name">{t('Name')}</option>
                <option value="price">{t('Price')}</option>
              </select>
            </label>
            <div role="group" aria-label={t('View')} className="flex overflow-hidden rounded-lg border border-line">
              <ViewButton on={prefs.viewAs === 'list'} onClick={() => setPref({ viewAs: 'list' })} icon={<List className="h-3.5 w-3.5" aria-hidden />} label={t('List')} />
              <ViewButton
                on={prefs.viewAs === 'stacks'}
                onClick={() => setPref({ viewAs: 'stacks' })}
                icon={<LayoutGrid className="h-3.5 w-3.5" aria-hidden />}
                label={t('Images')}
              />
            </div>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('Filter the deck')}
              aria-label={t('Filter the deck')}
              className="w-32 rounded-lg border border-line bg-surface px-2 py-1 text-sm focus:border-gold focus:outline-none"
            />
            <QuickAdd onAdd={add} />
            <button
              onClick={() => setPlaytest(true)}
              disabled={!deck.cards.length}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1 text-sm text-parchment/80 hover:border-parchment/40 disabled:opacity-40"
            >
              <Hand className="h-4 w-4" aria-hidden />
              {t('Sample hand')}
            </button>
          </div>

          <DeckView
            deck={deck}
            roles={roles.data ?? {}}
            groupBy={prefs.groupBy}
            sortBy={prefs.sortBy}
            viewAs={prefs.viewAs}
            filter={filter}
            actions={{
              onQty: changeQty,
              onCategory: setCategory,
              onMaybe: toMaybe,
              onCommander: setCommander,
              onHover: setBuilderHover,
              arts,
              onArt: setArtFor,
            }}
            onMaybeToDeck={fromMaybe}
            onMaybeRemove={removeMaybe}
          />
        </section>
      </div>

      {playtest && <Playtest deck={deck} onClose={() => setPlaytest(false)} />}
      {artFor && (
        <CardArtDialog
          card={artFor}
          assign={id ? (art) => api.setDeckCardArt(id, artFor.oracleId, art) : undefined}
          current={arts[artFor.oracleId]}
          onChange={(next) => {
            setArts(next)
            queryClient.invalidateQueries({ queryKey: ['deck', 'user', id] })
            queryClient.invalidateQueries({ queryKey: ['me', 'deck', id] })
          }}
          onClose={() => setArtFor(null)}
        />
      )}

      <HoverPreview />
    </div>
  )
}

/** Carta sob o mouse, ampliada no alto à esquerda (logo abaixo do menu fixo do site) */
function HoverPreview() {
  const hover = useBuilderHover()
  // Ao sair da página, a prévia não fica para a próxima vez
  useEffect(() => () => setBuilderHover(null), [])
  if (!hover?.image) return null
  return (
    <img
      src={hover.image}
      alt=""
      aria-hidden
      className="pointer-events-none fixed top-20 left-4 z-30 hidden w-64 rounded-[4.5%] shadow-2xl shadow-black xl:block"
    />
  )
}

function ViewButton({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs ${on ? 'bg-gold/15 text-gold' : 'text-parchment/60 hover:text-parchment'}`}
    >
      {icon}
      {label}
    </button>
  )
}

/** Adicionar digitando o nome (aproximado: "sol rng" acha Sol Ring) e Enter */
function QuickAdd({ onAdd }: { onAdd: (c: BuilderCard) => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'missing'>('idle')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setState('busy')
    const card = await findByName(name.trim()).catch(() => null)
    if (!card) return setState('missing')
    onAdd(card)
    setName('')
    setState('idle')
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-1">
      <input
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          setState('idle')
        }}
        placeholder={t('Add by name')}
        aria-label={t('Add by name')}
        title={state === 'missing' ? t('No cards found.') : undefined}
        className={`w-40 rounded-lg border bg-surface px-2 py-1 text-sm focus:outline-none ${
          state === 'missing' ? 'border-red-400/60' : 'border-line focus:border-gold'
        }`}
      />
      <button
        type="submit"
        disabled={state === 'busy'}
        aria-label={t('Add')}
        title={t('Add')}
        className="grid h-7 w-7 place-items-center rounded-md border border-line text-parchment/70 hover:border-gold hover:text-gold disabled:opacity-40"
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </form>
  )
}

/** Busca de cartas no Scryfall: texto, tipo, custo, dentro das cores do comandante, ou comandantes */
function SearchPanel({
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
  const [filters, setFilters] = useState<SearchFilters>({
    text: '',
    field: 'name',
    type: '',
    cmc: '',
    inIdentity: true,
    commander: identity.length === 0,
    colors: [],
  })
  const set = (patch: Partial<SearchFilters>) => setFilters((f) => ({ ...f, ...patch }))
  const query = buildQuery({ ...filters, text: useDebounce(filters.text, 400) }, identity)
  const [pages, setPages] = useState<{ query: string; data: SearchPage[] }>({ query: '', data: [] })
  const [failed, setFailed] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [help, setHelp] = useState(false)
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
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-parchment/40" aria-hidden />
          <input
            autoFocus
            value={filters.text}
            onChange={(e) => set({ text: e.target.value })}
            placeholder={fieldPlaceholder(t, filters.field, filters.commander)}
            aria-label={t('Search cards')}
            className="w-full rounded-lg border border-line bg-surface py-2.5 pr-3 pl-9 focus:border-gold focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setHelp((h) => !h)}
          aria-expanded={help}
          aria-label={t('How to search')}
          title={t('How to search')}
          className={`grid w-10 shrink-0 place-items-center rounded-lg border transition ${
            help ? 'border-gold text-gold' : 'border-line text-parchment/60 hover:text-parchment'
          }`}
        >
          <CircleHelp className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {/* Onde procurar o que foi digitado */}
      <div role="group" aria-label={t('Search in')} className="flex items-center gap-1 text-xs">
        <span className="mr-1 text-parchment/50">{t('Search in')}</span>
        {(['name', 'text', 'type'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => set({ field: f })}
            aria-pressed={filters.field === f}
            className={`rounded-md px-2 py-1 font-semibold transition ${
              filters.field === f ? 'bg-gold/15 text-gold' : 'text-parchment/60 hover:text-parchment'
            }`}
          >
            {f === 'name' ? t('Name') : f === 'text' ? t('Card text') : t('Type')}
          </button>
        ))}
      </div>
      {help && <SearchHelp onPick={(text) => set({ text })} />}
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
        <ColorFilter
          colors={filters.colors}
          commander={filters.commander}
          onChange={(colors) => set({ colors })}
        />
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
                {/* Formato da carta reservado: enquanto a imagem carrega, a grade não se amontoa */}
                <img src={c.small} alt={c.name} loading="lazy" className="aspect-[488/680] w-full bg-surface" />
              </button>
              {/* Preço desta edição no Scryfall, antes de adicionar */}
              <span className="pointer-events-none absolute right-1 bottom-1 rounded-full bg-ink/90 px-1.5 text-[0.7rem] font-semibold text-emerald-300 tabular-nums ring-1 ring-line">
                {c.priceUsd != null ? money(c.priceUsd, 'USD', locale) : '—'}
              </span>
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
              {!filters.commander && (
                <button
                  onClick={() => onMaybe(c)}
                  title={t('Add {name} to the maybeboard', { name: c.name })}
                  aria-label={t('Add {name} to the maybeboard', { name: c.name })}
                  className="absolute right-1 bottom-7 grid h-7 w-7 place-items-center rounded-full bg-ink/85 text-sky-300 opacity-0 ring-1 ring-line transition group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Lightbulb className="h-4 w-4" aria-hidden />
                </button>
              )}
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

function fieldPlaceholder(t: T, field: SearchField, commander: boolean): string {
  if (field === 'text') return t('Words in the card text (e.g. draw a card)')
  if (field === 'type') return t('Type or subtype (e.g. dragon, equipment)')
  return commander ? t('Search commanders (e.g. Atraxa)') : t('Part of the name (e.g. draw)')
}

/** Exemplos de busca (clicáveis) e o resumo da sintaxe do Scryfall */
function SearchHelp({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useI18n()
  const examples: [string, string][] = [
    ['name:draw', t('“draw” in the name')],
    ['o:"draw a card"', t('“draw a card” in the text')],
    ['t:dragon', t('Dragons')],
    ['o:destroy t:instant', t('Instants that destroy')],
    ['t:creature pow>=5', t('Creatures with power 5 or more')],
    ['o:"search your library" -t:land', t('Tutors (not lands)')],
    ['t:creature kw:flying', t('Creatures with flying')],
    ['is:fetchland or is:dual', t('Fetch and dual lands')],
  ]
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface/60 p-3 text-xs">
      <p className="text-parchment/70">
        {t('Pick where to look (name, text or type) and type normally. For more, use the Scryfall syntax: it works in any mode.')}
      </p>
      <ul className="space-y-0.5">
        {examples.map(([q, label]) => (
          <li key={q}>
            <button
              type="button"
              onClick={() => onPick(q)}
              className="flex w-full items-baseline gap-2 rounded px-1.5 py-0.5 text-left hover:bg-gold/10"
            >
              <code className="shrink-0 text-gold">{q}</code>
              <span className="truncate text-parchment/60">{label}</span>
            </button>
          </li>
        ))}
      </ul>
      <a
        href="https://scryfall.com/docs/syntax"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-parchment/50 underline-offset-4 hover:text-gold hover:underline"
      >
        {t('All of the Scryfall syntax')}
      </a>
    </div>
  )
}

/** Símbolos de mana para filtrar por cor (W U B R G e incolor) */
function ColorFilter({
  colors,
  commander,
  onChange,
}: {
  colors: string[]
  commander: boolean
  onChange: (c: string[]) => void
}) {
  const { t } = useI18n()
  const toggle = (c: string) => onChange(colors.includes(c) ? colors.filter((x) => x !== c) : [...colors, c])
  return (
    <div
      role="group"
      aria-label={t('Filter by color')}
      title={
        commander
          ? t('Commanders with exactly these colors')
          : t('Cards of any of these colors')
      }
      className="flex items-center gap-1"
    >
      {COLOR_FILTERS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => toggle(c)}
          aria-pressed={colors.includes(c)}
          aria-label={t(COLOR_NAMES[c] ?? c)}
          className={`grid h-7 w-7 place-items-center rounded-full transition ${
            colors.includes(c) ? 'ring-2 ring-gold' : 'opacity-40 grayscale hover:opacity-80 hover:grayscale-0'
          }`}
        >
          <i className={`ms ms-${c.toLowerCase()} ms-cost ms-shadow`} aria-hidden />
        </button>
      ))}
      {colors.length > 0 && (
        <span className="text-xs text-parchment/50">
          {commander ? t('exactly these colors') : t('any of these colors')}
        </span>
      )}
      {colors.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          aria-label={t('Clear colors')}
          title={t('Clear colors')}
          className="rounded p-1 text-parchment/50 hover:text-gold"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}

const COLOR_FILTERS = ['W', 'U', 'B', 'R', 'G', 'C'] as const

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
