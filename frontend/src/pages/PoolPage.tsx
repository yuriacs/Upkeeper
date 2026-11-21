import { useTitle } from '../hooks/useTitle'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Folder, FolderOpen, Library, Search, Tag, Tags, WandSparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import DeckTile from '../components/DeckTile'
import DeckTileSkeleton from '../components/DeckTileSkeleton'
import { useMyDecks } from '../hooks/useMyDecks'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n, useT } from '../lib/i18n'
import { readJSON, writeJSON } from '../lib/storage'
import type { DeckSummary, PoolOrganize } from '../lib/types'

/*
 * Meu pool: os decks montados e os precons que você tem, numa grade só, com busca, filtros (tipo,
 * cores, bracket), ordem, pastas e etiquetas (organize: o botão de pasta em cada deck). A coleção de
 * cartas tem a página dela (/my-pool/collection).
 */

type Item = { deck: DeckSummary; kind: 'user' | 'precon'; org: PoolOrganize }
type Filters = { q: string; kind: 'all' | 'user' | 'precon'; colors: string; bracket: number | null; sort: string; folder: string | null; tags: string[] }

const FILTER_KEY = 'upkeeper:pool-filters'
const DEFAULT_FILTERS: Filters = { q: '', kind: 'all', colors: '', bracket: null, sort: 'name', folder: null, tags: [] }
const COLORS = ['W', 'U', 'B', 'R', 'G'] as const
const NO_FOLDER = '\u0000' // filtro "sem pasta"

const price = (d: DeckSummary) => (d.price_usd ? Number(d.price_usd) : -1)

export default function PoolPage() {
  const t = useT()
  const { locale } = useI18n()
  useTitle(t('My pool'))
  const { user } = useAuth()
  const myPrecons = useMyDecks()
  const myDecks = useQuery({ queryKey: ['me', 'decks', user?.id], queryFn: api.myDecks })
  const precons = useQuery({
    queryKey: ['me', 'precon-tiles', myPrecons.slugs],
    queryFn: () => api.decks({ slugs: myPrecons.slugs.join(',') }, 1, 200),
    enabled: myPrecons.slugs.length > 0,
  })
  const collection = useQuery({ queryKey: ['me', 'collection', { page: '1' }], queryFn: () => api.myCollection({ page: '1' }) })
  const [f, setF] = useState<Filters>(() => ({ ...DEFAULT_FILTERS, ...readJSON<Partial<Filters>>(FILTER_KEY, {}), q: '' }))
  const set = (patch: Partial<Filters>) =>
    setF((prev) => {
      const next = { ...prev, ...patch }
      writeJSON(FILTER_KEY, { ...next, q: '' })
      return next
    })
  const [organizing, setOrganizing] = useState<Item | null>(null)

  const items: Item[] = useMemo(
    () => [
      ...(myDecks.data ?? []).map((deck) => ({
        deck,
        kind: 'user' as const,
        org: { folder: deck.folder ?? '', tags: deck.tags ?? [], added: deck.created_at },
      })),
      ...(precons.data?.results ?? []).map((deck) => ({
        deck,
        kind: 'precon' as const,
        org: myPrecons.organize[deck.slug] ?? { folder: '', tags: [] },
      })),
    ],
    [myDecks.data, precons.data, myPrecons.organize],
  )
  const folders = useMemo(() => {
    const count = new Map<string, number>()
    for (const it of items) if (it.org.folder) count.set(it.org.folder, (count.get(it.org.folder) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => a[0].localeCompare(b[0], locale))
  }, [items, locale])
  const allTags = useMemo(() => {
    const count = new Map<string, number>()
    for (const it of items) for (const tag of it.org.tags) count.set(tag, (count.get(tag) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], locale))
  }, [items, locale])
  const unfiled = items.filter((it) => !it.org.folder).length
  // Pasta ou etiqueta que deixou de existir (o deck saiu dela, filtro salvo de outra vez): não filtra
  const folder = f.folder !== null && f.folder !== NO_FOLDER && !folders.some(([name]) => name === f.folder) ? null : f.folder
  const activeTags = f.tags.filter((tag) => allTags.some(([name]) => name === tag))

  const q = f.q.trim().toLocaleLowerCase()
  const shown = items
    .filter((it) => f.kind === 'all' || it.kind === f.kind)
    .filter((it) => folder === null || (folder === NO_FOLDER ? !it.org.folder : it.org.folder === folder))
    .filter((it) => activeTags.every((tag) => it.org.tags.includes(tag)))
    .filter((it) => [...f.colors].every((c) => it.deck.color_identity.includes(c)))
    .filter((it) => f.bracket === null || it.deck.bracket === f.bracket)
    .filter(
      (it) =>
        !q ||
        it.deck.name.toLocaleLowerCase().includes(q) ||
        (it.deck.face_commander?.name ?? '').toLocaleLowerCase().includes(q) ||
        it.org.tags.some((tag) => tag.toLocaleLowerCase().includes(q)),
    )
    .sort((a, b) => {
      switch (f.sort) {
        case 'recent':
          return (b.org.added ?? '').localeCompare(a.org.added ?? '')
        case 'bracket':
          return (b.deck.bracket ?? 0) - (a.deck.bracket ?? 0) || a.deck.name.localeCompare(b.deck.name, locale)
        case 'power':
          return (b.deck.power ?? 0) - (a.deck.power ?? 0)
        case 'price':
          return price(b.deck) - price(a.deck)
        default:
          return a.deck.name.localeCompare(b.deck.name, locale)
      }
    })
  const loading = myDecks.isPending || (myPrecons.slugs.length > 0 && precons.isPending)
  const filtering = f.q || f.kind !== 'all' || f.colors || f.bracket !== null || folder !== null || activeTags.length > 0
  const totals = collection.data?.totals

  const chip = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
      on ? 'border-gold bg-gold/15 text-gold' : 'border-line text-parchment/70 hover:border-parchment/40'
    }`

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl text-parchment">{t('My pool')}</h1>
        <p className="text-parchment/70">
          {t(items.length === 1 ? '{n} deck from' : '{n} decks from', { n: myPrecons.slugs.length + (myDecks.data?.length ?? 0) })}{' '}
          <strong className="text-parchment">{user?.username}</strong>.{' '}
          {t('In deck pool deals, your decks go to the other players — and you get someone else’s deck.')}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/my-pool/collection"
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-line bg-surface/70 px-4 py-3 transition hover:border-gold/60 sm:max-w-md"
        >
          <Library className="h-8 w-8 shrink-0 text-gold" aria-hidden />
          <span className="min-w-0">
            <span className="block font-semibold text-parchment group-hover:text-gold">{t('My collection')}</span>
            <span className="block truncate text-xs text-parchment/60">
              {totals && totals.entries > 0
                ? t('{n} different cards · {copies} copies', {
                    n: totals.unique.toLocaleString(locale),
                    copies: totals.copies.toLocaleString(locale),
                  })
                : t('Import your cards from ManaBox, Moxfield, Archidekt…')}
            </span>
          </span>
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link to="/my-pool/new" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-parchment/80 transition hover:border-parchment/40">
            {t('Import list')}
          </Link>
          <Link
            to="/my-pool/generate"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gold/60 px-4 py-2 text-sm font-semibold text-gold transition hover:bg-gold/10"
          >
            <WandSparkles className="h-4 w-4" aria-hidden />
            {t('Generate a deck')}
          </Link>
          <Link to="/my-pool/build" className="rounded-lg btn-ember px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-110">
            + {t('Build a deck')}
          </Link>
        </div>
      </div>

      {/* Busca e filtros */}
      <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-ink px-3 py-1.5 focus-within:border-gold sm:max-w-xs">
            <Search className="h-4 w-4 shrink-0 text-parchment/45" aria-hidden />
            <input
              value={f.q}
              onChange={(e) => set({ q: e.target.value })}
              placeholder={t('Deck, commander or tag')}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <div className="flex rounded-lg border border-line p-0.5 text-xs" role="group" aria-label={t('Deck type')}>
            {(
              [
                ['all', t('All')],
                ['user', t('Built')],
                ['precon', t('Precons')],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => set({ kind: k })}
                aria-pressed={f.kind === k}
                className={`rounded-md px-2.5 py-1 ${f.kind === k ? 'bg-gold text-ink' : 'text-parchment/70 hover:text-parchment'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1" role="group" aria-label={t('Colors')}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => set({ colors: f.colors.includes(c) ? f.colors.replace(c, '') : COLORS.filter((x) => f.colors.includes(x) || x === c).join('') })}
                aria-pressed={f.colors.includes(c)}
                title={t('Decks with this color')}
                className={`grid h-7 w-7 place-items-center rounded-full border transition ${f.colors.includes(c) ? 'border-gold bg-gold/15' : 'border-line opacity-55 hover:opacity-100'}`}
              >
                <i className={`ms ms-${c.toLowerCase()} ms-cost`} aria-hidden />
                <span className="sr-only">{c}</span>
              </button>
            ))}
          </div>
          <select
            value={f.bracket ?? ''}
            onChange={(e) => set({ bracket: e.target.value ? Number(e.target.value) : null })}
            aria-label={t('Bracket')}
            className="rounded-lg border border-line bg-ink px-2 py-1.5 text-sm"
          >
            <option value="">{t('Any bracket')}</option>
            {[1, 2, 3, 4, 5].map((b) => (
              <option key={b} value={b}>
                {t('Bracket {n}', { n: b })}
              </option>
            ))}
          </select>
          <select value={f.sort} onChange={(e) => set({ sort: e.target.value })} aria-label={t('Sort')} className="ml-auto rounded-lg border border-line bg-ink px-2 py-1.5 text-sm">
            <option value="name">{t('Name')}</option>
            <option value="recent">{t('Recently added')}</option>
            <option value="bracket">{t('Bracket')}</option>
            <option value="power">{t('Power level')}</option>
            <option value="price">{t('Price')}</option>
          </select>
        </div>
        {(folders.length > 0 || allTags.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => set({ folder: null })} className={chip(folder === null)}>
              <FolderOpen className="h-3.5 w-3.5" aria-hidden />
              {t('All folders')}
            </button>
            {folders.map(([name, n]) => (
              <button key={name} onClick={() => set({ folder: folder === name ? null : name })} className={chip(folder === name)}>
                <Folder className="h-3.5 w-3.5" aria-hidden />
                {name}
                <span className="text-parchment/45">{n}</span>
              </button>
            ))}
            {folders.length > 0 && unfiled > 0 && (
              <button onClick={() => set({ folder: folder === NO_FOLDER ? null : NO_FOLDER })} className={chip(folder === NO_FOLDER)}>
                {t('No folder')}
                <span className="text-parchment/45">{unfiled}</span>
              </button>
            )}
            {allTags.length > 0 && <span className="mx-1 h-4 w-px bg-line" aria-hidden />}
            {allTags.map(([tag, n]) => (
              <button
                key={tag}
                onClick={() => set({ tags: activeTags.includes(tag) ? activeTags.filter((x) => x !== tag) : [...activeTags, tag] })}
                className={chip(activeTags.includes(tag))}
              >
                <Tag className="h-3 w-3" aria-hidden />
                {tag}
                <span className="text-parchment/45">{n}</span>
              </button>
            ))}
          </div>
        )}
        {filtering && (
          <p className="flex items-center gap-2 text-xs text-parchment/55">
            {t('{n} of {total} decks', { n: shown.length, total: items.length })}
            <button onClick={() => set({ ...DEFAULT_FILTERS })} className="text-gold/80 underline hover:text-gold">
              {t('Clear filters')}
            </button>
          </p>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <DeckTileSkeleton />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-parchment/60">
          {t('Paste the list of one of your decks (from Moxfield, Archidekt or plain text) or mark the precons you own in the catalog to fill your pool.')}
        </p>
      ) : shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-parchment/55">{t('No deck matches these filters.')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {shown.map((it, i) => (
            <div key={`${it.kind}:${it.deck.slug}`} className="relative">
              <DeckTile deck={it.deck} index={i} />
              <button
                onClick={() => setOrganizing(it)}
                title={t('Folder and tags')}
                aria-label={t('Folder and tags')}
                className="absolute top-2 left-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-ink/85 text-parchment/80 ring-1 ring-white/10 transition hover:text-gold"
              >
                <Tags className="h-4 w-4" aria-hidden />
              </button>
              {(it.org.folder || it.org.tags.length > 0) && (
                <div className="pointer-events-none absolute inset-x-2 top-11 z-10 flex flex-wrap gap-1">
                  {it.org.folder && (
                    <span className="inline-flex items-center gap-1 rounded bg-ink/85 px-1.5 py-0.5 text-[0.65rem] text-gold">
                      <Folder className="h-3 w-3" aria-hidden />
                      {it.org.folder}
                    </span>
                  )}
                  {it.org.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded bg-ink/85 px-1.5 py-0.5 text-[0.65rem] text-parchment/85">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {myPrecons.slugs.length === 0 && items.length > 0 && (
        <p className="text-sm text-parchment/55">
          {t('Use the marker in the corner of each deck in the catalog to say which precons you own.')}{' '}
          <Link to="/catalog" className="text-gold/80 hover:underline">
            {t('Mark more in the catalog')} →
          </Link>
        </p>
      )}

      {organizing && (
        <OrganizeDialog
          item={organizing}
          folders={folders.map(([name]) => name)}
          tags={allTags.map(([tag]) => tag)}
          onClose={() => setOrganizing(null)}
        />
      )}
    </section>
  )
}

function OrganizeDialog({ item, folders, tags, onClose }: { item: Item; folders: string[]; tags: string[]; onClose: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const { user } = useAuth()
  const [folder, setFolder] = useState(item.org.folder)
  const [list, setList] = useState(item.org.tags)
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const addTag = (raw: string) => {
    const tag = raw.trim().slice(0, 24)
    if (tag && !list.some((x) => x.toLocaleLowerCase() === tag.toLocaleLowerCase()) && list.length < 8) setList([...list, tag])
    setDraft('')
  }
  const save = useMutation({
    mutationFn: () => {
      const tagsNow = draft.trim() ? [...list, draft.trim()] : list
      const patch = { folder: folder.trim(), tags: tagsNow }
      return item.kind === 'user' ? api.organizeDeck(item.deck.slug, patch) : api.organizePrecon(item.deck.slug, patch)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me', 'decks', user?.id] })
      qc.invalidateQueries({ queryKey: ['me', 'precons', user?.id] })
      onClose()
    },
  })
  const suggestions = tags.filter((x) => !list.includes(x) && (!draft || x.toLocaleLowerCase().includes(draft.toLocaleLowerCase()))).slice(0, 8)
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-label={t('Folder and tags')}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-ink p-5 shadow-2xl shadow-black"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-parchment/55">{t('Folder and tags')}</p>
            <p className="truncate font-semibold">{item.deck.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Close')} className="text-parchment/50 hover:text-gold">
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className="block space-y-1 text-sm">
          <span className="flex items-center gap-1.5 text-parchment/75">
            <Folder className="h-4 w-4" aria-hidden />
            {t('Folder')}
          </span>
          <input
            ref={input}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            list="pool-folders"
            maxLength={40}
            placeholder={t('No folder')}
            className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 outline-none focus:border-gold"
          />
          <datalist id="pool-folders">
            {folders.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <div className="space-y-1 text-sm">
          <span className="flex items-center gap-1.5 text-parchment/75">
            <Tags className="h-4 w-4" aria-hidden />
            {t('Tags')}
          </span>
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-surface px-2 py-1.5 focus-within:border-gold">
            {list.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded bg-gold/15 px-1.5 py-0.5 text-xs text-gold">
                {tag}
                <button type="button" onClick={() => setList(list.filter((x) => x !== tag))} aria-label={t('Remove {name}', { name: tag })}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  if (draft.trim()) {
                    e.preventDefault()
                    addTag(draft)
                  }
                } else if (e.key === 'Backspace' && !draft && list.length) setList(list.slice(0, -1))
              }}
              maxLength={24}
              placeholder={list.length < 8 ? t('Add a tag and press Enter') : ''}
              disabled={list.length >= 8}
              className="min-w-24 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {suggestions.map((tag) => (
                <button key={tag} type="button" onClick={() => addTag(tag)} className="rounded border border-line px-1.5 py-0.5 text-xs text-parchment/65 hover:border-gold hover:text-gold">
                  + {tag}
                </button>
              ))}
            </div>
          )}
        </div>
        <button disabled={save.isPending} className="w-full rounded-md bg-gold px-3 py-2 text-sm font-semibold text-ink disabled:opacity-50">
          {t('Save')}
        </button>
      </form>
    </div>
  )
}
