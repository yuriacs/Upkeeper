import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Minus, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import LoadError from '../components/LoadError'
import { useDebounce } from '../hooks/useDebounce'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { IMPORT_BATCH, parseCollection, SOURCE_LABEL, type ParsedCollection } from '../lib/collectionImport'
import { useI18n, useT } from '../lib/i18n'
import type { CollectionEntry } from '../lib/types'

/*
 * Minha coleção (/my-pool/collection): as cartas que você tem de verdade, importadas de outro
 * serviço. Alimenta o "só com as suas cartas" do gerador e as marcações de "você tem" no deckbuilder.
 */

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const
const CATEGORIES = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'] as const

export default function CollectionPage() {
  const t = useT()
  useTitle(t('My collection'))
  const { locale } = useI18n()
  const [importing, setImporting] = useState(false)
  const [q, setQ] = useState('')
  const [colors, setColors] = useState<string | null>(null)
  const [category, setCategory] = useState('')
  const [foil, setFoil] = useState(false)
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<CollectionEntry | null>(null)
  const search = useDebounce(q, 300)
  const params: Record<string, string> = { sort, page: String(page) }
  if (search.trim()) params.q = search.trim()
  if (colors !== null) params.colors = colors || 'C'
  if (category) params.category = category
  if (foil) params.foil = '1'
  const list = useQuery({
    queryKey: ['me', 'collection', params],
    queryFn: () => api.myCollection(params),
    placeholderData: keepPreviousData,
  })
  const totals = list.data?.totals
  const empty = totals?.entries === 0
  const money = (n: number) => n.toLocaleString(locale, { style: 'currency', currency: 'USD' })
  const resetPage = () => setPage(1)
  // Cores marcadas: cartas que cabem nelas (incolores entram junto). Nenhuma: todas. Só o "C": só incolores
  const toggleColor = (c: string) => {
    const cur = colors ?? ''
    const next = COLORS.filter((x) => (x === c ? !cur.includes(x) : cur.includes(x))).join('')
    setColors(next || null)
    resetPage()
  }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link to="/my-pool" className="inline-flex items-center gap-1 text-sm text-parchment/60 hover:text-gold">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('My pool')}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl text-parchment">{t('My collection')}</h1>
            <p className="text-sm text-parchment/65">
              {t('The cards you really own. The deck generator can build only with them, and the deckbuilder shows which cards of a deck you already have.')}
            </p>
          </div>
          <button
            onClick={() => setImporting(true)}
            className="inline-flex items-center gap-1.5 rounded-lg btn-ember px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-110"
          >
            <Upload className="h-4 w-4" aria-hidden />
            {t('Import collection')}
          </button>
        </div>
        {totals && !empty && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-parchment/75">
            <span>{t('{n} different cards', { n: totals.unique.toLocaleString(locale) })}</span>
            <span>{t('{n} copies', { n: totals.copies.toLocaleString(locale) })}</span>
            <span>{t('worth about {value}', { value: money(totals.value_usd) })}</span>
          </div>
        )}
      </div>

      {list.isError ? (
        <LoadError error={list.error} onRetry={() => list.refetch()} retrying={list.isFetching} />
      ) : empty ? (
        <div className="space-y-3 rounded-xl border border-dashed border-line p-8 text-center">
          <p className="text-parchment/80">{t('Your collection is empty.')}</p>
          <p className="text-sm text-parchment/55">
            {t('Export it from ManaBox, Moxfield, Archidekt, Deckbox or Dragon Shield (CSV), or paste a list of cards.')}
          </p>
          <button
            onClick={() => setImporting(true)}
            className="rounded-lg border border-gold/60 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/10"
          >
            {t('Import collection')}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                resetPage()
              }}
              placeholder={t('Search by name or type')}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-gold sm:max-w-xs"
            />
            <div className="flex items-center gap-1" role="group" aria-label={t('Colors')}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleColor(c)}
                  aria-pressed={!!colors?.includes(c)}
                  title={t('Fits in these colors')}
                  className={`grid h-8 w-8 place-items-center rounded-full border transition ${
                    colors?.includes(c) ? 'border-gold bg-gold/15' : 'border-line opacity-60 hover:opacity-100'
                  }`}
                >
                  <i className={`ms ms-${c.toLowerCase()} ms-cost`} aria-hidden />
                  <span className="sr-only">{c}</span>
                </button>
              ))}
              <button
                onClick={() => {
                  setColors(colors === '' ? null : '')
                  resetPage()
                }}
                aria-pressed={colors === ''}
                title={t('Colorless only')}
                className={`grid h-8 w-8 place-items-center rounded-full border transition ${
                  colors === '' ? 'border-gold bg-gold/15' : 'border-line opacity-60 hover:opacity-100'
                }`}
              >
                <i className="ms ms-c ms-cost" aria-hidden />
              </button>
            </div>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value)
                resetPage()
              }}
              aria-label={t('Card type')}
              className="rounded-lg border border-line bg-surface px-2 py-2 text-sm"
            >
              <option value="">{t('All types')}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(c.charAt(0).toUpperCase() + c.slice(1))}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-parchment/75">
              <input
                type="checkbox"
                checked={foil}
                onChange={(e) => {
                  setFoil(e.target.checked)
                  resetPage()
                }}
                className="accent-gold"
              />
              {t('Foil only')}
            </label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label={t('Sort')}
              className="ml-auto rounded-lg border border-line bg-surface px-2 py-2 text-sm"
            >
              <option value="name">{t('Name')}</option>
              <option value="-price">{t('Most valuable')}</option>
              <option value="-quantity">{t('Most copies')}</option>
              <option value="set">{t('Set')}</option>
              <option value="-updated">{t('Recently added')}</option>
            </select>
          </div>

          {list.data && list.data.count === 0 ? (
            <p className="py-10 text-center text-sm text-parchment/55">{t('No card matches these filters.')}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {(list.data?.results ?? []).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setOpen(c)}
                  title={`${c.name} · ${c.set.toUpperCase()} ${c.number}`}
                  className="group relative overflow-hidden rounded-[4.5%] text-left"
                >
                  <img src={c.image_small || c.image} alt={c.name} loading="lazy" decoding="async" className="aspect-[63/88] w-full bg-surface object-cover transition group-hover:brightness-110" />
                  <span className="absolute top-1 right-1 rounded bg-ink/90 px-1.5 text-xs font-bold text-parchment ring-1 ring-gold/50">
                    ×{c.quantity}
                  </span>
                  {c.foil && (
                    <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded bg-gradient-to-r from-fuchsia-400 via-amber-300 to-sky-400 px-1 text-[0.6rem] font-bold text-ink">
                      <Sparkles className="h-2.5 w-2.5" aria-hidden />
                      {t('Foil')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {list.data && list.data.pages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-md border border-line px-3 py-1 disabled:opacity-40">
                {t('Previous')}
              </button>
              <span className="text-parchment/60">{t('Page {n} of {total}', { n: list.data.page, total: list.data.pages })}</span>
              <button
                disabled={page >= list.data.pages}
                onClick={() => setPage(page + 1)}
                className="rounded-md border border-line px-3 py-1 disabled:opacity-40"
              >
                {t('Next')}
              </button>
            </div>
          )}
          <ClearCollection />
        </>
      )}

      {importing && <ImportDialog onClose={() => setImporting(false)} hasCollection={!!totals && !empty} />}
      {open && <CardDialog entry={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

function useRefreshCollection() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['me', 'collection'] })
    qc.invalidateQueries({ queryKey: ['me', 'collection-names'] })
  }
}

function ClearCollection() {
  const t = useT()
  const refresh = useRefreshCollection()
  const [confirm, setConfirm] = useState(false)
  const clear = useMutation({ mutationFn: api.clearCollection, onSuccess: refresh })
  return (
    <div className="flex justify-end">
      <button
        onClick={() => {
          if (!confirm) {
            setConfirm(true)
            setTimeout(() => setConfirm(false), 4000)
            return
          }
          setConfirm(false)
          clear.mutate()
        }}
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition ${
          confirm ? 'border-red-400 bg-red-500/20 text-red-200' : 'border-line text-parchment/55 hover:border-red-400/60 hover:text-red-300'
        }`}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        {confirm ? t('Click again to delete the whole collection') : t('Delete collection')}
      </button>
    </div>
  )
}

function CardDialog({ entry, onClose }: { entry: CollectionEntry; onClose: () => void }) {
  const t = useT()
  const refresh = useRefreshCollection()
  const [qty, setQty] = useState(entry.quantity)
  const save = useMutation({
    mutationFn: (n: number) => api.editCollectionCard(entry.id, n),
    onSuccess: () => {
      refresh()
      onClose()
    },
  })
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={entry.name}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md gap-4 rounded-2xl border border-line bg-ink p-4 shadow-2xl shadow-black"
      >
        <img src={entry.image} alt={entry.name} className="w-40 shrink-0 rounded-[4.5%]" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 font-semibold">{entry.name}</p>
            <button onClick={onClose} aria-label={t('Close')} className="text-parchment/50 hover:text-gold">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="text-xs text-parchment/60">
            {entry.set.toUpperCase()} {entry.number}
            {entry.foil ? ` · ${t('Foil')}` : ''}
            {entry.price_usd ? ` · US$ ${entry.price_usd}` : ''}
          </p>
          <p className="text-xs text-parchment/50">{entry.type_line}</p>
          <div className="mt-auto flex items-center gap-2">
            <span className="text-sm text-parchment/70">{t('Copies')}</span>
            <button onClick={() => setQty(Math.max(0, qty - 1))} aria-label={t('Fewer')} className="grid h-8 w-8 place-items-center rounded-md border border-line hover:border-gold">
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-8 text-center font-display text-xl tabular-nums">{qty}</span>
            <button onClick={() => setQty(qty + 1)} aria-label={t('More')} className="grid h-8 w-8 place-items-center rounded-md border border-line hover:border-gold">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-2">
            <button
              disabled={save.isPending || qty === entry.quantity}
              onClick={() => save.mutate(qty)}
              className="flex-1 rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-40"
            >
              {qty === 0 ? t('Remove from collection') : t('Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const HOW_TO: [string, string][] = [
  ['ManaBox', 'Collection → ⋮ → Export → CSV'],
  ['Moxfield', 'Collection → More → Export → CSV'],
  ['Archidekt', 'Collection → Export → CSV'],
  ['Deckbox', 'Inventory → Export'],
  ['Dragon Shield', 'Folder → Export → CSV'],
]

function ImportDialog({ onClose, hasCollection }: { onClose: () => void; hasCollection: boolean }) {
  const t = useT()
  const { locale } = useI18n()
  const refresh = useRefreshCollection()
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedCollection | null>(null)
  const [replace, setReplace] = useState(hasCollection)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ added: number; missing: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const read = (value: string) => {
    setText(value)
    setResult(null)
    setError(null)
    setParsed(value.trim() ? parseCollection(value) : null)
  }
  const pickFile = async (file: File | null) => {
    if (!file) return
    if (file.size > 20 * 1024 * 1024) return setError(t('The file is too big (20 MB at most).'))
    setFileName(file.name)
    read(await file.text())
  }
  const run = async () => {
    if (!parsed?.rows.length) return
    const rows = parsed.rows
    const batches = Math.ceil(rows.length / IMPORT_BATCH)
    setProgress({ done: 0, total: batches })
    setError(null)
    let added = 0
    const missing: string[] = []
    try {
      for (let i = 0; i < batches; i++) {
        const res = await api.importCollection(rows.slice(i * IMPORT_BATCH, (i + 1) * IMPORT_BATCH), replace && i === 0)
        added += res.added
        missing.push(...res.missing)
        setProgress({ done: i + 1, total: batches })
      }
      setResult({ added, missing })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(null)
      refresh()
    }
  }
  const busy = progress !== null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-label={t('Import collection')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-2xl border border-line bg-ink p-5 shadow-2xl shadow-black"
      >
        <div className="flex items-center">
          <h2 className="font-display text-xl text-gold">{t('Import collection')}</h2>
          {!busy && (
            <button onClick={onClose} aria-label={t('Close')} className="ml-auto text-parchment/50 hover:text-gold">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        {result ? (
          <div className="space-y-3">
            <p className="text-parchment/85">{t('{n} copies added to your collection.', { n: result.added.toLocaleString(locale) })}</p>
            {result.missing.length > 0 && (
              <details className="rounded-lg border border-amber-400/40 bg-amber-950/20 p-3 text-sm">
                <summary className="cursor-pointer text-amber-200">
                  {t('{n} cards were not found on Scryfall', { n: result.missing.length })}
                </summary>
                <p className="mt-2 max-h-40 overflow-y-auto text-xs text-parchment/65">{result.missing.join(', ')}</p>
              </details>
            )}
            <button onClick={onClose} className="rounded-md bg-gold px-4 py-1.5 text-sm font-semibold text-ink">
              {t('Done')}
            </button>
          </div>
        ) : (
          <>
            <details className="text-sm text-parchment/70">
              <summary className="cursor-pointer text-parchment/85">{t('How to export from each app')}</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {HOW_TO.map(([app, how]) => (
                  <li key={app}>
                    <strong className="text-parchment/85">{app}:</strong> {how}
                  </li>
                ))}
              </ul>
            </details>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileInput} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />
              <button
                disabled={busy}
                onClick={() => fileInput.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md border border-gold/60 px-3 py-1.5 text-sm font-semibold text-gold hover:bg-gold/10 disabled:opacity-40"
              >
                <Upload className="h-4 w-4" aria-hidden />
                {t('Choose file')}
              </button>
              <span className="truncate text-xs text-parchment/55">{fileName || t('CSV or text file')}</span>
            </div>
            <textarea
              value={text}
              disabled={busy}
              onChange={(e) => {
                setFileName('')
                read(e.target.value)
              }}
              rows={6}
              placeholder={t('…or paste the list here: one card per line ("2 Sol Ring (CMM) 410")')}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-gold"
            />
            {parsed && (
              <p className="text-sm text-parchment/75">
                {parsed.rows.length
                  ? t('Read as {source}: {copies} copies of {rows} cards.', {
                      source: parsed.source === 'text' ? t('a list') : SOURCE_LABEL[parsed.source],
                      copies: parsed.copies.toLocaleString(locale),
                      rows: parsed.rows.length.toLocaleString(locale),
                    })
                  : t('No card found in this file.')}
                {parsed.skipped > 0 && ` ${t('{n} lines skipped.', { n: parsed.skipped })}`}
              </p>
            )}
            {hasCollection && (
              <div className="space-y-1 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={replace} onChange={() => setReplace(true)} className="accent-gold" disabled={busy} />
                  {t('Replace my collection with this file')}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={!replace} onChange={() => setReplace(false)} className="accent-gold" disabled={busy} />
                  {t('Add these cards to my collection')}
                </label>
              </div>
            )}
            {progress && (
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-parchment/10">
                  <div className="h-full bg-gold transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
                <p className="mt-1 text-xs text-parchment/55">
                  {t('Checking the cards on Scryfall… {done} of {total}', { done: progress.done, total: progress.total })}
                </p>
              </div>
            )}
            {error && <p className="text-sm text-red-300">{error}</p>}
            <button
              disabled={busy || !parsed?.rows.length}
              onClick={() => void run()}
              className="self-start rounded-md btn-ember px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
            >
              {busy ? t('Importing…') : t('Import')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
