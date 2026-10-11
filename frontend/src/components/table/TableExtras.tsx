import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LogItem, TableCard } from '../../hooks/useTableSocket'
import { useDebounce } from '../../hooks/useDebounce'
import { useT } from '../../lib/i18n'
import { playSound } from '../../lib/tableSounds'
import { CardView } from './TableKit'
import { useTable } from './tableUtils'

/*
 * Janelas extras da mesa (Fase 2): grimório (buscar / olhar o topo), fichas do Scryfall,
 * carta revelada e dados.
 */

function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
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
        className="flex max-h-[85dvh] w-full max-w-4xl flex-col rounded-xl border border-line bg-ink"
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
  const q = filter.trim().toLowerCase()
  const shown = q ? cards.filter((c) => c.name.toLowerCase().includes(q)) : cards
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
            ? t('Leftmost is the top. Click a card to move it (to the bottom for scry).')
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
      <div className="flex flex-wrap gap-2 overflow-y-auto p-4">
        {shown.length === 0 && <p className="text-sm text-parchment/40">{t('Empty.')}</p>}
        {shown.map((c) => (
          <CardView key={c.id} card={c} zone="library" mine width={110} menuOnClick />
        ))}
      </div>
    </Modal>
  )
}

type ScryCard = { id: string; name: string; type_line: string; image_uris?: { normal: string; small: string } }
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

/** Busca de fichas no Scryfall: clique numa ficha para colocá-la no seu campo. */
export function TokenPicker({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { send } = useTable()
  const [query, setQuery] = useState('Treasure')
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
  return (
    <Modal title={t('Create a token')} onClose={onClose}>
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
      <div className="flex flex-wrap gap-2 overflow-y-auto p-4">
        {loading && <p className="text-sm text-parchment/50">{t('Loading…')}</p>}
        {!loading && cards.length === 0 && <p className="text-sm text-parchment/40">{t('No tokens found.')}</p>}
        {!loading &&
          cards.map((c) => (
            <button
              key={c.id}
              title={`${c.name} — ${c.type_line}`}
              onClick={() => {
                send({
                  type: 'token',
                  name: c.name,
                  image: c.image_uris!.normal,
                  x: 0.1 + Math.random() * 0.5,
                  y: 0.35,
                })
                onClose()
              }}
              className="w-[110px] overflow-hidden rounded-[6%] transition hover:ring-2 hover:ring-gold"
            >
              <img src={c.image_uris!.small} alt={c.name} loading="lazy" className="w-full" />
            </button>
          ))}
      </div>
    </Modal>
  )
}

/** Carta revelada: aparece para todos por alguns segundos (vem do log, então chega a todo mundo). */
export function RevealOverlay({ entry, onDone }: { entry: LogItem; onDone: () => void }) {
  const t = useT()
  useEffect(() => {
    const timer = setTimeout(onDone, 4500)
    return () => clearTimeout(timer)
  }, [entry, onDone])
  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-black/40">
      <div className="animate-[flip-in_0.35s_ease-out] text-center">
        <p className="mb-3 text-sm font-semibold text-parchment/80">{t('{who} revealed', { who: entry.who })}</p>
        {entry.image && (
          <img src={entry.image} alt={entry.card ?? ''} className="w-72 rounded-[4.5%] shadow-2xl shadow-black" />
        )}
      </div>
    </div>
  )
}

/** Dados e moeda: o resultado sai do servidor e aparece no log para todos. */
export function DiceButtons() {
  const t = useT()
  const { send } = useTable()
  const dice: [string, number][] = [
    [t('Coin'), 2],
    ['d6', 6],
    ['d20', 20],
  ]
  return (
    <div className="flex gap-1" role="group" aria-label={t('Dice')}>
      {dice.map(([label, sides]) => (
        <button
          key={sides}
          onClick={() => send({ type: 'roll', sides })}
          className="rounded-md border border-line px-2 py-1 text-xs transition hover:border-parchment/40 hover:bg-parchment/10"
        >
          {label}
        </button>
      ))}
    </div>
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
      else if (e.kind === 'draw') playSound('draw')
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
    ['E', t('Reveal to everyone')],
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
