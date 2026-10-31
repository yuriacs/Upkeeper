/* Os passos do gerador de decks: caminho, frase, cores, comandante, temas, orçamento, bracket, detalhes e revisão */
import { useQuery } from '@tanstack/react-query'
import { Check, Compass, Crown, Layers, LoaderCircle, MessageSquareText, Search, Shuffle, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDebounce } from '../../hooks/useDebounce'
import { api } from '../../lib/api'
import { BRACKET_NAMES } from '../../lib/brackets'
import { setBuilderHover } from '../../lib/builderHover'
import { COLOR_NAMES } from '../../lib/colors'
import { canCommand, canPair, COLORS, fromApiCard, NO_PHYREXIAN, searchCards, type BuilderCard } from '../../lib/deckbuilder'
import { fetchAllThemes } from '../../lib/edhrec'
import {
  BUDGETS,
  commandersByName,
  identityOf,
  mainPage,
  MAX_THEMES,
  sameColors,
  suggestCommanders,
  type Answers,
  type Lane,
  type StepKey,
  type Theme,
} from '../../lib/generator'
import { useI18n } from '../../lib/i18n'
import { money } from '../../lib/money'
import { ColorIdentity } from '../Mana'
import { CardPicker } from './CardPicker'
import { chipClass, colorComboName, laneLabel, type T } from './labels'
import { Choice, StepHeader } from './ui'

export type StepProps = { answers: Answers; set: (patch: Partial<Answers>) => void }

const step = (t: T, n: number, name: string) => t('Step {n} · {name}', { n: String(n).padStart(2, '0'), name })

// ---- 1. Caminho ----------------------------------------------------------------------------------

export function StartStep({ lane, ai, onPick }: { lane: Lane | null; ai: boolean; onPick: (l: Lane) => void }) {
  const { t } = useI18n()
  const lanes: { key: Lane; icon: typeof Compass; text: string; meta: string; badge?: string }[] = [
    {
      key: 'describe',
      icon: MessageSquareText,
      text: t('Tell us in a sentence what you want and we turn it into a deck.'),
      meta: t('1 question'),
      badge: ai ? t('With AI') : undefined,
    },
    { key: 'guide', icon: Compass, text: t('A few quick questions: colors, themes and budget. No Magic jargon needed.'), meta: t('6 questions · about 2 min') },
    { key: 'commander', icon: Crown, text: t('Start from the legend you already want to build around.'), meta: t('5 questions · the colors come from the commander') },
    { key: 'collection', icon: Layers, text: t('The same questions, but only with the cards from the precons and decks in your pool.'), meta: t('4 questions · only cards you own') },
  ]
  return (
    <div className="space-y-6">
      <StepHeader kicker={step(t, 1, t('Start'))} title={t('How do you want to build?')}>
        {t('Four ways in. Every answer stays editable: nothing here is final.')}
      </StepHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        {lanes.map(({ key, icon: Icon, text, meta, badge }) => (
          <Choice key={key} on={lane === key} onClick={() => onPick(key)} className="flex min-h-36 flex-col gap-2">
            <span className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-ink text-gold">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="font-semibold text-parchment">{laneLabel(t, key)}</span>
              {badge && <span className="ml-auto rounded-full bg-gold/15 px-2 py-0.5 text-[0.65rem] font-bold tracking-wide text-gold uppercase">{badge}</span>}
            </span>
            <span className="text-sm text-parchment/60">{text}</span>
            <span className="mt-auto text-xs text-parchment/40">{meta}</span>
          </Choice>
        ))}
      </div>
    </div>
  )
}

// ---- Descreva seu deck -----------------------------------------------------------------------------

export function DescribeStep({
  answers,
  set,
  ai,
  aiLeft,
  busy,
  error,
  onRead,
}: StepProps & { ai: boolean; aiLeft: number; busy: boolean; error: string | null; onRead: () => void }) {
  const { t } = useI18n()
  const examples = [
    t('A cheap Rakdos dragon deck that attacks a lot'),
    t('Elves in green and black for a casual table'),
    t('Atraxa with +1/+1 counters, around $200'),
    t('Blue and red spells that copy each other, no infinite combos'),
  ]
  const text = answers.description
  return (
    <div className="space-y-6">
      <StepHeader kicker={step(t, 2, t('Description'))} title={t('Describe your deck')}>
        {t('Colors, a commander, a creature type, a play style, a budget: say it your way.')}
      </StepHeader>
      <textarea
        value={text}
        onChange={(e) => set({ description: e.target.value.slice(0, 600) })}
        rows={4}
        autoFocus
        placeholder={t('For example: a zombie deck in black that sacrifices creatures, without spending much')}
        aria-label={t('Describe your deck')}
        className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-parchment focus:border-gold focus:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button key={ex} type="button" onClick={() => set({ description: ex })} className={chipClass(false)}>
            {ex}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRead}
          disabled={busy || text.trim().length < 3}
          className="font-display inline-flex items-center gap-2 rounded-md btn-ember px-5 py-2 text-lg tracking-wide text-ink transition hover:brightness-110 disabled:opacity-40"
        >
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
          {busy ? t('Reading…') : t('Turn it into a deck')}
        </button>
        <span className="text-xs text-parchment/45">
          {ai
            ? t('The AI reads the sentence ({n} uses left today). Only the text goes, nothing from your account.', { n: aiLeft })
            : t('We pick out the colors, themes, budget and power level from the sentence.')}
        </span>
      </div>
      {error && <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-200">{error}</p>}
    </div>
  )
}

// ---- Cores ("Me guie") -----------------------------------------------------------------------------

export function ColorsStep({ answers, set }: StepProps) {
  const { t } = useI18n()
  const colors = answers.colors
  // O comandante já escolhido sai se deixar de ter exatamente as cores ("Qualquer cor" aceita todos)
  const choose = (next: string[] | null) =>
    set({
      colors: next,
      ...(next !== null && answers.commanders.length && !sameColors(identityOf(answers.commanders), next) ? { commanders: [] } : {}),
    })
  const toggle = (c: string) => {
    const now = colors ?? []
    choose(now.includes(c) ? now.filter((x) => x !== c) : COLORS.filter((x) => x === c || now.includes(x)))
  }
  const combo = colors ? colorComboName(colors) : ''
  return (
    <div className="space-y-6">
      <StepHeader kicker={step(t, 2, t('Colors'))} title={t('Which colors do you like?')}>
        {t('Pick one or more: the commanders in the next step will have exactly these colors. Or leave it open.')}
      </StepHeader>
      <div className="flex flex-wrap gap-3">
        {COLORS.map((c) => {
          const on = !!colors?.includes(c)
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggle(c)}
              aria-pressed={on}
              className={`flex w-24 flex-col items-center gap-2 rounded-xl border px-3 py-4 transition ${
                on ? 'border-gold bg-gold/10' : 'border-line bg-surface/60 opacity-70 hover:opacity-100'
              }`}
            >
              <i className={`ms ms-${c.toLowerCase()} ms-cost ms-shadow text-3xl`} aria-hidden />
              <span className="text-sm text-parchment/80">{t(COLOR_NAMES[c])}</span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => choose(null)} aria-pressed={colors === null} className={chipClass(colors === null)}>
          {t('Any colors')}
        </button>
        <button type="button" onClick={() => choose([])} aria-pressed={colors?.length === 0} className={chipClass(colors?.length === 0)}>
          {t('Colorless')}
        </button>
        {combo && <span className="text-sm text-parchment/50">{combo}</span>}
      </div>
    </div>
  )
}

// ---- Comandante --------------------------------------------------------------------------------------

/** Pode ter um segundo comandante (Partner, Background, Friends forever, Doctor) */
const pairable = (c: BuilderCard) =>
  /\bPartner\b|Choose a Background|Friends forever|Doctor's companion/.test(c.oracle) || /Background|Time Lord Doctor/.test(c.typeLine)

function CardPick({ card, on, onPick, extra }: { card: BuilderCard; on: boolean; onPick: () => void; extra?: string }) {
  const { locale } = useI18n()
  return (
    <li className="relative" onMouseEnter={() => setBuilderHover(card)} onMouseLeave={() => setBuilderHover(null)}>
      <button
        type="button"
        onClick={onPick}
        aria-pressed={on}
        title={card.name}
        className={`block w-full overflow-hidden rounded-[4.5%] transition ${on ? 'ring-2 ring-gold' : 'hover:ring-2 hover:ring-gold/60'}`}
      >
        <img src={card.small || card.image} alt={card.name} loading="lazy" className="aspect-[488/680] w-full bg-surface" />
      </button>
      {on && (
        <span className="pointer-events-none absolute top-1 left-1 grid h-6 w-6 place-items-center rounded-full bg-gold text-ink">
          <Check className="h-4 w-4" aria-hidden />
        </span>
      )}
      <span className="pointer-events-none absolute right-1 bottom-1 rounded-full bg-ink/90 px-1.5 text-[0.7rem] font-semibold text-emerald-300 tabular-nums ring-1 ring-line">
        {extra ?? (card.priceUsd != null ? money(card.priceUsd, 'USD', locale) : '—')}
      </span>
      {/* Identidade de cor (conta o texto da carta: a Toxrill custa só preto, mas o {U} da habilidade a faz azul e preta) */}
      <span className="absolute bottom-1 left-1 rounded-full bg-ink/90 px-1 py-px text-[0.6rem] ring-1 ring-line">
        <ColorIdentity colors={identityOf([card]).join('')} />
      </span>
    </li>
  )
}

export function CommanderStep({ answers, set, index }: StepProps & { index: number }) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const q = useDebounce(text.trim(), 400)
  const lane = answers.lane
  // Cores escolhidas no "Me guie" ou lidas na frase: orientam as sugestões. No "Me guie" o comandante tem de
  // ter exatamente essas cores (busca e sugestões); a frase pode ter sido lida errado, então ali a busca é livre
  const colors = lane === 'guide' || lane === 'describe' ? answers.colors : null
  const strict = lane === 'guide' ? answers.colors : null
  const fits = (c: BuilderCard) => strict === null || sameColors(c.identity, strict)
  const idFilter = strict === null ? '' : ` id=${strict.join('').toLowerCase() || 'c'}`
  const words = q
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, ''))
    .filter(Boolean)
  const search = useQuery({
    queryKey: ['gen-commander-search', q, idFilter],
    queryFn: ({ signal }) =>
      searchCards(`is:commander legal:commander game:paper ${words.map((w) => `name:${w}`).join(' ')}${idFilter} prefer:usd-low ${NO_PHYREXIAN}`, signal),
    enabled: q.length >= 2 && words.length > 0,
    staleTime: 60_000,
  })
  const suggested = useQuery({
    queryKey: ['gen-commander-suggest', lane, colors, strict, answers.themes.map((th) => th.slug), answers.suggestions],
    queryFn: async ({ signal }) => {
      const fromEdhrec = lane === 'collection' ? [] : (await suggestCommanders({ colors, themes: answers.themes }, signal)).map((c) => c.name)
      return (await commandersByName([...answers.suggestions, ...fromEdhrec].slice(0, 24), signal)).filter(fits).slice(0, 18)
    },
    staleTime: 3_600_000,
  })
  // Com as suas cartas: os comandantes que você já tem
  const mine = useQuery({
    queryKey: ['gen-owned-commanders'],
    queryFn: async () => (await api.myCardPool('WUBRG')).cards.map(fromApiCard).filter(canCommand),
    enabled: lane === 'collection',
    staleTime: 300_000,
  })

  const chosen = answers.commanders
  const pick = (c: BuilderCard) => {
    if (chosen.some((x) => x.name === c.name)) return set({ commanders: chosen.filter((x) => x.name !== c.name) })
    if (chosen.length === 1 && canPair(chosen[0], c)) return set({ commanders: [chosen[0], c] })
    set({ commanders: [c] })
  }
  const isOn = (c: BuilderCard) => chosen.some((x) => x.name === c.name)
  const grid = 'grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2'
  const titleFor =
    lane === 'collection' ? t('Commanders you own') : answers.suggestions.length ? t('Suggested from your description') : answers.themes.length || colors !== null ? t('Most played for your choices') : t('Most played lately')

  return (
    <div className="space-y-6">
      <StepHeader kicker={step(t, index, t('Commander'))} title={t('Who leads the deck?')}>
        {t('Search by name or pick a suggestion. Commanders with Partner or a Background can have a second one.')}
      </StepHeader>

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chosen.map((c) => (
            <span
              key={c.id}
              onMouseEnter={() => setBuilderHover(c)}
              onMouseLeave={() => setBuilderHover(null)}
              className="inline-flex items-center gap-2 rounded-full border border-gold/60 bg-gold/10 py-1 pr-1 pl-3 text-sm text-parchment"
            >
              <Crown className="h-3.5 w-3.5 text-gold" aria-hidden />
              {c.name}
              <button
                type="button"
                onClick={() => pick(c)}
                aria-label={t('Remove {name}', { name: c.name })}
                className="grid h-6 w-6 place-items-center rounded-full text-parchment/60 hover:text-red-300"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          ))}
          <ColorIdentity colors={identityOf(chosen).join('')} />
          {chosen.length === 1 && pairable(chosen[0]) && (
            <span className="text-xs text-parchment/50">{t('This one can have a partner: pick a second commander that pairs with it.')}</span>
          )}
        </div>
      )}

      {strict !== null && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-parchment/50">
          {t('Only commanders with exactly these colors:')}
          <ColorIdentity colors={strict.join('')} />
        </p>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-parchment/40" aria-hidden />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('Search commanders (e.g. Atraxa)')}
          aria-label={t('Search commanders')}
          className="w-full rounded-lg border border-line bg-surface py-2.5 pr-3 pl-9 focus:border-gold focus:outline-none"
        />
      </div>
      {q.length >= 2 && (
        <section className="space-y-2">
          {search.isPending && <p className="text-sm text-parchment/50">{t('Loading…')}</p>}
          {search.data && search.data.cards.length === 0 && <p className="text-sm text-parchment/50">{t('No commanders found.')}</p>}
          <ul className={grid}>
            {search.data?.cards
              .filter(fits)
              .slice(0, 24)
              .map((c) => <CardPick key={c.id} card={c} on={isOn(c)} onPick={() => pick(c)} />)}
          </ul>
        </section>
      )}

      {lane === 'collection' && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-gold uppercase">{titleFor}</h3>
          {mine.isPending && <p className="text-sm text-parchment/50">{t('Loading…')}</p>}
          {mine.data?.length === 0 && (
            <p className="text-sm text-parchment/50">{t('No commanders among your cards yet. Search for any commander above.')}</p>
          )}
          <ul className={grid}>
            {mine.data?.map((c) => <CardPick key={c.id} card={c} on={isOn(c)} onPick={() => pick(c)} />)}
          </ul>
        </section>
      )}
      {lane !== 'collection' && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-gold uppercase">{titleFor}</h3>
          {suggested.isPending && <p className="text-sm text-parchment/50">{t('Loading…')}</p>}
          {suggested.data?.length === 0 && <p className="text-sm text-parchment/50">{t('No suggestions right now. Search by name above.')}</p>}
          <ul className={grid}>
            {suggested.data?.map((c) => <CardPick key={c.id} card={c} on={isOn(c)} onPick={() => pick(c)} />)}
          </ul>
        </section>
      )}
    </div>
  )
}

// ---- Temas -----------------------------------------------------------------------------------------

export function ThemesStep({ answers, set, index }: StepProps & { index: number }) {
  const { t, locale } = useI18n()
  const [text, setText] = useState('')
  const chosen = answers.themes
  const commanders = answers.commanders
  const page = useQuery({
    queryKey: ['gen-commander-page', commanders.map((c) => c.name)],
    queryFn: ({ signal }) => mainPage(commanders, signal),
    enabled: commanders.length > 0,
    staleTime: 3_600_000,
  })
  const own = page.data?.page.themes
  const all = useQuery({
    queryKey: ['edhrec-themes'],
    queryFn: ({ signal }) => fetchAllThemes(signal),
    enabled: !commanders.length || (page.isFetched && !own?.length),
    staleTime: Infinity,
  })
  const list = useMemo(() => (own?.length ? own : (all.data ?? [])), [own, all.data])
  const loading = (commanders.length > 0 && page.isPending) || (!own?.length && all.isPending && all.fetchStatus !== 'idle')
  const shown = useMemo(() => {
    const q = text.trim().toLowerCase()
    const hits = q ? list.filter((th) => th.name.toLowerCase().includes(q)) : list.slice(0, 30)
    // As escolhidas aparecem sempre, mesmo fora da lista (vindas da frase, ou de outro comandante)
    return [...chosen.filter((c) => !hits.some((h) => h.slug === c.slug)), ...hits]
  }, [list, text, chosen])
  const toggle = (th: Theme) => {
    if (chosen.some((c) => c.slug === th.slug)) return set({ themes: chosen.filter((c) => c.slug !== th.slug) })
    if (chosen.length >= MAX_THEMES) return
    set({ themes: [...chosen, th], surprise: false })
  }
  return (
    <div className="space-y-6">
      <StepHeader kicker={step(t, index, t('Themes'))} title={t('What should the deck be about?')}>
        {t('Pick up to three. A few strong themes make a better deck than many weak ones.')}
      </StepHeader>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-parchment/40" aria-hidden />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('Search themes (e.g. tokens, dragons, lifegain)')}
            aria-label={t('Search themes')}
            className="w-full rounded-lg border border-line bg-surface py-2.5 pr-3 pl-9 focus:border-gold focus:outline-none"
          />
        </div>
        <span className="text-sm text-parchment/60 tabular-nums">
          {chosen.length}/{MAX_THEMES}
        </span>
        {chosen.length >= MAX_THEMES && <span className="text-xs text-parchment/45">{t('Remove one to swap it.')}</span>}
      </div>
      <p className="text-xs text-parchment/45">
        {own?.length
          ? t('Themes of the decks people build with {name} on EDHREC.', { name: commanders.map((c) => c.name.split(' // ')[0]).join(' + ') })
          : t('The most played themes on EDHREC.')}
      </p>
      {loading && <p className="text-sm text-parchment/50">{t('Loading…')}</p>}
      {!loading && !list.length && <p className="text-sm text-parchment/50">{t('Themes are unavailable right now. You can go on without them.')}</p>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
        {shown.map((th) => {
          const on = chosen.some((c) => c.slug === th.slug)
          return (
            <li key={th.slug}>
              <Choice on={on} onClick={() => toggle(th)} disabled={!on && chosen.length >= MAX_THEMES} className="w-full !p-3">
                <span className="block truncate font-semibold text-parchment">{th.name}</span>
                {th.decks > 0 && (
                  <span className="text-xs text-parchment/45">{t('{n} decks', { n: th.decks.toLocaleString(locale) })}</span>
                )}
              </Choice>
            </li>
          )
        })}
      </ul>
      {commanders.length > 0 && (
        <label className={`flex items-center gap-3 rounded-lg border border-line bg-surface/60 p-3 text-sm ${chosen.length ? 'opacity-50' : ''}`}>
          <input
            type="checkbox"
            checked={answers.surprise && !chosen.length}
            disabled={chosen.length > 0}
            onChange={(e) => set({ surprise: e.target.checked })}
            className="h-4 w-4 accent-[var(--color-gold)]"
          />
          <Shuffle className="h-4 w-4 text-gold" aria-hidden />
          {t('Surprise me: use the themes most played with this commander')}
        </label>
      )}
    </div>
  )
}

// ---- Orçamento ---------------------------------------------------------------------------------------

export function BudgetStep({ answers, set, index }: StepProps & { index: number }) {
  const { t, locale } = useI18n()
  const [custom, setCustom] = useState(() => (answers.budget !== null && !BUDGETS.includes(answers.budget) ? String(answers.budget) : ''))
  return (
    <div className="space-y-6">
      <StepHeader kicker={step(t, index, t('Budget'))} title={t('How much do you want to spend?')}>
        {t('The total of the 100 cards, using the cheapest printing of each one on Scryfall (in US dollars).')}
      </StepHeader>
      <div className="flex flex-wrap gap-2">
        {BUDGETS.map((b) => (
          <Choice
            key={b}
            on={answers.budget === b}
            onClick={() => {
              set({ budget: b })
              setCustom('')
            }}
            className="w-28 !py-3 text-center"
          >
            <span className="font-display text-2xl text-parchment">{money(b, 'USD', locale, true)}</span>
          </Choice>
        ))}
        <Choice on={answers.budget === null} onClick={() => set({ budget: null })} className="w-32 !py-3 text-center">
          <span className="font-display text-2xl text-parchment">{t('No limit')}</span>
        </Choice>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm text-parchment/70">
        {t('Or type a value (US$):')}
        <input
          type="number"
          min={20}
          max={100000}
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value)
            const n = Math.round(Number(e.target.value))
            if (n >= 20) set({ budget: Math.min(100000, n) })
          }}
          className="w-28 rounded-lg border border-line bg-surface px-3 py-1.5 tabular-nums focus:border-gold focus:outline-none"
        />
      </label>
      <p className="text-xs text-parchment/45">
        {t('The generator aims close to this value without going over, using the money on the cards that make the deck better. If the best options are cheap, it comes out cheaper. Up to US$ 60 it starts from the cheapest decks with this commander.')}
      </p>
    </div>
  )
}

// ---- Bracket ---------------------------------------------------------------------------------------

const TAGLINES: Record<number, string> = {
  1: 'The theme comes first; winning is a bonus.',
  2: 'Like a precon straight out of the box.',
  3: 'A precon with real upgrades. Where most tables play.',
  4: 'Tuned and fast, playing to win.',
  5: 'Competitive: every card earns its slot.',
}
const RULES: Record<number, [boolean, string][]> = {
  1: [[false, 'No mass land denial or extra turns'], [false, 'No two-card combos'], [false, 'No Game Changers'], [true, 'Few tutors']],
  2: [[false, 'No mass land denial'], [false, 'No chained extra turns'], [false, 'No two-card combos'], [false, 'No Game Changers'], [true, 'Few tutors']],
  3: [[false, 'No mass land denial'], [false, 'No chained extra turns'], [true, 'Two-card combos only late in the game'], [true, 'Up to 3 Game Changers'], [true, 'Tutors allowed']],
  4: [[true, 'Anything outside the banned list'], [true, 'Fast mana and early combos'], [true, 'Any number of Game Changers']],
  5: [[true, 'Anything outside the banned list'], [true, 'Built to win as fast as possible'], [true, 'The most efficient cards']],
}

export function PowerStep({ answers, set, index }: StepProps & { index: number }) {
  const { t } = useI18n()
  return (
    <div className="space-y-6">
      <StepHeader kicker={step(t, index, t('Power'))} title={t('How strong should the deck be?')}>
        {t('Brackets are the official Commander power scale. Most tables play at 3.')}
      </StepHeader>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {[1, 2, 3, 4, 5].map((b) => (
          <Choice key={b} on={answers.bracket === b} onClick={() => set({ bracket: b })} className="flex flex-col gap-2 text-center">
            <span className={`font-display text-4xl ${answers.bracket === b ? 'text-gold' : 'text-parchment/40'}`}>{b}</span>
            <span className="text-sm font-semibold tracking-wide text-parchment uppercase">{BRACKET_NAMES[b]}</span>
            <span className="text-xs text-parchment/55">{t(TAGLINES[b])}</span>
            <ul className="mt-1 space-y-1 text-left text-xs">
              {RULES[b].map(([ok, rule]) => (
                <li key={rule} className="flex gap-1.5">
                  {ok ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-300" aria-hidden /> : <X className="mt-0.5 h-3 w-3 shrink-0 text-red-300" aria-hidden />}
                  <span className="text-parchment/70">{t(rule)}</span>
                </li>
              ))}
            </ul>
          </Choice>
        ))}
      </div>
    </div>
  )
}

// ---- Detalhes ----------------------------------------------------------------------------------------

export function DetailsStep({ answers, set, index }: StepProps & { index: number }) {
  const { t } = useI18n()
  const field = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-gold focus:outline-none'
  const identity = answers.commanders.length ? identityOf(answers.commanders) : null
  return (
    <div className="space-y-6">
      <StepHeader kicker={step(t, index, t('Details'))} title={t('Anything else?')}>
        {t('All optional. Type part of a card name and pick it from the list, one at a time.')}
      </StepHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 md:col-span-2">
          <span className="text-xs font-semibold tracking-wide text-gold uppercase">{t('Deck name')}</span>
          <input
            value={answers.name}
            onChange={(e) => set({ name: e.target.value.slice(0, 100) })}
            placeholder={t('Leave it empty to name it after the commander')}
            className={field}
          />
        </label>
        {/* Uma carta fica numa lista só: escolher numa tira da outra */}
        <CardPicker
          label={t('Cards that must be in')}
          names={answers.include}
          identity={identity}
          tone="in"
          onChange={(include) => set({ include, exclude: answers.exclude.filter((n) => !include.includes(n)) })}
        />
        <CardPicker
          label={t('Cards to leave out')}
          names={answers.exclude}
          identity={identity}
          tone="out"
          onChange={(exclude) => set({ exclude, include: answers.include.filter((n) => !exclude.includes(n)) })}
        />
        {identity && (
          <p className="text-xs text-parchment/45 md:col-span-2">
            {t('Only cards that fit {name}’s colors and are legal in Commander show up.', {
              name: answers.commanders.map((c) => c.name.split(',')[0].split(' // ')[0]).join(' + '),
            })}
          </p>
        )}
      </div>
      {answers.lane !== 'collection' && <PoolChoice answers={answers} set={set} />}
    </div>
  )
}

function PoolChoice({ answers, set }: StepProps) {
  const { t } = useI18n()
  return (
    <div className="space-y-2">
      <span className="text-xs font-semibold tracking-wide text-gold uppercase">{t('Card pool')}</span>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => set({ owned: false })} aria-pressed={!answers.owned} className={chipClass(!answers.owned)}>
          {t('Any card')}
        </button>
        <button type="button" onClick={() => set({ owned: true })} aria-pressed={answers.owned} className={chipClass(answers.owned)}>
          {t('Only cards I own')}
        </button>
      </div>
      <p className="text-xs text-parchment/45">
        {t('“Only cards I own” uses the precons you marked and the decks you built. If they are not enough, the gaps are filled with other cards and listed for you.')}
      </p>
    </div>
  )
}

// ---- Revisão -----------------------------------------------------------------------------------------

export function ReviewStep({
  answers,
  set,
  index,
  goTo,
  onBuild,
}: StepProps & { index: number; goTo: (s: StepKey) => void; onBuild: () => void }) {
  const { t, locale } = useI18n()
  const commander = answers.commanders[0]
  const include = answers.include.length
  const exclude = answers.exclude.length
  const tile = 'space-y-2 rounded-xl border border-line bg-surface/60 p-4'
  const label = 'text-xs font-semibold tracking-wide text-gold uppercase'
  const change = (s: StepKey) => (
    <button type="button" onClick={() => goTo(s)} className="text-xs text-gold/80 underline-offset-4 hover:text-gold hover:underline">
      {t('Change')}
    </button>
  )
  return (
    <div className="space-y-6">
      <StepHeader kicker={step(t, index, t('Review'))} title={t('Ready to build')}>
        {t('Change anything here, or build the deck.')}
      </StepHeader>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={`${tile} sm:col-span-2 ${commander ? 'border-gold/50' : 'border-amber-400/40'}`}>
            <div className="flex items-center justify-between">
              <span className={label}>{t('Commander')}</span>
              {change('commander')}
            </div>
            {commander ? (
              <p className="flex flex-wrap items-center gap-2 text-lg text-parchment">
                <ColorIdentity colors={identityOf(answers.commanders).join('')} />
                {answers.commanders.map((c) => c.name).join(' + ')}
              </p>
            ) : (
              <p className="text-sm text-amber-200">{t('Choose a commander to build the deck.')}</p>
            )}
          </div>
          <div className={tile}>
            <div className="flex items-center justify-between">
              <span className={label}>{t('Themes')}</span>
              {change('themes')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {answers.themes.map((th) => (
                <span key={th.slug} className="rounded-full bg-gold/15 px-2.5 py-0.5 text-xs font-semibold text-gold">
                  {th.name}
                </span>
              ))}
              {!answers.themes.length && (
                <span className="text-sm text-parchment/55">{answers.surprise ? t('Surprise me') : t('No theme: the best cards for the commander')}</span>
              )}
            </div>
          </div>
          {!answers.owned ? (
            <div className={tile}>
              <span className={label}>{t('Budget')}</span>
              <div className="flex flex-wrap gap-1.5">
                {[...BUDGETS, null].map((b) => (
                  <button key={b ?? 'none'} type="button" onClick={() => set({ budget: b })} aria-pressed={answers.budget === b} className={chipClass(answers.budget === b)}>
                    {b === null ? t('No limit') : money(b, 'USD', locale, true)}
                  </button>
                ))}
                {answers.budget !== null && !BUDGETS.includes(answers.budget) && (
                  <span className={chipClass(true)}>{money(answers.budget, 'USD', locale, true)}</span>
                )}
              </div>
            </div>
          ) : (
            <div className={tile}>
              <span className={label}>{t('Budget')}</span>
              <p className="text-sm text-parchment/55">{t('No budget: the deck uses cards you already own.')}</p>
            </div>
          )}
          <div className={tile}>
            <span className={label}>{t('Power bracket')}</span>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => set({ bracket: b })}
                  aria-pressed={answers.bracket === b}
                  title={BRACKET_NAMES[b]}
                  className={`h-8 w-8 rounded-md border text-sm font-semibold tabular-nums transition ${
                    answers.bracket === b ? 'border-gold bg-gold/15 text-gold' : 'border-line text-parchment/60 hover:text-parchment'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
            <p className="text-xs text-parchment/50">{BRACKET_NAMES[answers.bracket]}</p>
          </div>
          <div className={tile}>
            <span className={label}>{t('Card pool')}</span>
            {answers.lane === 'collection' ? (
              <p className="text-sm text-parchment/70">{t('Only cards I own')}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => set({ owned: false })} aria-pressed={!answers.owned} className={chipClass(!answers.owned)}>
                  {t('Any card')}
                </button>
                <button type="button" onClick={() => set({ owned: true })} aria-pressed={answers.owned} className={chipClass(answers.owned)}>
                  {t('Only cards I own')}
                </button>
              </div>
            )}
          </div>
          <div className={tile}>
            <div className="flex items-center justify-between">
              <span className={label}>{t('Details')}</span>
              {change('details')}
            </div>
            <p className="text-sm text-parchment/60">
              {!answers.name.trim() && !include && !exclude
                ? t('Nothing set')
                : [
                    answers.name.trim() && `“${answers.name.trim()}”`,
                    include && t('{n} must be in', { n: include }),
                    exclude && t('{n} left out', { n: exclude }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </p>
          </div>
        </div>
        {commander && (
          <div className="hidden space-y-2 lg:block">
            {answers.commanders.map((c) => (
              <img key={c.id} src={c.image} alt={c.name} className="w-full rounded-[4.5%] shadow-xl shadow-black/50" />
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onBuild}
          disabled={!commander}
          className="font-display rounded-md btn-ember px-6 py-2.5 text-xl tracking-wide text-ink transition hover:brightness-110 disabled:opacity-40"
        >
          {t('Build my deck')} →
        </button>
      </div>
    </div>
  )
}
