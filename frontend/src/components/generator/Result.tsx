/* Deck pronto: o recibo (preço por tipo), as cotas, o que o deck faz, o guia de jogo (IA) e a lista */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Hammer, LoaderCircle, Pencil, Save, TriangleAlert } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { BRACKET_NAMES } from '../../lib/brackets'
import { setBuilderHover } from '../../lib/builderHover'
import {
  deckCount,
  groupOf,
  GROUPS,
  loadDraft,
  roleOf,
  ROLES,
  saveDraft,
  toDecklist,
  type BuilderCard,
  type DeckEntry,
} from '../../lib/deckbuilder'
import { identityOf, isLand, type GenResult, type QuotaKey } from '../../lib/generator'
import { useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { money } from '../../lib/money'
import { BracketBadge } from '../Bracket'
import { ColorIdentity, ManaCost } from '../Mana'
import { roleLabel, typeGroupLabel } from '../builder/labels'
import { NoteText } from './ui'

type T = (s: string, v?: Record<string, string | number>) => string

const quotaLabel = (t: T, k: QuotaKey) =>
  ({ ramp: t('Ramp'), draw: t('Card draw'), removal: t('Removal'), board_wipe: t('Board wipes'), land: t('Lands') })[k]

const box = 'space-y-3 rounded-xl border border-line bg-surface/60 p-4'
const heading = 'text-xs font-semibold tracking-[0.15em] text-parchment/60 uppercase'

/** Mensagem dos erros da IA (o servidor manda um código; o texto é daqui) */
function aiError(t: T, err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return t('You used all of today’s AI requests. Try again tomorrow.')
    if (err.status === 503) return t('The AI is off on the site right now.')
    if (err.status === 502) return t('The AI did not answer. Try again in a moment.')
    return err.message
  }
  return t('The AI did not answer. Try again in a moment.')
}

export function Result({
  result,
  ai,
  aiLeft,
  onUpdate,
  onEdit,
}: {
  result: GenResult
  ai: boolean
  aiLeft: number
  onUpdate: (r: GenResult) => void
  onEdit: () => void
}) {
  const { t, locale } = useI18n()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { deck, answers } = result
  const commanderNames = deck.commanders.map((c) => c.name.split(' // ')[0]).join(' + ')
  const budget = answers.owned ? null : answers.budget

  const save = useMutation({
    mutationFn: () => api.saveMyDeck({ name: deck.name.trim(), decklist: toDecklist(deck), commanders: deck.commanders.map((c) => c.name) }),
    onSuccess: (res) => {
      api.generatorStats({ event: 'saved' }).catch(() => undefined) // registro de uso do painel do admin
      queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate(`/user-deck/${res.slug}`, { state: { warnings: res.warnings } })
    },
  })
  const openInBuilder = () => {
    const draft = loadDraft()
    if (
      draft &&
      (draft.cards.length || draft.commanders.length) &&
      !window.confirm(t('The deckbuilder has a deck you were building and did not save. Replace it with this one?'))
    )
      return
    saveDraft(deck)
    navigate('/my-pool/build')
  }
  const guide = useMutation({
    mutationFn: () =>
      api.generatorGuide({
        commanders: deck.commanders.map((c) => c.name),
        themes: result.themes.map((th) => th.name),
        bracket: answers.bracket,
        cards: deck.cards
          .filter((e) => !/\bBasic\b/.test(e.card.typeLine))
          .map((e) => ({ name: e.card.name, role: roleOf(e, result.roles) })),
      }),
    onSuccess: (g) => onUpdate({ ...result, guide: g }),
  })

  const byType = useMemo(() => {
    const sums = new Map<string, number>([['commander', deck.commanders.reduce((n, c) => n + (c.priceUsd ?? 0), 0)]])
    for (const e of deck.cards) sums.set(groupOf(e.card), (sums.get(groupOf(e.card)) ?? 0) + (e.card.priceUsd ?? 0) * e.qty)
    return [...sums].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  }, [deck])
  const maxType = Math.max(0.01, ...byType.map(([, v]) => v))
  const allMet = result.quotas.every((q) => q.have >= q.target)
  const byName = useMemo(() => new Map(deck.cards.map((e) => [e.card.name, e.card])), [deck.cards])
  const keyCards = result.keyCards.map((n) => byName.get(n)).filter((c): c is BuilderCard => !!c)
  const missingPrice = result.missing.reduce((n, name) => n + (byName.get(name)?.priceUsd ?? 0), 0)

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-2xl border border-line bg-surface/60 p-5 sm:p-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-emerald-300 uppercase">{t('Your deck is ready')}</p>
        <h2 className="font-display text-4xl text-parchment">{deck.name}</h2>
        <p className="max-w-3xl text-sm text-parchment/70">
          {result.guide?.summary ||
            (result.sampleDecks
              ? t('{n} cards built around {name}, from what {decks} decks with it play on EDHREC.', {
                  n: deckCount(deck),
                  name: commanderNames,
                  decks: result.sampleDecks.toLocaleString(locale),
                })
              : t('{n} cards built around {name}.', { n: deckCount(deck), name: commanderNames }))}
        </p>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <Stat label={t('Cards')}>
            <span className={deckCount(deck) === 100 ? 'text-emerald-300' : 'text-amber-200'}>{deckCount(deck)}/100</span>
          </Stat>
          <Stat label={t('Power')}>
            {result.bracket ? (
              <span className="flex items-center gap-2 text-base">
                <BracketBadge bracket={result.bracket} />
                {BRACKET_NAMES[result.bracket]}
              </span>
            ) : (
              <span className="text-base text-parchment/50">{t('Not checked')}</span>
            )}
          </Stat>
          <Stat label={t('Colors')}>
            <ColorIdentity colors={identityOf(deck.commanders).join('')} />
          </Stat>
          <Stat label={t('Value')}>
            <span className="text-emerald-300">{money(result.price, 'USD', locale)}</span>
          </Stat>
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-sm text-parchment/80 transition hover:border-parchment/40"
            >
              <Pencil className="h-4 w-4" aria-hidden />
              {t('Change answers')}
            </button>
            <button
              type="button"
              onClick={openInBuilder}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-sm text-parchment/80 transition hover:border-parchment/40"
            >
              <Hammer className="h-4 w-4" aria-hidden />
              {t('Open in the deckbuilder')}
            </button>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || save.isSuccess}
              className="font-display inline-flex items-center gap-1.5 rounded-md btn-ember px-5 py-2 text-lg tracking-wide text-ink transition hover:brightness-110 disabled:opacity-50"
            >
              <Save className="h-4 w-4" aria-hidden />
              {save.isPending ? t('Saving…') : t('Save deck')}
            </button>
          </div>
        </div>
        {save.error && <p className="text-sm text-red-300">{save.error.message}</p>}
        {/* Só para o admin: quanto esta geração custou (as médias ficam no painel do admin) */}
        {user?.is_admin && result.cost && (
          <p className="text-xs text-parchment/40">
            {t('Admin: built in {seconds} s · {scryfall} Scryfall searches and {edhrec} EDHREC pages from the browser · {server} requests to our server', {
              seconds: (result.cost.ms / 1000).toLocaleString(locale, { maximumFractionDigits: 1 }),
              scryfall: result.cost.scryfall,
              edhrec: result.cost.edhrec,
              server: result.cost.server,
            })}
          </p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className={box}>
            <h3 className={heading}>{t('The receipt')}</h3>
            <p className="font-display text-4xl text-parchment tabular-nums">{money(result.price, 'USD', locale)}</p>
            {budget !== null ? (
              <p
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  result.price <= budget ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-200'
                }`}
              >
                {result.price <= budget ? t('Within the budget of {budget}', { budget: money(budget, 'USD', locale, true)! }) : t('Over the budget of {budget}', { budget: money(budget, 'USD', locale, true)! })}
              </p>
            ) : (
              <p className="text-xs text-parchment/50">{answers.owned ? t('Value of the cards, most of them already yours.') : t('No budget limit.')}</p>
            )}
            <p className="text-xs text-parchment/45">{t('Cheapest printing of each card on Scryfall.')}</p>
            <ul className="space-y-1.5 pt-1">
              {byType.map(([g, v]) => (
                <li key={g} className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs">
                  <span className="truncate text-parchment/70">{g === 'commander' ? t('Commander') : typeGroupLabel(t, g as (typeof GROUPS)[number])}</span>
                  <span className="h-1.5 rounded-full bg-ink">
                    <span className="block h-full rounded-full bg-gold/70" style={{ width: `${(v / maxType) * 100}%` }} />
                  </span>
                  <span className="text-right text-parchment/60 tabular-nums">{money(v, 'USD', locale)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className={box}>
            <div className="flex items-center justify-between">
              <h3 className={heading}>{t('Quotas')}</h3>
              {allMet && <span className="text-xs font-semibold tracking-wide text-emerald-300 uppercase">{t('All met')}</span>}
            </div>
            <ul className="space-y-2">
              {result.quotas.map((q) => (
                <li
                  key={q.key}
                  className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs"
                  title={q.key === 'removal' ? t('Spot removal and counterspells') : undefined}
                >
                  <span className="text-parchment/70">{quotaLabel(t, q.key)}</span>
                  <span className="h-1.5 rounded-full bg-ink">
                    <span
                      className={`block h-full rounded-full ${q.have >= q.target ? 'bg-emerald-400/80' : 'bg-amber-400/80'}`}
                      style={{ width: `${Math.min(100, (q.have / Math.max(1, q.target)) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right text-parchment/60 tabular-nums">
                    {q.have} / {q.target}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-parchment/40">{t('The functions come from the Scryfall card tags, like on the deck page.')}</p>
          </section>

          {result.notes.length > 0 && (
            <section className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-amber-200 uppercase">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                {t('Worth knowing')}
              </h3>
              <ul className="space-y-1.5 text-xs text-amber-100/90">
                {result.notes.map((n, i) => (
                  <li key={i}>
                    • <NoteText note={n} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.missing.length > 0 && (
            <section className={box}>
              <h3 className={heading}>{t('Cards you don’t own yet ({n})', { n: result.missing.length })}</h3>
              <p className="text-xs text-parchment/50">
                {t('Your cards were not enough for every slot. These complete the deck: about {price}.', { price: money(missingPrice, 'USD', locale)! })}
              </p>
              <ul className="space-y-0.5 text-sm">
                {result.missing.map((n) => (
                  <CardRow key={n} card={byName.get(n)} name={n} />
                ))}
              </ul>
            </section>
          )}
        </aside>

        <div className="min-w-0 space-y-4">
          <section className={box}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-2xl text-parchment">{t('What it was built to do')}</h3>
              <Link to="/my-pool/generate/how-it-works" className="text-xs text-parchment/50 underline-offset-4 hover:text-gold hover:underline">
                {t('How was this deck built?')}
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-parchment/50">{t('Themes')}:</span>
              {result.themes.length ? (
                result.themes.map((th) => (
                  <span key={th.slug} className="rounded-full bg-gold/15 px-2.5 py-0.5 text-xs font-semibold text-gold">
                    {th.name}
                  </span>
                ))
              ) : (
                <span className="text-xs text-parchment/60">{t('No theme: the best cards for the commander')}</span>
              )}
            </div>
            {keyCards.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-parchment/50">{t('The cards that define it')}</p>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {keyCards.map((c) => (
                    <li key={c.id} onMouseEnter={() => setBuilderHover(c)} onMouseLeave={() => setBuilderHover(null)}>
                      <img src={c.small || c.image} alt={c.name} title={c.name} loading="lazy" className="aspect-[488/680] w-full rounded-[4.5%] bg-surface" />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.guide ? (
              <PlayGuideView result={result} />
            ) : ai ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-ink/40 p-3">
                <p className="min-w-60 flex-1 text-sm text-parchment/70">
                  {t('A short guide: the opening turns, the game plan and what to watch out for.')}
                </p>
                <button
                  type="button"
                  onClick={() => guide.mutate()}
                  disabled={guide.isPending || aiLeft <= 0}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gold/60 px-3 py-2 text-sm font-semibold text-gold transition hover:bg-gold/10 disabled:opacity-40"
                >
                  {guide.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <BookOpen className="h-4 w-4" aria-hidden />}
                  {guide.isPending ? t('Writing…') : t('Write the play guide')}
                </button>
                <p className="w-full text-xs text-parchment/40">{t('Uses the AI ({n} uses left today). Only the card list goes.', { n: aiLeft })}</p>
                {guide.error && <p className="w-full text-xs text-amber-200">{aiError(t, guide.error)}</p>}
              </div>
            ) : null}
          </section>

          <DeckList result={result} />

          {deck.maybe.length > 0 && (
            <section className={box}>
              <h3 className={heading}>{t('Also considered')}</h3>
              <p className="text-xs text-parchment/45">{t('The next cards in line. They go to the maybeboard when you open the deck in the deckbuilder.')}</p>
              <ul className="flex flex-wrap gap-1.5">
                {deck.maybe.map((e) => (
                  <li
                    key={e.card.id}
                    onMouseEnter={() => setBuilderHover(e.card)}
                    onMouseLeave={() => setBuilderHover(null)}
                    className="rounded-full border border-line px-2.5 py-0.5 text-xs text-parchment/70"
                  >
                    {e.card.name}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[0.65rem] font-semibold tracking-[0.15em] text-parchment/45 uppercase">{label}</p>
      <div className="font-display text-2xl text-parchment tabular-nums">{children}</div>
    </div>
  )
}

function CardRow({ card, name, qty }: { card?: BuilderCard; name: string; qty?: number }) {
  const { locale } = useI18n()
  return (
    <li
      className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-parchment/5"
      onMouseEnter={() => card && setBuilderHover(card)}
      onMouseLeave={() => setBuilderHover(null)}
    >
      {qty !== undefined && <span className="w-5 text-right text-xs text-parchment/45 tabular-nums">{qty}</span>}
      <span className="min-w-0 flex-1 truncate text-parchment/85">{name}</span>
      {card && <ManaCost cost={card.manaCost} />}
      {qty === undefined && card?.priceUsd != null && (
        <span className="text-xs text-emerald-300/80 tabular-nums">{money(card.priceUsd, 'USD', locale)}</span>
      )}
    </li>
  )
}

function DeckList({ result }: { result: GenResult }) {
  const { t } = useI18n()
  const [by, setBy] = useState<'type' | 'role'>('type')
  const { deck } = result
  const groups = useMemo(() => {
    const map = new Map<string, DeckEntry[]>()
    for (const e of deck.cards) {
      const k = by === 'type' ? groupOf(e.card) : isLand(e.card) ? 'land' : roleOf(e, result.roles)
      map.set(k, [...(map.get(k) ?? []), e])
    }
    const order: readonly string[] = by === 'type' ? GROUPS : ROLES
    return [...map]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([k, list]) => [k, list.sort((x, y) => x.card.cmc - y.card.cmc || x.card.name.localeCompare(y.card.name))] as const)
  }, [deck.cards, by, result.roles])
  const label = (k: string) => (by === 'type' ? typeGroupLabel(t, k as (typeof GROUPS)[number]) : roleLabel(t, k as (typeof ROLES)[number]))
  const toggle = (on: boolean) => `px-2.5 py-1 text-xs font-semibold transition ${on ? 'bg-gold/15 text-gold' : 'text-parchment/60 hover:text-parchment'}`
  return (
    <section className={box}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-2xl text-parchment">{by === 'type' ? t('The deck, by type') : t('The deck, by function')}</h3>
        <div role="group" className="flex overflow-hidden rounded-lg border border-line">
          <button type="button" onClick={() => setBy('type')} aria-pressed={by === 'type'} className={toggle(by === 'type')}>
            {t('By type')}
          </button>
          <button type="button" onClick={() => setBy('role')} aria-pressed={by === 'role'} className={toggle(by === 'role')}>
            {t('By function')}
          </button>
        </div>
      </div>
      <div className="gap-6 md:columns-2">
        <div className="mb-4 break-inside-avoid">
          <p className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-wide text-gold uppercase">
            {t('Commander')} <span className="text-parchment/40">{deck.commanders.length}</span>
          </p>
          <ul>
            {deck.commanders.map((c) => (
              <CardRow key={c.id} card={c} name={c.name} qty={1} />
            ))}
          </ul>
        </div>
        {groups.map(([k, list]) => (
          <div key={k} className="mb-4 break-inside-avoid">
            <p className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-wide text-gold uppercase">
              {label(k)} <span className="text-parchment/40">{list.reduce((n, e) => n + e.qty, 0)}</span>
            </p>
            <ul>
              {list.map((e) => (
                <CardRow key={e.card.id} card={e.card} name={e.card.name} qty={e.qty} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

function PlayGuideView({ result }: { result: GenResult }) {
  const { t } = useI18n()
  const g = result.guide!
  const part = (title: string, text: string) =>
    text ? (
      <div className="space-y-1">
        <p className="text-xs font-semibold tracking-wide text-gold uppercase">{title}</p>
        <p className="text-sm leading-relaxed text-parchment/80">{text}</p>
      </div>
    ) : null
  return (
    <div className="space-y-3 rounded-lg border border-line bg-ink/40 p-4">
      <p className="flex items-center gap-1.5 font-semibold text-parchment">
        <BookOpen className="h-4 w-4 text-gold" aria-hidden />
        {t('Play guide')}
      </p>
      {g.win_cards.length > 0 && (
        <p className="text-sm text-parchment/70">
          <span className="text-xs font-semibold tracking-wide text-gold uppercase">{t('How it wins')}:</span> {g.win_cards.join(' · ')}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {part(t('Early game'), g.early)}
        {part(t('Middle game'), g.middle)}
        {part(t('Late game'), g.late)}
      </div>
      {part(t('Watch out for'), g.watch_out)}
      {part(t('Mulligan'), g.mulligan)}
      <p className="text-xs text-parchment/40">{t('Written by AI from the card list: check the card text when in doubt.')}</p>
    </div>
  )
}
