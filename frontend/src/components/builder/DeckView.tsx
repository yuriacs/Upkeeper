import { ArrowLeftRight, Crown, Hand, Lightbulb, Minus, Plus, Shuffle, Trash2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { ManaCost } from '../Mana'
import { useI18n } from '../../lib/i18n'
import { money } from '../../lib/money'
import {
  canCommand,
  colorBalance,
  COLORS,
  GROUPS,
  groupOf,
  maxCopies,
  ROLES,
  roleOf,
  type BuilderCard,
  type BuilderDeck,
  type DeckEntry,
  type Group,
  type Role,
  type RoleMap,
} from '../../lib/deckbuilder'
import { roleLabel, typeGroupLabel, type T } from './labels'

export type GroupBy = 'role' | 'type' | 'cmc'
export type SortBy = 'name' | 'cmc' | 'price'
export type ViewAs = 'list' | 'stacks'

type Actions = {
  onQty: (id: string, delta: number) => void
  onCategory: (id: string, category: Role | undefined) => void
  onMaybe: (id: string) => void
  onCommander: (c: BuilderCard) => void
  onHover: (c: BuilderCard | null) => void
}

/** Grupos do deck (por função, tipo ou valor de mana), já ordenados */
function grouped(entries: DeckEntry[], by: GroupBy, sort: SortBy, roles: RoleMap, t: T) {
  const keyOf = (e: DeckEntry): string =>
    by === 'role'
      ? roleOf(e, roles)
      : by === 'type'
        ? groupOf(e.card)
        : groupOf(e.card) === 'land'
          ? 'land'
          : String(Math.min(7, Math.floor(e.card.cmc)))
  const order: string[] =
    by === 'role' ? [...ROLES] : by === 'type' ? [...GROUPS] : ['0', '1', '2', '3', '4', '5', '6', '7', 'land']
  const label = (k: string) =>
    by === 'role'
      ? roleLabel(t, k as Role)
      : by === 'type' || k === 'land'
        ? typeGroupLabel(t, k as Group)
        : k === '7'
          ? t('Mana value 7+')
          : t('Mana value {n}', { n: k })
  const cmp = (a: DeckEntry, b: DeckEntry) =>
    sort === 'price'
      ? (b.card.priceUsd ?? 0) - (a.card.priceUsd ?? 0)
      : sort === 'cmc'
        ? a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name)
        : a.card.name.localeCompare(b.card.name)
  return order
    .map((k) => ({ key: k, label: label(k), entries: entries.filter((e) => keyOf(e) === k).sort(cmp) }))
    .filter((g) => g.entries.length)
}

/**
 * O deck na área principal (como o Archidekt): grupos em colunas, em lista ou em pilhas de cartas,
 * com quantidade, categoria escolhida à mão, maybeboard e a coroa para virar comandante.
 */
export function DeckView({
  deck,
  roles,
  groupBy,
  sortBy,
  viewAs,
  filter,
  actions,
  onMaybeToDeck,
  onMaybeRemove,
}: {
  deck: BuilderDeck
  roles: RoleMap
  groupBy: GroupBy
  sortBy: SortBy
  viewAs: ViewAs
  filter: string
  actions: Actions
  onMaybeToDeck: (id: string) => void
  onMaybeRemove: (id: string) => void
}) {
  const { t } = useI18n()
  const q = filter.trim().toLowerCase()
  const match = (e: DeckEntry) => !q || e.card.name.toLowerCase().includes(q) || e.card.typeLine.toLowerCase().includes(q)
  const groups = grouped(deck.cards.filter(match), groupBy, sortBy, roles, t)
  const maybe = deck.maybe.filter(match)
  if (!deck.cards.length && !deck.maybe.length)
    return <p className="py-10 text-center text-sm text-parchment/50">{t('Your deck is empty. Search cards to add them.')}</p>
  return (
    <div className="@container space-y-6">
      {viewAs === 'list' ? (
        <div className="columns-1 gap-4 @2xl:columns-2 @6xl:columns-3">
          {groups.map((g) => (
            <section key={g.key} className="mb-4 break-inside-avoid">
              <GroupTitle label={g.label} entries={g.entries} />
              <ul className="divide-y divide-line/60 rounded-lg border border-line bg-surface/40">
                {g.entries.map((e) => (
                  <Row key={e.card.id} e={e} deck={deck} roles={roles} actions={actions} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-4">
          {groups.map((g) => (
            <section key={g.key} className="w-[9.5rem]">
              <GroupTitle label={g.label} entries={g.entries} />
              <div className="flex flex-col">
                {g.entries.map((e, i) => (
                  <StackCard key={e.card.id} e={e} first={i === 0} actions={actions} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {deck.maybe.length > 0 && (
        <section>
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-sky-300 uppercase">
            <Lightbulb className="h-3.5 w-3.5" aria-hidden />
            {t('Maybeboard ({n})', { n: deck.maybe.reduce((n, e) => n + e.qty, 0) })}
            <span className="font-normal tracking-normal text-parchment/40 normal-case">{t('not counted in the 100')}</span>
          </h3>
          <ul className="grid gap-x-4 rounded-lg border border-dashed border-sky-400/30 bg-surface/30 @2xl:grid-cols-2 @6xl:grid-cols-3">
            {maybe.map((e) => (
              <li
                key={e.card.id}
                onMouseEnter={() => actions.onHover(e.card)}
                onMouseLeave={() => actions.onHover(null)}
                className="flex items-center gap-2 px-2 py-1 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{e.card.name}</span>
                <ManaCost cost={e.card.manaCost.split(' // ')[0]} className="shrink-0 text-xs" />
                <IconBtn label={t('Move to the deck')} onClick={() => onMaybeToDeck(e.card.id)}>
                  <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
                </IconBtn>
                <IconBtn label={t('Remove {name}', { name: e.card.name })} onClick={() => onMaybeRemove(e.card.id)}>
                  <X className="h-3.5 w-3.5" aria-hidden />
                </IconBtn>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function GroupTitle({ label, entries }: { label: string; entries: DeckEntry[] }) {
  return (
    <h3 className="mb-1 text-xs font-semibold tracking-wide text-parchment/60 uppercase">
      {label} <span className="text-parchment/40">({entries.reduce((n, e) => n + e.qty, 0)})</span>
    </h3>
  )
}

/**
 * Uma carta na lista: quantidade, nome (com o máximo de espaço), custo e preço. Os botões (−/+,
 * categoria, coroa, maybeboard) aparecem por cima do custo ao passar o mouse ou tocar na linha.
 */
function Row({ e, deck, roles, actions }: { e: DeckEntry; deck: BuilderDeck; roles: RoleMap; actions: Actions }) {
  const { t, locale } = useI18n()
  const auto = roleOf({ ...e, category: undefined }, roles)
  return (
    <li
      tabIndex={0}
      onMouseEnter={() => actions.onHover(e.card)}
      onMouseLeave={() => actions.onHover(null)}
      className="group relative flex items-center gap-2 px-2 py-1 text-sm outline-none focus-visible:bg-gold/5"
    >
      <span className={`w-4 shrink-0 text-right tabular-nums ${e.qty > 1 ? 'font-semibold text-gold' : 'text-parchment/50'}`}>{e.qty}</span>
      <span className="min-w-0 flex-1 truncate" title={e.card.name}>
        {e.card.name}
      </span>
      <ManaCost cost={e.card.manaCost.split(' // ')[0]} className="shrink-0 text-xs" />
      <span className="w-12 shrink-0 text-right text-xs text-parchment/50 tabular-nums">
        {e.card.priceUsd != null ? money(e.card.priceUsd * e.qty, 'USD', locale) : '—'}
      </span>
      <div className="absolute inset-y-0 right-1 hidden items-center gap-0.5 bg-ink pl-2 shadow-[-12px_0_12px_-4px] shadow-ink group-focus-within:flex group-hover:flex">
        <select
          value={e.category ?? ''}
          onChange={(ev) => actions.onCategory(e.card.id, (ev.target.value || undefined) as Role | undefined)}
          aria-label={t('Category of {name}', { name: e.card.name })}
          title={t('Category (automatic: {role})', { role: roleLabel(t, auto) })}
          className={`h-6 max-w-[7.5rem] cursor-pointer rounded border border-line bg-ink px-1 text-xs ${e.category ? 'text-gold' : 'text-parchment/70'}`}
        >
          <option value="">{t('Automatic: {role}', { role: roleLabel(t, auto) })}</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(t, r)}
            </option>
          ))}
        </select>
        {canCommand(e.card) && deck.commanders.length < 2 && (
          <IconBtn label={t('Make {name} your commander', { name: e.card.name })} onClick={() => actions.onCommander(e.card)}>
            <Crown className="h-3.5 w-3.5" aria-hidden />
          </IconBtn>
        )}
        <IconBtn label={t('Move to the maybeboard')} onClick={() => actions.onMaybe(e.card.id)}>
          <Lightbulb className="h-3.5 w-3.5" aria-hidden />
        </IconBtn>
        <IconBtn label={t('Remove one')} onClick={() => actions.onQty(e.card.id, -1)} boxed>
          {e.qty > 1 ? <Minus className="h-3.5 w-3.5" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
        </IconBtn>
        <IconBtn label={t('Add one')} onClick={() => actions.onQty(e.card.id, 1)} disabled={e.qty >= maxCopies(e.card)} boxed>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </IconBtn>
      </div>
    </li>
  )
}

/** Uma carta na pilha (só o topo à mostra, como no Archidekt); ao passar o mouse, botões de −/+ */
function StackCard({ e, first, actions }: { e: DeckEntry; first: boolean; actions: Actions }) {
  const { t } = useI18n()
  return (
    <div
      onMouseEnter={() => actions.onHover(e.card)}
      onMouseLeave={() => actions.onHover(null)}
      className={`group relative transition hover:z-10 ${first ? '' : '-mt-[10.4rem]'}`}
    >
      <img src={e.card.small} alt={e.card.name} loading="lazy" className="aspect-[488/680] w-full rounded-[4.5%] bg-surface shadow-md shadow-black/60" />
      {e.qty > 1 && (
        <span className="absolute top-6 left-1 rounded-full bg-gold px-1.5 text-xs font-bold text-ink">×{e.qty}</span>
      )}
      <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
        <IconBtn label={t('Remove one')} onClick={() => actions.onQty(e.card.id, -1)} boxed solid>
          <Minus className="h-3.5 w-3.5" aria-hidden />
        </IconBtn>
        <IconBtn label={t('Add one')} onClick={() => actions.onQty(e.card.id, 1)} disabled={e.qty >= maxCopies(e.card)} boxed solid>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </IconBtn>
        <IconBtn label={t('Move to the maybeboard')} onClick={() => actions.onMaybe(e.card.id)} boxed solid>
          <Lightbulb className="h-3.5 w-3.5" aria-hidden />
        </IconBtn>
      </div>
    </div>
  )
}

function IconBtn({
  label,
  onClick,
  disabled,
  boxed,
  solid,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  /** Com borda (botões de quantidade) */
  boxed?: boolean
  /** Fundo escuro (por cima da imagem da carta) */
  solid?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-6 w-6 shrink-0 place-items-center rounded text-parchment/60 transition enabled:hover:text-gold disabled:opacity-30 ${
        boxed ? 'border border-line enabled:hover:border-gold' : ''
      } ${solid ? 'bg-ink/90' : ''}`}
    >
      {children}
    </button>
  )
}

/** Cores: símbolos de mana que as mágicas pedem × cartas que geram cada cor */
export function ColorBalance({ deck }: { deck: BuilderDeck }) {
  const { t } = useI18n()
  const data = colorBalance(deck)
  const shown = COLORS.filter((c) => data[c].pips || data[c].sources)
  if (!shown.length) return null
  const pips = shown.reduce((n, c) => n + data[c].pips, 0) || 1
  return (
    <section className="space-y-1.5 rounded-lg border border-line bg-surface/60 p-3">
      <h2 className="text-xs font-semibold tracking-wide text-parchment/60 uppercase">{t('Mana: cost × sources')}</h2>
      {shown.map((c) => (
        <div key={c} className="grid grid-cols-[1.25rem_minmax(0,1fr)_5.5rem] items-center gap-2 text-xs">
          <i className={`ms ms-${c.toLowerCase()} ms-cost ms-shadow`} aria-hidden />
          <div className="h-1.5 rounded-full bg-parchment/10">
            <div className="h-full rounded-full bg-gold/70" style={{ width: `${(data[c].pips / pips) * 100}%` }} />
          </div>
          <span className="text-right text-parchment/60 tabular-nums" title={t('{p} symbols in costs · {s} cards that make this color', { p: data[c].pips, s: data[c].sources })}>
            {Math.round((data[c].pips / pips) * 100)}% · {t('{n} sources', { n: data[c].sources })}
          </span>
        </div>
      ))}
    </section>
  )
}

/** Mão de teste: embaralha o deck (sem os comandantes), compra 7 e deixa comprar mais */
export function Playtest({ deck, onClose }: { deck: BuilderDeck; onClose: () => void }) {
  const { t } = useI18n()
  const shuffle = () => {
    const pile = deck.cards.flatMap((e) => Array.from({ length: e.qty }, () => e.card))
    for (let i = pile.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pile[i], pile[j]] = [pile[j], pile[i]]
    }
    return pile
  }
  const [pile, setPile] = useState(shuffle)
  const [drawn, setDrawn] = useState(7)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const hand = pile.slice(0, drawn)
  const lands = hand.filter((c) => groupOf(c) === 'land').length
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('Sample hand')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-5xl flex-col rounded-xl border border-line bg-ink"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-2xl">{t('Sample hand')}</h2>
          <span className="text-sm text-parchment/60">
            {t('{n} cards · {l} lands · {left} left in the library', { n: hand.length, l: lands, left: pile.length - hand.length })}
          </span>
          <button onClick={onClose} className="ml-auto rounded-md px-2 py-1 text-parchment/60 hover:text-gold" aria-label={t('Close')}>
            ✕
          </button>
        </div>
        <div className="flex flex-wrap justify-center gap-2 overflow-y-auto p-4">
          {hand.length === 0 && <p className="text-sm text-parchment/50">{t('Add cards to the deck first.')}</p>}
          {hand.map((c, i) => (
            <img key={i} src={c.image || c.small} alt={c.name} className="w-40 rounded-[4.5%]" />
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
          <button
            onClick={() => {
              setPile(shuffle())
              setDrawn(7)
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40"
          >
            <Shuffle className="h-4 w-4" aria-hidden />
            {t('New hand')}
          </button>
          <button
            onClick={() => setDrawn((n) => Math.min(pile.length, n + 1))}
            disabled={drawn >= pile.length}
            className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-40"
          >
            <Hand className="h-4 w-4" aria-hidden />
            {t('Draw a card')}
          </button>
        </div>
      </div>
    </div>
  )
}
