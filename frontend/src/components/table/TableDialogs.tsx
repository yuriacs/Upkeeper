import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import type { TableCard } from '../../hooks/useTableSocket'
import { useDebounce } from '../../hooks/useDebounce'
import { useT } from '../../lib/i18n'
import { smallImage } from '../../lib/cardImage'
import { placeLabel } from '../../lib/tournaments'
import type { TableTournament } from '../../lib/types'
import { HELPERS, helperLabel, loadHelperImages, type Helper, type HelperImages } from './helpers'
import {
  rememberHelper,
  rememberToken,
  toggleFavoriteHelper,
  toggleFavoriteToken,
  useTokenPicks,
  type SavedToken,
} from '../../lib/tokenPicks'
import { ImagePlus, Star } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import CardArtDialog from '../builder/CardArtDialog'
import { api } from '../../lib/api'
import { TOKEN_ARTS_KEY, tokenImage, useTokenArts } from '../../lib/tokenArts'
import { actLabel, searchWhat, type CardAct } from './cardActs'
import { CardView, TypeChips } from './TableKit'
import { CustomTokens } from './CustomTokens'
import type { CardSpec } from '../../lib/cardRender'
import { useTypeFilter } from './typeFilter'
import { acceptsCard, readDrag, useTable } from './tableUtils'

/*
 * Janelas da mesa que só abrem quando alguém pede: grimório (buscar / olhar o topo), fichas do
 * Scryfall, ações de carta, atalhos, encerrar e sair. Ficam fora do pacote da mesa e carregam na
 * primeira vez que abrem (TablePage); o que aparece sozinho na partida fica em TableExtras.
 */

function Modal({
  title,
  onClose,
  children,
  footer,
  narrow = false,
  cardKeys = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Janela estreita (escolhas curtas) */
  narrow?: boolean
  /** Os atalhos de mover carta valem para a carta sob o mouse aqui dentro (grimório) */
  cardKeys?: boolean
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
        data-card-keys={cardKeys || undefined}
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
            className="rounded-md btn-ember px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-40"
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

/**
 * Devolver do cemitério (Eternal Witness, Sun Titan...): as cartas do seu cemitério que servem.
 * Clique para escolher até a quantidade do texto.
 */
export function GraveyardPickDialog({
  act,
  source,
  cards,
  onConfirm,
  onClose,
}: {
  act: Extract<CardAct, { k: 'regrow' }>
  source: string
  cards: TableCard[]
  onConfirm: (ids: string[]) => void
  onClose: () => void
}) {
  const t = useT()
  const [picked, setPicked] = useState<string[]>([])
  const [hover, setHover] = useState<TableCard | null>(null)
  const toggle = (c: TableCard) => {
    if (picked.includes(c.id)) setPicked(picked.filter((id) => id !== c.id))
    else if (picked.length < act.n) setPicked([...picked, c.id])
  }
  return (
    <Modal
      title={t('Your graveyard')}
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
            disabled={!picked.length}
            onClick={() => onConfirm(picked)}
            className="rounded-md btn-ember px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-40"
          >
            {t('Confirm ({n}/{max})', { n: picked.length, max: act.n })}
          </button>
        </>
      }
    >
      <p className="px-4 pt-3 text-sm text-parchment/70">
        <strong className="text-parchment">{source}</strong> · {actLabel(t, act)}
      </p>
      <div className="flex min-h-0 flex-1">
        <div className="flex flex-wrap content-start gap-2 overflow-y-auto p-4">
          {cards.length === 0 && <p className="text-sm text-parchment/50">{t('No card in your graveyard fits.')}</p>}
          {cards.map((c) => (
            <button
              key={c.id}
              onClick={() => toggle(c)}
              onMouseEnter={() => setHover(c)}
              onMouseLeave={() => setHover(null)}
              title={c.name}
              className={`relative w-[110px] overflow-hidden rounded-[6%] transition ${picked.includes(c.id) ? 'ring-2 ring-gold' : 'hover:ring-2 hover:ring-parchment/40'}`}
            >
              <img src={smallImage(c.image)} alt={c.name} loading="lazy" className="w-full" />
              {picked.includes(c.id) && (
                <span className="absolute top-1 left-1 rounded-full bg-gold px-1.5 text-xs font-bold text-ink">
                  {picked.indexOf(c.id) + 1}
                </span>
              )}
            </button>
          ))}
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
            className="rounded-md btn-ember px-3 py-1.5 text-sm font-semibold text-ink"
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
            className="rounded-md btn-ember px-3 py-1.5 text-sm font-semibold text-ink"
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
  const { send, hoverKeys } = useTable()
  const [filter, setFilter] = useState('')
  // Vidência: a ordem arrastada aparece na hora; o servidor confirma em seguida
  const [order, setOrder] = useState<string[] | null>(null)
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null)
  // Carta ampliada dentro da janela (a prévia da mesa ficaria por cima dela)
  const [hover, setHover] = useState<TableCard | null>(null)
  // A carta sob o mouse também é o alvo dos atalhos (D cemitério, R mão, Espaço campo...)
  const onHover = (c: TableCard | null) => {
    setHover(c)
    hoverKeys(c ? { card: c, zone: 'library', mine: true, tapped: false } : null)
  }
  useEffect(() => () => hoverKeys(null), [hoverKeys])
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
      cardKeys
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
          <button className="rounded-md btn-ember px-3 py-1.5 text-sm font-semibold text-ink" onClick={onClose}>
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
      {/* Some quando a carta sai do grimório (atalho de teclado) */}
      {hover?.image && byId.has(hover.id) && (
        <img
          src={hover.image}
          alt={hover.name}
          className="pointer-events-none fixed top-24 right-6 z-[60] hidden w-64 rounded-[4.5%] shadow-2xl shadow-black lg:block"
        />
      )}
      <div
        className="flex flex-wrap gap-2 overflow-y-auto p-4"
        // Carta que desliza para baixo do mouse (a de antes saiu): o movimento confere qual está sob ele
        onMouseMove={(e) => {
          const id = (e.target as HTMLElement).closest('[data-card-id]')?.getAttribute('data-card-id')
          if (id !== hover?.id) onHover(shown.find((c) => c.id === id) ?? null)
        }}
      >
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
            <CardView card={c} zone="library" mine width={128} menuOnClick onHover={onHover} />
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
  oracle_id?: string
  power?: string
  toughness?: string
  image_uris?: { normal: string; small: string }
  card_faces?: Omit<ScryCard, 'id' | 'card_faces'>[]
}

/**
 * Fichas de duas faces (Dinosaur // Treasure, Copy // Horror...) não têm imagem no topo: cada face
 * vira uma ficha. Se a busca é um nome, ficam só as faces que batem com ele (procurar Treasure não
 * traz o Dinosaur do verso).
 */
function tokenFaces(cards: ScryCard[], q: string): ScryCard[] {
  const word = /[:<>=]/.test(q) ? '' : q.toLowerCase()
  return cards.flatMap((c) => {
    if (c.image_uris || !c.card_faces) return [c]
    const faces = c.card_faces
      .map((f, i) => ({ ...f, id: `${c.id}:${i}`, oracle_id: f.oracle_id ?? c.oracle_id }))
      .filter((f) => f.image_uris)
    const match = faces.filter((f) => `${f.name} ${f.type_line}`.toLowerCase().includes(word))
    return match.length ? match : faces
  })
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
 * Fichas (busca no Scryfall ou personalizadas, desenhadas no site, para as que o Scryfall não tem)
 * e cartas de ajuda da mesa (Monarca, Iniciativa, O Anel, energia...): clique numa para colocá-la
 * no seu campo. Cada ficha do Scryfall pode ganhar uma arte sua (como no untap), que passa a valer
 * em toda mesa.
 */
export function TokenPicker({
  onClose,
  tab: initialTab = 'tokens',
  query: initialQuery = 'Treasure',
  draft: initialDraft,
}: {
  onClose: () => void
  tab?: TokenTab
  /** Busca já preenchida (atalho de carta cuja ficha não foi achada sozinha) */
  query?: string
  /** Começo da ficha personalizada, se o jogador for montar uma (o que o atalho sabe dela) */
  draft?: Partial<CardSpec>
}) {
  const t = useT()
  const { send } = useTable()
  const [tab, setTab] = useState<TokenTab>(initialTab)
  const [query, setQuery] = useState(initialQuery)
  const [draft, setDraft] = useState(initialDraft)
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
      .then((d) => setResult({ q, cards: tokenFaces(d.data ?? [], q).filter((c) => c.image_uris).slice(0, 40) }))
      .catch(() => {})
    return () => ctrl.abort()
  }, [q])
  const loading = !!q && result.q !== q
  const cards = q ? result.cards : []
  const picks = useTokenPicks()
  const favorites = new Set(picks.tokens.favorite.map((f) => f.image))
  const arts = useTokenArts()
  const queryClient = useQueryClient()
  const [artFor, setArtFor] = useState<SavedToken | null>(null)
  const create = (tok: SavedToken) => {
    const image = tokenImage(arts, tok.image, tok.oracleId)
    send({ type: 'token', name: tok.name, image, power: tok.power, toughness: tok.toughness })
    rememberToken(tok)
    onClose()
  }
  const tile = (tok: SavedToken, key: string, title = tok.name) => (
    <PickTile
      key={key}
      title={title}
      image={tokenImage(arts, tok.small, tok.oracleId)}
      favorite={favorites.has(tok.image)}
      onPick={() => create(tok)}
      onFavorite={() => toggleFavoriteToken(tok)}
      art={tok.oracleId ? { name: tok.name, on: !!arts[tok.oracleId], open: () => setArtFor(tok) } : undefined}
    />
  )
  // Ficha com arte sua aparece uma vez só na busca (as outras edições dela ficariam iguais)
  const seen = new Set<string>()
  const found = cards.filter((c) => {
    if (!c.oracle_id || !arts[c.oracle_id]) return true
    if (seen.has(c.oracle_id)) return false
    seen.add(c.oracle_id)
    return true
  })
  return (
    <>
      <Modal title={tab === 'helpers' ? t('Board helpers') : t('Create a token')} onClose={() => !artFor && onClose()}>
        <div role="tablist" className="flex gap-1 px-4 pt-3">
          {(['tokens', 'custom', 'helpers'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                tab === k ? 'border-gold bg-gold/15 text-gold' : 'border-line text-parchment/60 hover:text-parchment'
              }`}
            >
              {k === 'tokens' ? t('Tokens') : k === 'custom' ? t('Custom tokens') : t('Board helpers')}
            </button>
          ))}
        </div>
        {tab === 'helpers' ? (
          <HelperGrid onPick={onClose} />
        ) : tab === 'custom' ? (
          <CustomTokens draft={draft} onCreate={create} />
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
                  <div className="space-y-2">
                    <p className="text-sm text-parchment/40">{t('No tokens found.')}</p>
                    {/* Ficha que o Scryfall não tem (nunca foi impressa): o jogador monta a sua */}
                    {q && !/[:<>=]/.test(q) && (
                      <button
                        onClick={() => {
                          // O que o atalho sabia da ficha só vale se a busca ainda é por ela
                          setDraft((d) => (d?.name?.toLowerCase() === q.toLowerCase() ? d : { name: q }))
                          setTab('custom')
                        }}
                        className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-gold hover:text-gold"
                      >
                        {t('Make your own “{name}” token', { name: q })}
                      </button>
                    )}
                  </div>
                )}
                {!loading &&
                  found.map((c) =>
                    tile(
                      {
                        name: c.name,
                        image: c.image_uris!.normal,
                        small: c.image_uris!.small,
                        power: c.power,
                        toughness: c.toughness,
                        oracleId: c.oracle_id,
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
      {artFor?.oracleId && (
        <CardArtDialog
          card={{ name: artFor.name, image: artFor.image, oracleId: artFor.oracleId }}
          current={arts[artFor.oracleId]}
          assign={(art) => api.setTokenArt(artFor.oracleId!, art)}
          note={t('The image is cropped to the card’s shape. This token shows it in every game, and other players see it: no offensive images.')}
          onChange={(next) => queryClient.setQueryData(TOKEN_ARTS_KEY, next)}
          onClose={() => setArtFor(null)}
        />
      )}
    </>
  )
}

type TokenTab = 'tokens' | 'custom' | 'helpers'

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
  art,
}: {
  title: string
  /** Nome embaixo da imagem (cartas de ajuda) */
  label?: string
  image: string | null
  icon?: Helper['icon']
  favorite: boolean
  onPick: () => void
  onFavorite: () => void
  /** Ficha do Scryfall: escolher uma arte sua para ela (on = já tem) */
  art?: { name: string; on: boolean; open: () => void }
}) {
  const t = useT()
  const artLabel = art ? t('Custom art for {name}', { name: art.name }) : ''
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
      {art && (
        <button
          onClick={art.open}
          title={artLabel}
          aria-label={artLabel}
          className={`absolute top-1 left-1 grid h-6 w-6 place-items-center rounded-full bg-ink/85 ring-1 ring-line transition hover:text-gold focus-visible:opacity-100 ${
            art.on ? 'text-gold' : 'text-parchment/70 opacity-0 group-hover:opacity-100'
          }`}
        >
          <ImagePlus className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
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
    [t('Ctrl/Shift + click'), t('Select several cards (or drag a box on an empty spot): the right-click menu and the card shortcuts apply to all of them')],
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

/**
 * Encerrar a partida: escolher quem ganhou (ou sem vencedor). Mesa de torneio: precisa de
 * vencedor; na liga, clica-se nos jogadores na ordem de chegada (o 1º é o vencedor).
 */
export function EndGameDialog({
  players,
  tournament,
  onConfirm,
  onClose,
}: {
  players: { id: number; name: string }[]
  tournament?: TableTournament | null
  onConfirm: (winner: number | null, placings?: number[]) => void
  onClose: () => void
}) {
  const t = useT()
  const [winner, setWinner] = useState<number | null | undefined>(undefined)
  const league = tournament?.kind === 'league'
  const [order, setOrder] = useState<number[]>([])
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
  const ranked = (p: { id: number; name: string }) => {
    const at = order.indexOf(p.id)
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => setOrder((o) => (o.includes(p.id) ? o.filter((x) => x !== p.id) : [...o, p.id]))}
        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
          at >= 0 ? 'border-gold bg-gold/10' : 'border-line hover:border-parchment/40'
        }`}
      >
        <span className="w-8 text-sm font-semibold text-gold tabular-nums">{at >= 0 ? placeLabel(t, at + 1) : ''}</span>
        <span className="font-semibold">{p.name}</span>
      </button>
    )
  }
  const ready = league ? order.length === players.length : winner !== undefined
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
            disabled={!ready}
            onClick={() => (league ? onConfirm(order[0], order) : onConfirm(winner ?? null))}
            className="rounded-md btn-ember px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-40"
          >
            {t('End game')}
          </button>
        </>
      }
    >
      <div className="space-y-2 p-4">
        {league ? (
          <>
            <p className="text-sm text-parchment/60">
              {t('Click the players in finishing order, starting with the winner.')}
            </p>
            {players.map(ranked)}
          </>
        ) : (
          <>
            <p className="text-sm text-parchment/60">{t('Who won?')}</p>
            {players.map((p) => option(p.id, p.name))}
            {!tournament && option(null, t('No winner (draw or abandoned)'))}
          </>
        )}
        <p className="pt-1 text-xs text-parchment/50">
          {tournament
            ? tournament.teams
              ? t('A player from the other pair confirms. Then the result goes to the tournament and the table closes.')
              : t('Another player at the table confirms. Then the result goes to the tournament and the table closes.')
            : t('Another player at the table confirms. Then the result counts in the ranking and the table closes.')}
        </p>
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
