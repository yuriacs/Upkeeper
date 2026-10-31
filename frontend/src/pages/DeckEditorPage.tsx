import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ClipboardPaste,
  Crown,
  FileUp,
  Hammer,
  Link2,
  LoaderCircle,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Curve } from '../components/builder/Curve'
import { LiveEstimate } from '../components/builder/LiveEstimate'
import { problemText, typeGroupLabel } from '../components/builder/labels'
import { ColorIdentity } from '../components/Mana'
import { useDebounce } from '../hooks/useDebounce'
import { useTitle } from '../hooks/useTitle'
import { api, ApiError } from '../lib/api'
import {
  canCommand,
  canPair,
  curve,
  DECK_SIZE,
  deckCount,
  deckFromList,
  deckIdentity,
  deckPrice,
  GROUPS,
  groupOf,
  parseDecklist,
  problems,
  saveDraft,
  withCommanders,
  type BuilderCard,
  type BuilderDeck,
} from '../lib/deckbuilder'
import { DECK_FILE_ACCEPT, readDeckFile } from '../lib/deckFiles'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/money'

const PLACEHOLDER = `1 Okaun, Eye of Chaos
1 Zndrsplt, Eye of Wisdom

1 Sol Ring
1 Arcane Signet
9 Island
...`

const inputClass =
  'w-full rounded-lg border border-line bg-ink px-4 py-2.5 placeholder:text-parchment/30 focus:border-gold focus:outline-none'

type Source = 'paste' | 'link' | 'file'
const SOURCE_NAMES: Record<string, string> = { archidekt: 'Archidekt', mtggoldfish: 'MTGGoldfish' }

/**
 * Importar deck: a lista colada, o link de um site (Archidekt, MTGGoldfish) ou um arquivo (.txt, .dek,
 * .cod, .csv). Tudo vira o mesmo texto; a prévia ao lado lê como o servidor vai ler e busca as cartas
 * no Scryfall (as mesmas regras e estatísticas do deckbuilder), para conferir antes de salvar.
 */
function Editor({ id, initial }: { id?: string; initial?: { name: string; decklist: string } }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState(initial?.name ?? '')
  const [decklist, setDecklist] = useState(initial?.decklist ?? '')
  const [source, setSource] = useState<Source>('paste')
  // De onde veio a lista (link ou arquivo) e os avisos do site, mostrados acima da lista
  const [origin, setOrigin] = useState<{ label: string; warnings: string[] } | null>(null)
  // Comandante(s) escolhido(s) na prévia (ids das cartas); null = o que foi lido da lista
  const [picked, setPicked] = useState<string[] | null>(null)

  const text = useDebounce(decklist, 700)
  const parsed = useMemo(() => parseDecklist(text), [text])
  const preview = useQuery({
    queryKey: ['import-preview', text],
    queryFn: ({ signal }) => deckFromList('', parsed, signal),
    enabled: parsed.commanders.length + parsed.cards.length > 0,
    staleTime: Infinity,
    retry: 1,
    placeholderData: keepPreviousData,
  })
  const base = preview.data?.deck
  const deck = useMemo(() => {
    if (!base) return null
    const ids = [...base.commanders, ...base.cards.map((e) => e.card)].map((c) => c.id)
    const ok = !!picked?.length && picked.every((x) => ids.includes(x))
    return { ...(ok ? withCommanders(base, picked) : base), name }
  }, [base, picked, name])
  const previewReady = !!deck && text === decklist && !preview.isFetching

  const fromUrl = useMutation({
    mutationFn: (url: string) => api.deckFromUrl(url),
    onSuccess: (r) => {
      setDecklist(r.decklist)
      if (!name.trim() && r.name) setName(r.name)
      setPicked(null)
      setOrigin({ label: t('List brought from {site}.', { site: SOURCE_NAMES[r.source] ?? r.source }), warnings: r.warnings })
      setSource('paste')
    },
  })

  const save = useMutation({
    mutationFn: () => {
      // O servidor acha o comandante pelo nome escrito na lista
      const commanders = deck && previewReady ? deck.commanders.map((c) => preview.data!.lineName.get(c.id) ?? c.name) : undefined
      return api.saveMyDeck({ name: name.trim(), decklist, commanders: commanders?.length ? commanders : undefined }, id)
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
      queryClient.invalidateQueries({ queryKey: ['deck', 'user', saved.slug] })
      navigate(`/user-deck/${saved.slug}`, { state: { warnings: saved.warnings } })
    },
  })
  const error = save.error instanceof ApiError ? save.error : null

  const openInBuilder = () => {
    if (!deck) return
    saveDraft({ ...deck, name: name.trim() || deck.name }, id)
    navigate(id ? `/my-pool/build/${id}` : '/my-pool/build')
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  const tabs: [Source, string, LucideIcon][] = [
    ['paste', t('Paste list'), ClipboardPaste],
    ['link', t('From a link'), Link2],
    ['file', t('From a file'), FileUp],
  ]

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <form onSubmit={submit} className="min-w-0 space-y-5">
        <label className="block space-y-1 text-sm">
          <span className="text-parchment/70">{t('Deck name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} className={inputClass} />
        </label>

        <div className="space-y-3">
          <div role="tablist" aria-label={t('Where the list comes from')} className="flex gap-1 rounded-lg border border-line p-1">
            {tabs.map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={source === key}
                onClick={() => setSource(key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-semibold transition ${
                  source === key ? 'bg-gold/15 text-gold' : 'text-parchment/60 hover:text-parchment'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          {source === 'link' && <LinkSource pending={fromUrl.isPending} error={fromUrl.error} onFetch={(url) => fromUrl.mutate(url)} />}
          {source === 'file' && (
            <FileSource
              onRead={(file) => {
                setDecklist(file.decklist)
                if (!name.trim() && file.name) setName(file.name)
                setPicked(null)
                setOrigin({ label: t('List read from {file}.', { file: file.file }), warnings: [] })
                setSource('paste')
              }}
            />
          )}

          <div className={source === 'paste' ? 'space-y-1' : 'hidden'}>
            {origin && (
              <div className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-sm text-parchment/80">
                <p>{origin.label} {t('Check the preview and import.')}</p>
                {origin.warnings.map((w) => (
                  <p key={w} className="text-xs text-amber-300">
                    {w}
                  </p>
                ))}
              </div>
            )}
            <label className="block space-y-1 text-sm">
              <span className="text-parchment/70">{t('Decklist')}</span>
              <textarea
                value={decklist}
                onChange={(e) => setDecklist(e.target.value)}
                required
                rows={18}
                placeholder={PLACEHOLDER}
                spellCheck={false}
                className={`${inputClass} font-mono text-xs leading-relaxed`}
              />
            </label>
            <p className="text-xs text-parchment/40">
              {t(
                'Paste the Moxfield export (commander on the first line, or both partners on the first two, then a blank line). Archidekt, MTG Arena and "Commander"/"Deck" sections also work. With no blank line, the first card is the commander.',
              )}
            </p>
          </div>
        </div>

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

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={save.isPending || !decklist.trim()}
            className="rounded-md btn-ember font-display text-xl tracking-wide px-6 py-3 text-ink transition hover:brightness-110 disabled:opacity-50"
          >
            {save.isPending ? t('Fetching cards…') : id ? t('Save changes') : t('Import deck')}
          </button>
          <button
            type="button"
            onClick={openInBuilder}
            disabled={!previewReady}
            title={t('Opens this list in the deckbuilder to keep editing before saving')}
            className="inline-flex items-center gap-2 rounded-lg border border-gold/50 px-5 py-3 text-gold transition hover:bg-gold/10 disabled:opacity-40"
          >
            <Hammer className="h-4 w-4" aria-hidden />
            {t('Open in the deckbuilder')}
          </button>
          <Link to="/my-pool" className="rounded-lg border border-parchment/20 px-6 py-3 text-parchment/70">
            {t('Cancel')}
          </Link>
        </div>
      </form>

      <aside className="min-w-0 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto">
        <Preview
          empty={!decklist.trim()}
          loading={preview.isFetching || text !== decklist}
          failed={preview.isError}
          deck={deck}
          base={base ?? null}
          missing={preview.data?.missing.map((l) => l.name) ?? []}
          bad={parsed.bad}
          onPick={setPicked}
        />
      </aside>
    </div>
  )
}

function LinkSource({ pending, error, onFetch }: { pending: boolean; error: Error | null; onFetch: (url: string) => void }) {
  const { t } = useI18n()
  const [url, setUrl] = useState('')
  const go = () => url.trim() && onFetch(url.trim())
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface/60 p-4">
      <label className="block space-y-1 text-sm">
        <span className="text-parchment/70">{t('Deck link')}</span>
        <div className="flex gap-2">
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                go()
              }
            }}
            placeholder="https://archidekt.com/decks/…"
            className={inputClass}
          />
          <button
            type="button"
            onClick={go}
            disabled={pending || !url.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg btn-ember px-4 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {pending && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
            {pending ? t('Fetching…') : t('Fetch deck')}
          </button>
        </div>
      </label>
      <p className="text-xs text-parchment/50">
        {t('Works with public decks from Archidekt and MTGGoldfish. Moxfield and TappedOut block other sites: there, use "Export", copy the list and paste it.')}
      </p>
      {error && <p className="text-sm text-red-300">{error.message}</p>}
    </div>
  )
}

function FileSource({ onRead }: { onRead: (f: { name: string; decklist: string; file: string }) => void }) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [error, setError] = useState('')
  const read = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      const r = await readDeckFile(file)
      onRead({ ...r, file: file.name })
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      setError(
        code === 'too_big'
          ? t('The file is too big for a decklist.')
          : code === 'empty'
            ? t('No cards found in this file.')
            : t('Could not read this file.'),
      )
    }
  }
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    read(e.dataTransfer.files[0])
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center transition ${
          over ? 'border-gold bg-gold/10' : 'border-line hover:border-parchment/40'
        }`}
      >
        <FileUp className="h-8 w-8 text-gold" aria-hidden />
        <span className="font-semibold text-parchment">{t('Drop the deck file here or click to choose')}</span>
        <span className="text-xs text-parchment/50">{t('.txt, .dec, .dek (MTGO), .cod (Cockatrice) or .csv (ManaBox, Moxfield, Archidekt)')}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept={DECK_FILE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          read(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  )
}

function Preview({
  empty,
  loading,
  failed,
  deck,
  base,
  missing,
  bad,
  onPick,
}: {
  empty: boolean
  loading: boolean
  failed: boolean
  deck: BuilderDeck | null
  base: BuilderDeck | null
  missing: string[]
  bad: string[]
  onPick: (ids: string[]) => void
}) {
  const { t, locale } = useI18n()
  const box = 'space-y-3 rounded-lg border border-line bg-surface/60 p-4'
  if (empty)
    return (
      <div className={`${box} text-sm text-parchment/50`}>
        <h2 className="text-xs font-semibold tracking-wide text-gold uppercase">{t('Preview')}</h2>
        <p>{t('Paste a list, fetch a link or drop a file: the commander, the card count, the colors and the rules show up here before you import.')}</p>
      </div>
    )
  if (!deck)
    return (
      <div className={`${box} text-sm`}>
        <h2 className="text-xs font-semibold tracking-wide text-gold uppercase">{t('Preview')}</h2>
        {failed ? (
          <p className="text-parchment/60">{t('Could not reach Scryfall for the preview. You can still import: the server checks the list.')}</p>
        ) : (
          <p className="flex items-center gap-2 text-parchment/60">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            {t('Looking up the cards on Scryfall…')}
          </p>
        )}
        {bad.length > 0 && <BadLines lines={bad} />}
      </div>
    )

  const total = deckCount(deck)
  const identity = deckIdentity(deck)
  const issues = problems(deck)
  const byGroup = GROUPS.map((g) => [g, deck.cards.filter((e) => groupOf(e.card) === g).reduce((n, e) => n + e.qty, 0)] as const).filter(
    ([, n]) => n > 0,
  )
  return (
    <div className={`space-y-4 transition ${loading ? 'opacity-60' : ''}`}>
      <section className={box}>
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-gold uppercase">{t('Preview')}</h2>
          {loading && <LoaderCircle className="h-4 w-4 animate-spin text-parchment/40" aria-label={t('Updating…')} />}
          {identity.length > 0 && <ColorIdentity colors={identity.join('')} className="ml-auto" />}
        </div>
        <CommanderPicker deck={deck} base={base ?? deck} onPick={onPick} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3">
          <span className={`font-display text-2xl tabular-nums ${total === DECK_SIZE ? 'text-emerald-300' : 'text-parchment'}`}>
            {total}/{DECK_SIZE}
          </span>
          <span className="text-sm text-emerald-300/90 tabular-nums" title={t('Estimated value: sum of the card prices on Scryfall')}>
            {money(deckPrice(deck), 'USD', locale)}
          </span>
          <Curve values={curve(deck)} />
        </div>
        {byGroup.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {byGroup.map(([g, n]) => (
              <li key={g} className="rounded-full border border-line px-2 py-0.5 text-parchment/70">
                {typeGroupLabel(t, g)} <span className="text-parchment tabular-nums">{n}</span>
              </li>
            ))}
            {deck.maybe.length > 0 && (
              <li className="rounded-full border border-dashed border-line px-2 py-0.5 text-parchment/50">
                {t('Maybeboard')} <span className="tabular-nums">{deck.maybe.reduce((n, e) => n + e.qty, 0)}</span>
              </li>
            )}
          </ul>
        )}
      </section>

      {missing.length > 0 && (
        <div className="space-y-1 rounded-lg border border-red-400/30 bg-red-400/5 p-3 text-xs text-red-300">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {t('Cards not found on Scryfall ({n}): check the spelling.', { n: missing.length })}
          </p>
          <p className="text-red-300/80">{missing.join(', ')}</p>
        </div>
      )}
      {bad.length > 0 && <BadLines lines={bad} />}
      {issues.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200">
          {issues.map((p, i) => (
            <li key={i}>• {problemText(t, p)}</li>
          ))}
        </ul>
      )}
      {issues.length > 0 && deck.commanders.length > 0 && (
        <p className="text-xs text-parchment/40">{t('You can import an unfinished deck and fix it later in the deckbuilder.')}</p>
      )}
      <LiveEstimate deck={deck} />
    </div>
  )
}

function BadLines({ lines }: { lines: string[] }) {
  const { t } = useI18n()
  return (
    <div className="space-y-1 rounded-lg border border-red-400/30 bg-red-400/5 p-3 text-xs text-red-300">
      <p className="font-semibold">{t('Lines that could not be read:')}</p>
      <ul className="font-mono text-red-300/80">
        {lines.slice(0, 8).map((l) => (
          <li key={l} className="truncate">
            {l}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Comandante lido da lista, com a troca entre as cartas que podem comandar (e o parceiro) */
function CommanderPicker({
  deck,
  base,
  onPick,
}: {
  deck: BuilderDeck
  base: BuilderDeck
  onPick: (ids: string[]) => void
}) {
  const { t } = useI18n()
  const candidates = useMemo(() => {
    const seen = new Map<string, BuilderCard>()
    for (const c of [...base.commanders, ...base.cards.map((e) => e.card)]) if (canCommand(c) && !seen.has(c.name)) seen.set(c.name, c)
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [base])
  const [first, second] = deck.commanders
  const partners = first ? candidates.filter((c) => c.id !== first.id && canPair(first, c)) : []
  const select = 'w-full rounded-lg border border-line bg-ink px-2 py-1.5 text-sm text-parchment focus:border-gold focus:outline-none'
  return (
    <div className="space-y-2">
      {deck.commanders.length > 0 ? (
        <ul className="flex gap-2">
          {deck.commanders.map((c) => (
            <li key={c.id} className="w-24 shrink-0 space-y-1">
              <img src={c.small || c.image} alt={c.name} className="aspect-[488/680] w-full rounded-md object-cover shadow" />
            </li>
          ))}
          <li className="min-w-0 flex-1 space-y-1 text-sm">
            {deck.commanders.map((c) => (
              <p key={c.id} className="flex items-start gap-1.5 font-semibold text-parchment">
                <Crown className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
                <span className="min-w-0">{c.name}</span>
              </p>
            ))}
          </li>
        </ul>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-amber-300">
          <Crown className="h-4 w-4" aria-hidden />
          {t('No commander found in the list: pick it below.')}
        </p>
      )}
      {candidates.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <label className="space-y-0.5 text-xs text-parchment/60">
            <span>{t('Commander')}</span>
            <select value={first?.id ?? ''} onChange={(e) => e.target.value && onPick([e.target.value])} className={select}>
              {!first && <option value="">{t('Choose…')}</option>}
              {first && !candidates.some((c) => c.id === first.id) && <option value={first.id}>{first.name}</option>}
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {first && (partners.length > 0 || second) && (
            <label className="space-y-0.5 text-xs text-parchment/60">
              <span>{t('Partner (optional)')}</span>
              <select
                value={second?.id ?? ''}
                onChange={(e) => onPick(e.target.value ? [first.id, e.target.value] : [first.id])}
                className={select}
              >
                <option value="">{t('None')}</option>
                {second && !partners.some((c) => c.id === second.id) && <option value={second.id}>{second.name}</option>}
                {partners.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  )
}

export default function DeckEditorPage() {
  const { t } = useI18n()
  const { id } = useParams()
  useTitle(id ? t('Edit deck') : t('Import deck'))
  const existing = useQuery({ queryKey: ['me', 'deck', id], queryFn: () => api.myDeck(id!), enabled: !!id })

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="space-y-1">
          <h1 className="font-display text-3xl text-parchment">{id ? t('Edit deck') : t('Import deck')}</h1>
          <p className="text-sm text-parchment/60">
            {t('Bring a deck from Moxfield, Archidekt, MTGGoldfish, MTG Arena, MTGO or Cockatrice: paste the list, use the link or send the file.')}
          </p>
        </div>
        {!id && (
          <div className="ml-auto flex flex-wrap gap-2 text-sm">
            <Link to="/my-pool/build" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-parchment/70 hover:border-parchment/40">
              <Hammer className="h-4 w-4" aria-hidden />
              {t('Build from scratch')}
            </Link>
            <Link to="/my-pool/generate" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-parchment/70 hover:border-parchment/40">
              <WandSparkles className="h-4 w-4" aria-hidden />
              {t('Generate a deck')}
            </Link>
          </div>
        )}
      </div>
      {id && existing.isPending && <p className="text-parchment/60">{t('Loading…')}</p>}
      {id && existing.isError && <p className="text-red-400">{existing.error.message}</p>}
      {(!id || existing.data) && (
        <Editor
          key={id ?? 'novo'}
          id={id}
          initial={existing.data ? { name: existing.data.name, decklist: existing.data.decklist_text ?? '' } : undefined}
        />
      )}
    </section>
  )
}
