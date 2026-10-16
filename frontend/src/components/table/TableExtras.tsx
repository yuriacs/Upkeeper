import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { LogItem, TableCard } from '../../hooks/useTableSocket'
import { useDebounce } from '../../hooks/useDebounce'
import { useT } from '../../lib/i18n'
import { smallImage } from '../../lib/cardImage'
import { HELPERS, helperLabel, loadHelperImages, type Helper, type HelperImages } from './helpers'
import { playSound } from '../../lib/tableSounds'
import {
  rememberHelper,
  rememberToken,
  toggleFavoriteHelper,
  toggleFavoriteToken,
  useTokenPicks,
  type SavedToken,
} from '../../lib/tokenPicks'
import { Coins, Star } from 'lucide-react'
import { actLabel, searchWhat, type CardAct } from './cardActs'
import { CardView, IconButton, TypeChips } from './TableKit'
import { useTypeFilter } from './typeFilter'
import { acceptsCard, readDrag, useTable } from './tableUtils'

/*
 * Janelas extras da mesa (Fase 2): grimório (buscar / olhar o topo), fichas do Scryfall,
 * carta revelada e dados.
 */

function Modal({
  title,
  onClose,
  children,
  footer,
  narrow = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Janela estreita (escolhas curtas) */
  narrow?: boolean
}) {
  const t = useT()
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[85dvh] w-full flex-col rounded-xl border border-line bg-ink ${narrow ? 'max-w-lg' : 'max-w-4xl'}`}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-2xl">{title}</h2>
          <button
            onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-parchment/60 hover:text-gold"
            aria-label={t('Close')}
          >
            ✕
          </button>
        </div>
        {children}
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * Busca de um atalho de carta (Evolving Wilds, Cultivate...): as cartas do grimório que servem.
 * Clique para escolher; a ordem conta quando cada uma vai para um lugar (1ª campo, 2ª mão).
 */
export function SearchPickDialog({
  act,
  source,
  cards,
  onConfirm,
  onClose,
}: {
  act: Extract<CardAct, { k: 'search' }>
  source: string
  cards: TableCard[]
  onConfirm: (ids: string[]) => void
  onClose: () => void
}) {
  const t = useT()
  const [picked, setPicked] = useState<string[]>([])
  const [hover, setHover] = useState<TableCard | null>(null)
  // Uma por nome (os 10 Forests do deck são a mesma escolha)
  const seen = new Set<string>()
  const unique = cards.filter((c) => !seen.has(c.name) && !!seen.add(c.name))
  const need = act.upto ? 1 : Math.min(act.n, cards.length)
  const toggle = (c: TableCard) => {
    if (picked.includes(c.id)) setPicked(picked.filter((id) => id !== c.id))
    else if (picked.length < act.n) setPicked([...picked, c.id])
  }
  // Mais de uma do mesmo nome: a segunda escolha pega outra cópia
  const pickName = (c: TableCard) => {
    const copies = cards.filter((x) => x.name === c.name && !picked.includes(x.id))
    if (picked.some((id) => cards.find((x) => x.id === id)?.name === c.name) && copies.length && picked.length < act.n)
      setPicked([...picked, copies[0].id])
    else toggle(c)
  }
  const count = (name: string) => picked.filter((id) => cards.find((x) => x.id === id)?.name === name).length
  const order = (name: string) =>
    picked
      .map((id, i) => (cards.find((x) => x.id === id)?.name === name ? i + 1 : 0))
      .filter(Boolean)
      .join(', ')
  return (
    <Modal
      title={t('Search: {what}', { what: searchWhat(t, act) })}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={() => onConfirm([])}
            className="mr-auto rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40"
          >
            {t('Find nothing, just shuffle')}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40"
          >
            {t('Cancel')}
          </button>
          <button
            disabled={picked.length < need}
            onClick={() => onConfirm(picked)}
            className="rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-40"
          >
            {t('Confirm ({n}/{max})', { n: picked.length, max: act.n })}
          </button>
        </>
      }
    >
      <p className="px-4 pt-3 text-sm text-parchment/70">
        <strong className="text-parchment">{source}</strong> · {actLabel(t, act)}
        {act.to.length > 1 && (
          <span className="block text-xs text-parchment/50">
            {t('The 1st card you pick goes onto the battlefield tapped, the 2nd into your hand.')}
          </span>
        )}
      </p>
      <div className="flex min-h-0 flex-1">
        <div className="flex flex-wrap content-start gap-2 overflow-y-auto p-4">
          {unique.length === 0 && <p className="text-sm text-parchment/50">{t('No card in your library fits.')}</p>}
          {unique.map((c) => {
            const n = count(c.name)
            const total = cards.filter((x) => x.name === c.name).length
            return (
              <button
                key={c.id}
                onClick={() => pickName(c)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  const last = [...picked].reverse().find((id) => cards.find((x) => x.id === id)?.name === c.name)
                  if (last) setPicked(picked.filter((id) => id !== last))
                }}
                onMouseEnter={() => setHover(c)}
                onMouseLeave={() => setHover(null)}
                title={c.name}
                className={`relative w-[110px] overflow-hidden rounded-[6%] transition ${n ? 'ring-2 ring-gold' : 'hover:ring-2 hover:ring-parchment/40'}`}
              >
                <img src={smallImage(c.image)} alt={c.name} loading="lazy" className="w-full" />
                {total > 1 && (
                  <span className="absolute right-1 bottom-1 rounded-full bg-ink/90 px-1.5 text-[0.65rem] font-bold ring-1 ring-line">
                    ×{total}
                  </span>
                )}
                {n > 0 && (
                  <span className="absolute top-1 left-1 rounded-full bg-gold px-1.5 text-xs font-bold text-ink">
                    {order(c.name)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {hover && (
          <img src={hover.image} alt="" className="hidden w-64 self-start rounded-[4%] p-4 lg:block" aria-hidden />
        )}
      </div>
    </Modal>
  )
}

/** Quantidade de um atalho que depende do jogo ("create X tokens", "for each land you control") */
export function QuantityDialog({
  title,
  onConfirm,
  onClose,
}: {
  title: string
  onConfirm: (n: number) => void
  onClose: () => void
}) {
  const t = useT()
  const [n, setN] = useState(1)
  return (
    <Modal
      title={t('How many?')}
      onClose={onClose}
      narrow
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40"
          >
            {t('Cancel')}
          </button>
          <button
            onClick={() => onConfirm(n)}
            className="rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-ink"
          >
            {t('Confirm')}
          </button>
        </>
      }
    >
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm(n)
        }}
      >
        <p className="text-sm text-parchment/70">{title}</p>
        <input
          autoFocus
          type="number"
          min={1}
          max={20}
          value={n}
          onChange={(e) => setN(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          aria-label={t('How many?')}
          className="w-24 rounded-md border border-line bg-surface px-3 py-2 text-lg focus:border-gold focus:outline-none"
        />
      </form>
    </Modal>
  )
}

/** Atalho que mexe nos outros jogadores (destruir tudo, drenar): confirma antes */
export function ConfirmActionDialog({
  label,
  source,
  onConfirm,
  onClose,
}: {
  label: string
  source: string
  onConfirm: () => void
  onClose: () => void
}) {
  const t = useT()
  return (
    <Modal
      title={source}
      onClose={onClose}
      narrow
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40"
          >
            {t('Cancel')}
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            className="rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-ink"
          >
            {t('Do it')}
          </button>
        </>
      }
    >
      <p className="p-4 text-sm">
        {label}
        <span className="mt-1 block text-xs text-parchment/50">{t('This affects the other players too.')}</span>
      </p>
    </Modal>
  )
}

/** Cartas do seu grimório: busca (todas, em ordem) ou as X do topo. Clique numa carta para movê-la. */
export function LibraryViewer({
  mode,
  cards,
  onClose,
}: {
  mode: 'top' | 'search'
  cards: TableCard[]
  onClose: () => void
}) {
  const t = useT()
  const { send } = useTable()
  const [filter, setFilter] = useState('')
  // Vidência: a ordem arrastada aparece na hora; o servidor confirma em seguida
  const [order, setOrder] = useState<string[] | null>(null)
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null)
  // Carta ampliada dentro da janela (a prévia da mesa ficaria por cima dela)
  const [hover, setHover] = useState<TableCard | null>(null)
  const q = filter.trim().toLowerCase()
  const byId = new Map(cards.map((c) => [c.id, c]))
  const ordered =
    mode === 'top' && order
      ? [
          ...order.filter((id) => byId.has(id)).map((id) => byId.get(id)!),
          ...cards.filter((c) => !order.includes(c.id)),
        ]
      : cards
  const byName = q ? ordered.filter((c) => c.name.toLowerCase().includes(q)) : ordered
  // Filtro por tipo (criatura, terreno...), igual ao do cemitério
  const types = useTypeFilter(byName)
  const shown = types.cards
  const drop = (e: DragEvent<HTMLDivElement>, target: string) => {
    const dragged = readDrag(e)?.id
    setOver(null)
    if (mode !== 'top' || !dragged || dragged === target || !byId.has(dragged)) return
    e.preventDefault()
    e.stopPropagation()
    const ids = ordered.map((c) => c.id).filter((id) => id !== dragged)
    const r = e.currentTarget.getBoundingClientRect()
    const after = e.clientX > r.left + r.width / 2
    ids.splice(ids.indexOf(target) + (after ? 1 : 0), 0, dragged)
    setOrder(ids)
    send({ type: 'reorder_top', order: ids })
  }
  const btn =
    'rounded-md border border-line px-3 py-1.5 text-sm transition hover:border-parchment/40 hover:bg-parchment/10'
  return (
    <Modal
      title={mode === 'search' ? t('Search your library') : t('Top of your library')}
      onClose={onClose}
      footer={
        <>
          <button
            className={btn}
            onClick={() => {
              send({ type: 'shuffle' })
              onClose()
            }}
          >
            {t('Shuffle and close')}
          </button>
          <button className="rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-ink" onClick={onClose}>
            {t('Done')}
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3 text-xs text-parchment/50">
        <span>
          {mode === 'top'
            ? t('Leftmost is the top. Drag to change the order; click a card to move it (to the bottom for scry).')
            : t('Click a card to move it. Only you see these cards.')}
        </span>
        {mode === 'search' && (
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('Filter by name')}
            className="ml-auto rounded-md border border-line bg-surface px-2 py-1 text-sm text-parchment focus:border-gold focus:outline-none"
          />
        )}
      </div>
      <TypeChips f={types} className="px-4 pt-3" />
      {hover?.image && (
        <img
          src={hover.image}
          alt={hover.name}
          className="pointer-events-none fixed top-24 right-6 z-[60] hidden w-64 rounded-[4.5%] shadow-2xl shadow-black lg:block"
        />
      )}
      <div className="flex flex-wrap gap-2 overflow-y-auto p-4">
        {shown.length === 0 && <p className="text-sm text-parchment/40">{t('Empty.')}</p>}
        {shown.map((c, i) => (
          <div
            key={c.id}
            onDragOver={(e) => {
              if (mode !== 'top' || !acceptsCard(e)) return
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              setOver({ id: c.id, after: e.clientX > r.left + r.width / 2 })
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => drop(e, c.id)}
            className={`relative rounded-md border-x-4 transition-colors ${
              over?.id === c.id
                ? over.after
                  ? 'border-r-gold border-l-transparent'
                  : 'border-l-gold border-r-transparent'
                : 'border-transparent'
            }`}
          >
            {mode === 'top' && (
              <span className="absolute -top-2 left-1 z-10 rounded-full bg-ink px-1.5 text-[0.65rem] font-bold text-parchment/70 ring-1 ring-line">
                {i + 1}
              </span>
            )}
            <CardView card={c} zone="library" mine width={128} menuOnClick onHover={setHover} />
          </div>
        ))}
      </div>
    </Modal>
  )
}

type ScryCard = {
  id: string
  name: string
  type_line: string
  power?: string
  toughness?: string
  image_uris?: { normal: string; small: string }
}
const TOKEN_SUGGESTIONS = [
  'Treasure',
  'Soldier',
  'Zombie',
  'Goblin',
  'Spirit',
  'Saproling',
  'Clue',
  'Food',
  'Elf Warrior',
  'Thopter',
]

/**
 * Fichas (busca no Scryfall) e cartas de ajuda da mesa (Monarca, Iniciativa, O Anel, energia...):
 * clique numa para colocá-la no seu campo.
 */
export function TokenPicker({
  onClose,
  tab: initialTab = 'tokens',
  query: initialQuery = 'Treasure',
}: {
  onClose: () => void
  tab?: TokenTab
  /** Busca já preenchida (atalho de carta cuja ficha não foi achada sozinha) */
  query?: string
}) {
  const t = useT()
  const { send } = useTable()
  const [tab, setTab] = useState<TokenTab>(initialTab)
  const [query, setQuery] = useState(initialQuery)
  const q = useDebounce(query.trim(), 350)
  const [result, setResult] = useState<{ q: string; cards: ScryCard[] }>({ q: '', cards: [] })
  useEffect(() => {
    if (!q) return
    const ctrl = new AbortController()
    fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(`${q} t:token`)}&unique=art`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setResult({ q, cards: (d.data ?? []).filter((c: ScryCard) => c.image_uris).slice(0, 40) }))
      .catch(() => {})
    return () => ctrl.abort()
  }, [q])
  const loading = !!q && result.q !== q
  const cards = q ? result.cards : []
  const picks = useTokenPicks()
  const favorites = new Set(picks.tokens.favorite.map((f) => f.image))
  const create = (tok: SavedToken) => {
    send({ type: 'token', name: tok.name, image: tok.image, power: tok.power, toughness: tok.toughness })
    rememberToken(tok)
    onClose()
  }
  const tile = (tok: SavedToken, key: string, title = tok.name) => (
    <PickTile
      key={key}
      title={title}
      image={tok.small}
      favorite={favorites.has(tok.image)}
      onPick={() => create(tok)}
      onFavorite={() => toggleFavoriteToken(tok)}
    />
  )
  return (
    <Modal title={tab === 'tokens' ? t('Create a token') : t('Board helpers')} onClose={onClose}>
      <div role="tablist" className="flex gap-1 px-4 pt-3">
        {(['tokens', 'helpers'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              tab === k ? 'border-gold bg-gold/15 text-gold' : 'border-line text-parchment/60 hover:text-parchment'
            }`}
          >
            {k === 'tokens' ? t('Tokens') : t('Board helpers')}
          </button>
        ))}
      </div>
      {tab === 'helpers' ? (
        <HelperGrid onPick={onClose} />
      ) : (
        <>
          <div className="space-y-2 px-4 pt-3">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Search tokens (e.g. Soldier, Treasure)')}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 focus:border-gold focus:outline-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {TOKEN_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setQuery(s)}
                  className="rounded-full border border-line px-2.5 py-0.5 text-xs text-parchment/70 hover:border-gold hover:text-gold"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-4 overflow-y-auto p-4">
            <PickRow title={t('Favorites')}>
              {picks.tokens.favorite.map((tok) => tile(tok, `f:${tok.image}`))}
            </PickRow>
            <PickRow title={t('Recently used')}>
              {picks.tokens.recent.map((tok) => tile(tok, `r:${tok.image}`))}
            </PickRow>
            <div className="flex flex-wrap gap-2">
              {loading && <p className="text-sm text-parchment/50">{t('Loading…')}</p>}
              {!loading && cards.length === 0 && (
                <p className="text-sm text-parchment/40">{t('No tokens found.')}</p>
              )}
              {!loading &&
                cards.map((c) =>
                  tile(
                    {
                      name: c.name,
                      image: c.image_uris!.normal,
                      small: c.image_uris!.small,
                      power: c.power,
                      toughness: c.toughness,
                    },
                    c.id,
                    `${c.name} — ${c.type_line}`,
                  ),
                )}
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}

type TokenTab = 'tokens' | 'helpers'

/** Seção de favoritos / recentes (some quando está vazia) */
function PickRow({ title, children }: { title: string; children: ReactNode[] }) {
  if (!children.length) return null
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-gold uppercase">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  )
}

/** Ficha ou carta de ajuda: clique cria; a estrela no canto marca como favorita */
function PickTile({
  title,
  label,
  image,
  icon: Icon,
  favorite,
  onPick,
  onFavorite,
}: {
  title: string
  /** Nome embaixo da imagem (cartas de ajuda) */
  label?: string
  image: string | null
  icon?: Helper['icon']
  favorite: boolean
  onPick: () => void
  onFavorite: () => void
}) {
  const t = useT()
  const favLabel = favorite ? t('Remove from favorites') : t('Add to favorites')
  return (
    <div className="group relative w-[110px]">
      <button
        disabled={!image}
        title={title}
        onClick={onPick}
        className="flex w-full flex-col items-center gap-1 rounded-md text-center text-[0.7rem] text-parchment/70 transition enabled:hover:text-gold disabled:opacity-50"
      >
        {image ? (
          <img
            src={image}
            alt={label ? '' : title}
            loading="lazy"
            className="w-full rounded-[6%] hover:ring-2 hover:ring-gold"
          />
        ) : (
          <span className="grid aspect-[5/7] w-full place-items-center rounded-[6%] border border-dashed border-line">
            {Icon && <Icon className="h-6 w-6 text-parchment/30" aria-hidden />}
          </span>
        )}
        {label}
      </button>
      <button
        onClick={onFavorite}
        aria-pressed={favorite}
        title={favLabel}
        aria-label={favLabel}
        className={`absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-ink/85 ring-1 ring-line transition hover:text-gold focus-visible:opacity-100 ${
          favorite ? 'text-gold' : 'text-parchment/70 opacity-0 group-hover:opacity-100'
        }`}
      >
        <Star className="h-3.5 w-3.5" fill={favorite ? 'currentColor' : 'none'} aria-hidden />
      </button>
    </div>
  )
}

const HELPER_GROUPS = [
  ['designation', 'Designations'],
  ['counter', 'Player counters'],
  ['dungeon', 'Dungeons'],
] as const

/** Cartas de ajuda, em grupos: entram no seu campo (Monarca, Iniciativa e Dia/Noite são únicas na mesa) */
function HelperGrid({ onPick }: { onPick: () => void }) {
  const t = useT()
  const { send } = useTable()
  const [images, setImages] = useState<HelperImages | null>(null)
  const picks = useTokenPicks()
  useEffect(() => {
    let alive = true
    loadHelperImages().then((imgs) => alive && setImages(imgs))
    return () => {
      alive = false
    }
  }, [])
  const tile = (h: Helper, prefix = '') => {
    const img = images?.[h.key]
    const label = helperLabel(t, h.key)
    return (
      <PickTile
        key={prefix + h.key}
        title={label}
        label={label}
        image={img ? smallImage(img.image) : null}
        icon={h.icon}
        favorite={picks.helpers.favorite.includes(h.key)}
        onPick={() => {
          if (!img) return
          send({ type: 'token', name: h.name, image: img.image, back: img.back || undefined, helper: true })
          rememberHelper(h.key)
          onPick()
        }}
        onFavorite={() => toggleFavoriteHelper(h.key)}
      />
    )
  }
  const saved = (keys: string[]) =>
    keys.map((k) => HELPERS.find((h) => h.key === k)).filter((h): h is Helper => !!h)
  return (
    <div className="space-y-4 overflow-y-auto p-4">
      <p className="text-xs text-parchment/50">
        {t('The Monarch, the Initiative and Day/Night exist once per table: taking one moves it to your battlefield.')}
      </p>
      <PickRow title={t('Favorites')}>{saved(picks.helpers.favorite).map((h) => tile(h, 'f:'))}</PickRow>
      <PickRow title={t('Recently used')}>{saved(picks.helpers.recent).map((h) => tile(h, 'r:'))}</PickRow>
      {HELPER_GROUPS.map(([group, label]) => (
        <section key={group}>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-gold uppercase">{t(label)}</h3>
          <div className="flex flex-wrap gap-2">{HELPERS.filter((h) => h.group === group).map((h) => tile(h))}</div>
        </section>
      ))}
      {images && Object.keys(images).length === 0 && (
        <p className="text-sm text-parchment/50">{t('Could not reach Scryfall. Try again in a moment.')}</p>
      )}
    </div>
  )
}

/** Carta revelada: aparece para todos por alguns segundos (vem do log, então chega a todo mundo). */
export function RevealOverlay({ entry, onDone }: { entry: LogItem; onDone: () => void }) {
  const t = useT()
  useEffect(() => {
    const timer = setTimeout(onDone, entry.cards && entry.cards.length > 1 ? 7000 : 4500)
    return () => clearTimeout(timer)
  }, [entry, onDone])
  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-black/40">
      <div className="animate-[flip-in_0.35s_ease-out] text-center">
        <p className="mb-3 text-sm font-semibold text-parchment/80">
          {entry.cards && entry.cards.length > 1
            ? t('{who} revealed the top {n} cards of their library', { who: entry.who, n: entry.cards.length })
            : entry.frm === 'library'
              ? t('{who} revealed the top card of their library', { who: entry.who })
              : t('{who} revealed', { who: entry.who })}
        </p>
        {entry.cards && entry.cards.length > 1 ? (
          <div className="flex max-w-[90vw] flex-wrap justify-center gap-3">
            {entry.cards.map((c, i) => (
              <img
                key={i}
                src={c.image}
                alt={c.name}
                className={`${entry.cards!.length > 5 ? 'w-36' : 'w-48'} rounded-[4.5%] shadow-2xl shadow-black`}
              />
            ))}
          </div>
        ) : (
          entry.image && (
            <img src={entry.image} alt={entry.card ?? ''} className="w-72 rounded-[4.5%] shadow-2xl shadow-black" />
          )
        )}
      </div>
    </div>
  )
}

/** Dados e moeda: o resultado sai do servidor e aparece no log para todos. */
export function DiceButtons() {
  const t = useT()
  const { send } = useTable()
  const dice: [string, number, string][] = [
    ['d6', 6, '`'],
    ['d20', 20, 'Shift+`'],
  ]
  // Dado personalizado ("d?"): o jogador escolhe quantos lados (2 a 1000)
  const [custom, setCustom] = useState(false)
  const [sides, setSides] = useState('100')
  const n = Math.round(Number(sides))
  const valid = Number.isFinite(n) && n >= 2 && n <= 1000
  return (
    <div className="flex gap-1" role="group" aria-label={t('Dice')}>
      <IconButton
        icon={Coins}
        label={t('Flip a coin')}
        hotkey="Shift+C"
        onClick={() => send({ type: 'roll', sides: 2 })}
      />
      {dice.map(([label, s, key]) => (
        <IconButton
          key={s}
          text={label}
          label={t('Roll a d{sides}', { sides: s })}
          hotkey={key}
          onClick={() => send({ type: 'roll', sides: s })}
        />
      ))}
      {custom ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) send({ type: 'roll', sides: n })
          }}
          className="inline-flex h-8 overflow-hidden rounded-md border border-gold/50 text-xs"
        >
          <span className="pl-2 py-1 text-parchment/60">d</span>
          <input
            type="number"
            min={2}
            max={1000}
            value={sides}
            autoFocus
            onChange={(e) => setSides(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setCustom(false)}
            aria-label={t('Number of sides')}
            className="w-12 bg-transparent px-1 text-center focus:outline-none"
          />
          <button
            disabled={!valid}
            className="border-l border-line px-2 transition enabled:hover:bg-parchment/10 disabled:opacity-40"
          >
            {t('Roll')}
          </button>
          <button
            type="button"
            onClick={() => setCustom(false)}
            aria-label={t('Close')}
            className="border-l border-line px-1.5 text-parchment/50 hover:text-parchment"
          >
            ×
          </button>
        </form>
      ) : (
        <IconButton text="d?" label={t('Custom die')} onClick={() => setCustom(true)} />
      )}
    </div>
  )
}

/**
 * Setas de alvo ("Mirar…"): da carta até a carta ou o jogador mirado, por alguns segundos, na
 * tela de todos. As posições vêm da própria página (data-card-id e data-seat-avatar), então a
 * seta acompanha a carta se o campo mudar de tamanho.
 */
export function TargetArrows({ log, start }: { log: LogItem[]; start: number | null }) {
  const [seen, setSeen] = useState(0)
  const [, setFrame] = useState(0)
  const active = log.filter((e) => e.kind === 'target' && e.ref && (e.id ?? 0) > Math.max(start ?? Infinity, seen))
  const lastId = active.at(-1)?.id ?? 0
  useEffect(() => {
    if (!lastId) return
    let raf = 0
    const loop = () => {
      setFrame((f) => (f + 1) % 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    playSound('target')
    const timer = setTimeout(() => setSeen(lastId), 5000)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [lastId])
  if (!active.length) return null
  const center = (selector: string) => {
    const el = document.querySelector(selector)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
  }
  const arrows = active.flatMap((e) => {
    const from = center(`[data-card-id="${e.ref}"]`)
    const to = e.to_ref ? center(`[data-card-id="${e.to_ref}"]`) : center(`[data-seat-avatar="${e.to_seat}"]`)
    if (!from || !to) return []
    // Para um pouco antes do centro do alvo, para a ponta não ficar escondida
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.max(1, Math.hypot(dx, dy))
    const end = { x: to.x - (dx / len) * 18, y: to.y - (dy / len) * 18 }
    return [{ id: e.id, from, to: end, target: to }]
  })
  return (
    <svg className="pointer-events-none fixed inset-0 z-[35] h-full w-full" aria-hidden>
      <defs>
        <marker id="target-head" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#e4572e" />
        </marker>
      </defs>
      {arrows.map((a) => (
        <g key={a.id}>
          <line
            x1={a.from.x}
            y1={a.from.y}
            x2={a.to.x}
            y2={a.to.y}
            stroke="#000"
            strokeOpacity={0.6}
            strokeWidth={8}
            strokeLinecap="round"
          />
          <line
            x1={a.from.x}
            y1={a.from.y}
            x2={a.to.x}
            y2={a.to.y}
            stroke="#e4572e"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray="10 6"
            markerEnd="url(#target-head)"
            className="animate-[dash_0.8s_linear_infinite]"
          />
          <circle cx={a.from.x} cy={a.from.y} r={7} fill="#e4572e" stroke="#000" strokeWidth={2} />
          <circle cx={a.target.x} cy={a.target.y} r={22} fill="none" stroke="#e4572e" strokeWidth={3} />
        </g>
      ))}
    </svg>
  )
}

/** Resultado de dado ou moeda no meio da mesa, por um instante, para todos. */
export function RollOverlay({ entry, onDone }: { entry: LogItem; onDone: () => void }) {
  const t = useT()
  useEffect(() => {
    const timer = setTimeout(onDone, 2200)
    return () => clearTimeout(timer)
  }, [entry, onDone])
  const coin = entry.sides === 2
  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center">
      <div className="animate-[flip-in_0.35s_ease-out] rounded-2xl border border-gold/60 bg-ink/90 px-10 py-6 text-center shadow-2xl shadow-black">
        <p className="text-sm text-parchment/70">
          {coin
            ? t('{who} flipped a coin', { who: entry.who })
            : t('{who} rolled a d{sides}', { who: entry.who, sides: entry.sides ?? 0 })}
        </p>
        <p className="font-display mt-1 text-7xl text-gold">
          {coin ? (entry.n === 1 ? t('Heads') : t('Tails')) : entry.n}
        </p>
      </div>
    </div>
  )
}

/** Toca os sons das novidades do log (dados, moeda, embaralhar, revelar, chat, entrada). */
export function LogSounds({ log, start }: { log: LogItem[]; start: number | null }) {
  const last = useRef<number | null>(null)
  useEffect(() => {
    if (start === null) return
    last.current ??= start
    for (const e of log) {
      if ((e.id ?? 0) <= last.current) continue
      if (e.kind === 'roll') playSound(e.sides === 2 ? 'coin' : 'dice')
      else if (e.kind === 'shuffle' || e.kind === 'mulligan') playSound('shuffle')
      else if (e.kind === 'reveal') playSound('reveal')
      else if (e.kind === 'chat') playSound('chat')
      else if (e.kind === 'joined') playSound('join')
      else if (e.kind === 'turn') playSound('turn')
      else if (e.kind === 'game_over') playSound('win')
      else if (e.kind === 'draw') playSound('draw')
      else if (e.kind === 'shake') playSound('shake')
    }
    last.current = Math.max(last.current, log.at(-1)?.id ?? 0)
  }, [log, start])
  return null
}

/** Lista de atalhos de teclado da mesa. */
export function HotkeyHelp({ onClose }: { onClose: () => void }) {
  const t = useT()
  const global: [string, string][] = [
    ['X', t('Untap all your cards')],
    ['Shift + X', t('Untap all and draw a card')],
    ['A', t('Arrange your battlefield in rows')],
    ['# C', t('Draw a card (or # cards)')],
    ['V', t('Shuffle your library')],
    ['M', t('Mulligan')],
    ['B', t('Focus the chat')],
    ['W', t('Create a token')],
    ['F', t('Search your library')],
    ['# G', t('Look at the top # cards (3 by default)')],
    ['`', t('Roll a d6')],
    ['Shift + `', t('Roll a d20')],
    ['Shift + C', t('Flip a coin')],
    ['E', t('End your turn (pass to the next player)')],
    ['T', t('Flip the top of your library (stays revealed until you unflip it)')],
    ['# D', t('Mill: top card(s) to the graveyard')],
    ['# S', t('Exile the top card(s)')],
    ['# P', t('Top card(s) to the facedown pile')],
    ['# Z', t('Play the top card(s)')],
    ['Shift + P', t('Play the top card face down')],
    ['?', t('Show this help')],
  ]
  const hover: [string, string][] = [
    [t('Space'), t('Default action: tap/untap, or play from your hand')],
    ['D', t('Send to graveyard')],
    ['S', t('Send to exile')],
    ['P', t('Send to facedown pile')],
    ['R', t('Return to hand')],
    ['T', t('Put on top of library')],
    ['Y', t('Put on bottom of library')],
    ['K', t('Copy (token)')],
    ['U', t('Add a +1/+1 counter')],
    ['Shift + U', t('Remove a +1/+1 counter')],
    ['Shift + E', t('Reveal to everyone')],
    ['H', t('Shake the card (yours or an opponent’s)')],
    ['Shift + H', t('Highlight the card')],
    ['I', t('Invert the card')],
    ['J', t('Turn face down / face up')],
    ['L', t('Show the other face')],
    ['O', t('Target…')],
    ['N', t('Write a note on the card')],
    [t('Ctrl/Shift + click'), t('Select several cards (or drag a box on an empty spot)')],
  ]
  const row = ([key, label]: [string, string]) => (
    <li key={key} className="flex items-center gap-3 py-1">
      <kbd className="min-w-16 rounded border border-line bg-surface px-1.5 py-0.5 text-center font-mono text-xs">
        {key}
      </kbd>
      <span className="text-sm text-parchment/80">{label}</span>
    </li>
  )
  return (
    <Modal title={t('Hotkeys')} onClose={onClose}>
      <div className="grid gap-6 overflow-y-auto p-4 sm:grid-cols-2">
        <div>
          <h3 className="font-display mb-2 text-lg">{t('Global')}</h3>
          <ul>{global.map(row)}</ul>
          <p className="mt-2 text-xs text-parchment/45">
            {t('# = type a number first (e.g. 3 then C draws 3 cards).')}
          </p>
        </div>
        <div>
          <h3 className="font-display mb-2 text-lg">{t('Hovering one of your cards')}</h3>
          <ul>{hover.map(row)}</ul>
        </div>
      </div>
    </Modal>
  )
}

/** Encerrar a partida: escolher quem ganhou (ou sem vencedor). */
export function EndGameDialog({
  players,
  onConfirm,
  onClose,
}: {
  players: { id: number; name: string }[]
  onConfirm: (winner: number | null) => void
  onClose: () => void
}) {
  const t = useT()
  const [winner, setWinner] = useState<number | null | undefined>(undefined)
  const option = (value: number | null, label: string) => (
    <label
      key={String(value)}
      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition ${
        winner === value ? 'border-gold bg-gold/10' : 'border-line hover:border-parchment/40'
      }`}
    >
      <input
        type="radio"
        name="winner"
        checked={winner === value}
        onChange={() => setWinner(value)}
        className="accent-[#e4572e]"
      />
      <span className={value === null ? 'text-parchment/60' : 'font-semibold'}>{label}</span>
    </label>
  )
  return (
    <Modal
      title={t('End the game')}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40"
          >
            {t('Cancel')}
          </button>
          <button
            disabled={winner === undefined}
            onClick={() => onConfirm(winner ?? null)}
            className="rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-40"
          >
            {t('End game')}
          </button>
        </>
      }
    >
      <div className="space-y-2 p-4">
        <p className="text-sm text-parchment/60">{t('Who won?')}</p>
        {players.map((p) => option(p.id, p.name))}
        {option(null, t('No winner (draw or abandoned)'))}
      </div>
    </Modal>
  )
}

/**
 * Sair da mesa: só sair (o lugar continua guardado, dá para voltar) ou abandonar de vez (o lugar
 * fica livre e as suas cartas saem da mesa). Abandonar pede uma segunda confirmação.
 */
export function LeaveDialog({
  onKeepSeat,
  onAbandon,
  onClose,
}: {
  onKeepSeat: () => void
  onAbandon: () => void
  onClose: () => void
}) {
  const t = useT()
  const [confirm, setConfirm] = useState(false)
  const [sent, setSent] = useState(false)
  return (
    <Modal title={t('Leave the table')} onClose={onClose} narrow>
      <div className="space-y-3 overflow-y-auto p-4">
        <button
          autoFocus
          onClick={onKeepSeat}
          className="w-full rounded-lg border border-line px-4 py-3 text-left transition hover:border-gold"
        >
          <span className="block font-semibold">{t('Leave and keep my seat')}</span>
          <span className="block text-sm text-parchment/60">
            {t('Your cards stay on the table and you can come back with the same link.')}
          </span>
        </button>
        {!confirm ? (
          <button
            onClick={() => setConfirm(true)}
            className="w-full rounded-lg border border-line px-4 py-3 text-left transition hover:border-red-400"
          >
            <span className="block font-semibold text-red-300">{t('Abandon the table')}</span>
            <span className="block text-sm text-parchment/60">
              {t('Your seat is freed and your cards leave the table. This cannot be undone.')}
            </span>
          </button>
        ) : (
          <div role="alert" className="rounded-lg border border-red-400/60 bg-red-400/10 px-4 py-3">
            <p className="text-sm">{t('Abandon the table for good? Your cards leave the game.')}</p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setConfirm(false)}
                className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40"
              >
                {t('Cancel')}
              </button>
              <button
                disabled={sent}
                onClick={() => {
                  setSent(true)
                  onAbandon()
                }}
                className="rounded-md bg-red-500 px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
              >
                {sent ? t('Leaving…') : t('Yes, abandon')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Fim de partida: aparece para todos, com a opção de jogar de novo com os mesmos decks. */
export function GameOverOverlay({
  winner,
  fromDraw,
  onNewGame,
  onClose,
}: {
  winner: string | null
  fromDraw: boolean
  onNewGame: () => void
  onClose: () => void
}) {
  const t = useT()
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-label={t('Game over')}
        className="w-full max-w-md animate-[flip-in_0.4s_ease-out] rounded-2xl border border-gold/60 bg-ink p-6 text-center shadow-2xl shadow-black"
      >
        <p className="text-5xl" aria-hidden>
          🏆
        </p>
        <p className="mt-2 text-sm tracking-wide text-parchment/60 uppercase">{t('Game over')}</p>
        <p className="font-display mt-1 text-4xl text-gold">
          {winner ? t('{name} won!', { name: winner }) : t('No winner')}
        </p>
        {fromDraw && winner && (
          <p className="mt-2 text-xs text-parchment/50">{t('Result saved to the deal and the ranking.')}</p>
        )}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            onClick={onNewGame}
            className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink hover:brightness-110"
          >
            {t('Play again (same decks)')}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-line px-4 py-2 text-sm hover:border-parchment/40"
          >
            {t('Look at the table')}
          </button>
        </div>
      </div>
    </div>
  )
}
