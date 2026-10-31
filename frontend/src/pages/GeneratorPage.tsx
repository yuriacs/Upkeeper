import '../i18n/ptGenerator' // traduções do gerador (carregam junto com esta página)
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { History, RotateCcw, Trash2, WandSparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BracketBadge } from '../components/Bracket'
import { ColorIdentity } from '../components/Mana'
import { Building } from '../components/generator/Building'
import { Result } from '../components/generator/Result'
import {
  BudgetStep,
  ColorsStep,
  CommanderStep,
  DescribeStep,
  DetailsStep,
  PowerStep,
  ReviewStep,
  StartStep,
  ThemesStep,
} from '../components/generator/Steps'
import { laneLabel, stepLabel } from '../components/generator/labels'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { canPair, type BuilderCard } from '../lib/deckbuilder'
import { findCommander, readDescription, themeByName } from '../lib/describeDeck'
import { fetchAllThemes, type EdhrecTheme } from '../lib/edhrec'
import {
  clearWizard,
  commandersByName,
  generate,
  GenError,
  identityOf,
  loadHistory,
  loadWizard,
  NEW_ANSWERS,
  removeFromHistory,
  saveToHistory,
  saveWizard,
  stepsFor,
  type Answers,
  type GenResult,
  type Lane,
  type Progress,
  type StepKey,
  type WizardState,
} from '../lib/generator'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/money'

type T = (s: string, v?: Record<string, string | number>) => string
type View = { kind: 'wizard' } | { kind: 'building'; progress: Progress } | { kind: 'result'; result: GenResult }

function buildError(t: T, err: unknown): string {
  if (err instanceof GenError)
    return {
      no_commander: t('Choose a commander first.'),
      no_data: t('There is no card data for this commander right now. Try again in a moment.'),
      scryfall: t('Could not reach Scryfall. Try again in a moment.'),
      pool: t('Could not load your cards. Try again in a moment.'),
    }[err.code]
  return t('Something went wrong while building the deck. Try again.')
}

/**
 * Gerador de decks: perguntas em passos (ou uma frase), a montagem ao vivo e o deck pronto, que vai
 * para o deckbuilder ou direto para a sua pool. A montagem roda no navegador (lib/generator.ts).
 */
export default function GeneratorPage() {
  const { t } = useI18n()
  useTitle(t('Generate a deck'))
  const queryClient = useQueryClient()
  const info = useQuery({ queryKey: ['generator-info'], queryFn: api.generatorInfo, staleTime: 60_000 })
  const ai = !!info.data?.ai
  const [aiLeft, setAiLeft] = useState<number | null>(null)
  const left = aiLeft ?? info.data?.ai_left ?? 0

  const [tab, setTab] = useState<'build' | 'history'>('build')
  const [state, setState] = useState<WizardState>(() => {
    const saved = loadWizard()
    // Respostas de uma versão anterior da página: completa com os campos novos
    return saved ? { step: saved.step, answers: { ...NEW_ANSWERS, ...saved.answers } } : { answers: NEW_ANSWERS, step: 'start' }
  })
  const [view, setView] = useState<View>({ kind: 'wizard' })
  const [history, setHistory] = useState(loadHistory)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const running = useRef<AbortController | null>(null)
  useEffect(() => saveWizard(state), [state])
  // Sair da página cancela a montagem
  useEffect(() => () => running.current?.abort(), [])

  const { answers, step } = state
  const steps = stepsFor(answers.lane)
  const position = Math.max(0, steps.indexOf(step))
  const set = (patch: Partial<Answers>) => setState((s) => ({ ...s, answers: { ...s.answers, ...patch } }))
  const goTo = (s: StepKey) => {
    setError(null)
    setReadError(null)
    setState((st) => ({ ...st, step: s }))
    window.scrollTo(0, 0)
  }
  const startOver = () => {
    clearWizard()
    setState({ answers: NEW_ANSWERS, step: 'start' })
    setError(null)
    setReadError(null)
  }
  const pickLane = (lane: Lane) => {
    setState((s) => ({
      answers: { ...s.answers, lane, owned: lane === 'collection' ? true : s.answers.lane === 'collection' ? false : s.answers.owned },
      step: stepsFor(lane)[1],
    }))
    window.scrollTo(0, 0)
  }

  /** A frase do "Descreva seu deck" vira as respostas: pela IA ou, sem ela, pela leitura simples */
  const read = async () => {
    const text = answers.description.trim()
    setReading(true)
    setReadError(null)
    const ctl = new AbortController()
    try {
      const themes = await queryClient
        .fetchQuery({ queryKey: ['edhrec-themes'], queryFn: ({ signal }) => fetchAllThemes(signal), staleTime: Infinity })
        .catch(() => [] as EdhrecTheme[])
      let patch: Partial<Answers> | null = null
      let named: string[] = []
      let found: BuilderCard | null = null
      if (ai) {
        try {
          const r = await api.generatorDescribe(text)
          if (r.ai_left !== undefined) setAiLeft(r.ai_left)
          patch = {
            colors: r.colors ? r.colors.split('') : null,
            themes: r.themes.map((n) => themeByName(n, themes)).filter((th): th is EdhrecTheme => !!th),
            ...(r.budget !== null ? { budget: r.budget } : {}),
            ...(r.bracket ? { bracket: r.bracket } : {}),
            include: r.include.join('\n'),
            exclude: r.exclude.join('\n'),
            name: r.name,
            suggestions: r.suggestions,
          }
          named = [r.commander, r.partner].filter(Boolean)
        } catch {
          setReadError(t('The AI did not answer, so we read the sentence the simple way.'))
        }
      }
      if (!patch) {
        const r = readDescription(text, themes)
        patch = { colors: r.colors, themes: r.themes, ...(r.budget !== undefined ? { budget: r.budget } : {}), ...(r.bracket ? { bracket: r.bracket } : {}), suggestions: [] }
        found = await findCommander(r.words, r.colors, ctl.signal)
      }
      let commanders = found ? [found] : named.length ? await commandersByName(named, ctl.signal) : []
      if (commanders.length === 2 && !canPair(commanders[0], commanders[1])) commanders = commanders.slice(0, 1)
      const final = patch
      setState((s) => ({
        answers: { ...s.answers, ...final, ...(commanders.length ? { commanders } : {}) },
        step: commanders.length ? 'review' : 'commander',
      }))
    } finally {
      setReading(false)
    }
  }

  const build = async () => {
    const ctl = new AbortController()
    running.current = ctl
    setError(null)
    setView({ kind: 'building', progress: { phase: 'commander', chosen: answers.commanders.length, note: null, done: {} } })
    window.scrollTo(0, 0)
    try {
      const result = await generate(answers, {
        signal: ctl.signal,
        onProgress: (progress) => setView((v) => (v.kind === 'building' ? { kind: 'building', progress } : v)),
      })
      saveToHistory(result)
      setHistory(loadHistory())
      setView({ kind: 'result', result })
      window.scrollTo(0, 0)
    } catch (err) {
      if (!ctl.signal.aborted) setError(buildError(t, err))
      setView({ kind: 'wizard' })
    } finally {
      if (running.current === ctl) running.current = null
    }
  }
  const updateResult = (r: GenResult) => {
    saveToHistory(r)
    setHistory(loadHistory())
    setView({ kind: 'result', result: r })
    if (r.guide?.ai_left !== undefined) setAiLeft(r.guide.ai_left)
  }
  const openResult = (r: GenResult) => {
    setTab('build')
    setView({ kind: 'result', result: r })
    window.scrollTo(0, 0)
  }
  const editAnswers = (r: GenResult) => {
    setState({ answers: { ...NEW_ANSWERS, ...r.answers }, step: 'review' })
    setView({ kind: 'wizard' })
    window.scrollTo(0, 0)
  }

  const tabClass = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition ${on ? 'bg-gold/15 text-gold' : 'text-parchment/60 hover:text-parchment'}`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display flex items-center gap-2 text-3xl text-parchment">
          <WandSparkles className="h-6 w-6 text-gold" aria-hidden />
          {t('Generate a deck')}
        </h1>
        <div role="tablist" className="flex gap-1 rounded-lg border border-line p-1">
          <button role="tab" aria-selected={tab === 'build'} onClick={() => setTab('build')} className={tabClass(tab === 'build')}>
            {t('Build')}
          </button>
          <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')} className={tabClass(tab === 'history')}>
            <History className="h-4 w-4" aria-hidden />
            {t('History')} {history.length > 0 && <span className="text-parchment/40">{history.length}</span>}
          </button>
        </div>
        <span className="ml-auto text-xs text-parchment/45">
          {ai ? t('AI requests left today: {n}', { n: left }) : ''}{' '}
          <Link to="/my-pool/build" className="underline-offset-4 hover:text-gold hover:underline">
            {t('Or build it card by card')}
          </Link>
        </span>
      </div>

      {tab === 'history' ? (
        <HistoryList
          items={history}
          onOpen={openResult}
          onRemove={(id) => {
            removeFromHistory(id)
            setHistory(loadHistory())
          }}
        />
      ) : view.kind === 'building' ? (
        <Building
          progress={view.progress}
          commanders={answers.commanders}
          bracket={answers.bracket}
          budget={answers.owned ? null : answers.budget}
          onCancel={() => running.current?.abort()}
        />
      ) : view.kind === 'result' ? (
        <Result result={view.result} ai={ai} aiLeft={left} onUpdate={updateResult} onEdit={() => editAnswers(view.result)} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <Sidebar answers={answers} steps={steps} step={step} goTo={goTo} onStartOver={startOver} />
          <section className="min-w-0 space-y-6">
            <p className="text-xs text-parchment/50 lg:hidden">
              {t('Step {n} of {total} · {name}', { n: position + 1, total: steps.length, name: stepLabel(t, step) })}
              {' · '}
              <button type="button" onClick={startOver} className="text-gold/80 underline-offset-4 hover:underline">
                {t('Start over')}
              </button>
            </p>
            {error && <p className="rounded-lg border border-red-400/30 bg-red-400/5 p-3 text-sm text-red-300">{error}</p>}
            {/* Fica visível no passo seguinte à frase: a pessoa sabe que a leitura foi a simples */}
            {readError && step !== 'describe' && (
              <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-200">{readError}</p>
            )}
            {step === 'start' && <StartStep lane={answers.lane} ai={ai} onPick={pickLane} />}
            {step === 'describe' && (
              <DescribeStep answers={answers} set={set} ai={ai} aiLeft={left} busy={reading} error={readError} onRead={read} />
            )}
            {step === 'colors' && <ColorsStep answers={answers} set={set} />}
            {step === 'commander' && <CommanderStep answers={answers} set={set} index={position + 1} />}
            {step === 'themes' && <ThemesStep answers={answers} set={set} index={position + 1} />}
            {step === 'budget' && <BudgetStep answers={answers} set={set} index={position + 1} />}
            {step === 'power' && <PowerStep answers={answers} set={set} index={position + 1} />}
            {step === 'details' && <DetailsStep answers={answers} set={set} index={position + 1} />}
            {step === 'review' && <ReviewStep answers={answers} set={set} index={position + 1} goTo={goTo} onBuild={build} />}

            {step !== 'start' && (
              <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
                <button
                  type="button"
                  onClick={() => goTo(steps[Math.max(0, position - 1)])}
                  className="rounded-md border border-line px-4 py-2 text-sm text-parchment/80 transition hover:border-parchment/40"
                >
                  {t('Back')}
                </button>
                {step !== 'review' && step !== 'describe' && (
                  <span className="flex items-center gap-3">
                    <span className="hidden text-xs text-parchment/40 sm:inline">{t('You can change this later')}</span>
                    <button
                      type="button"
                      onClick={() => goTo(steps[Math.min(steps.length - 1, position + 1)])}
                      disabled={step === 'commander' && !answers.commanders.length}
                      className="rounded-md border border-gold/70 px-5 py-2 text-sm font-semibold text-gold transition hover:bg-gold/10 disabled:opacity-40"
                    >
                      {t('Continue')} →
                    </button>
                  </span>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

/** Os passos do caminho escolhido, com a resposta de cada um; dá para pular para qualquer um já liberado */
function Sidebar({
  answers,
  steps,
  step,
  goTo,
  onStartOver,
}: {
  answers: Answers
  steps: StepKey[]
  step: StepKey
  goTo: (s: StepKey) => void
  onStartOver: () => void
}) {
  const { t, locale } = useI18n()
  const position = steps.indexOf(step)
  const summary = (s: StepKey) => {
    switch (s) {
      case 'start':
        return answers.lane ? laneLabel(t, answers.lane) : ''
      case 'describe':
        return answers.description.trim() ? `“${answers.description.trim().slice(0, 18)}…”` : ''
      case 'colors':
        return answers.colors === null ? t('Any colors') : answers.colors.length ? <ColorIdentity colors={answers.colors.join('')} /> : t('Colorless')
      case 'commander':
        return answers.commanders.map((c) => c.name.split(',')[0].split(' // ')[0]).join(' + ')
      case 'themes':
        return answers.themes.length
          ? t(answers.themes.length === 1 ? '{n} theme' : '{n} themes', { n: answers.themes.length })
          : answers.surprise
            ? t('Surprise me')
            : ''
      case 'budget':
        return answers.budget === null ? t('No limit') : money(answers.budget, 'USD', locale, true)
      case 'power':
        return t('Bracket {n}', { n: answers.bracket })
      case 'details':
        return answers.name.trim() || answers.include.trim() || answers.exclude.trim() ? t('Filled in') : t('Nothing set')
      default:
        return ''
    }
  }
  return (
    <aside className="hidden h-fit space-y-4 rounded-xl border border-line bg-surface/60 p-4 lg:sticky lg:top-24 lg:block">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold tracking-[0.15em] text-parchment/50 uppercase">{t('Guided build')}</span>
        <span className="font-display text-2xl text-gold tabular-nums">
          {String(position + 1).padStart(2, '0')}
          <span className="text-sm text-parchment/40">/{String(steps.length).padStart(2, '0')}</span>
        </span>
      </div>
      <ol className="space-y-1">
        {steps.map((s, i) => {
          const reachable = i <= position || (answers.commanders.length > 0 && !!answers.lane)
          return (
            <li key={s}>
              <button
                type="button"
                onClick={() => reachable && goTo(s)}
                disabled={!reachable}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                  s === step ? 'bg-gold/15 text-gold' : reachable ? 'text-parchment/80 hover:bg-parchment/5' : 'text-parchment/30'
                }`}
              >
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[0.65rem] tabular-nums ${
                    s === step ? 'border-gold bg-gold text-ink' : 'border-line'
                  }`}
                >
                  {i + 1}
                </span>
                <span className="flex-1">{stepLabel(t, s)}</span>
                <span className="max-w-24 truncate text-xs text-parchment/45">{summary(s)}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="flex items-center justify-between border-t border-line pt-3 text-xs text-parchment/45">
        {t('Answers save as you go')}
        <button
          type="button"
          onClick={onStartOver}
          className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-parchment/70 transition hover:border-parchment/40"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          {t('Start over')}
        </button>
      </div>
    </aside>
  )
}

/** Os últimos decks gerados (só neste navegador) */
function HistoryList({ items, onOpen, onRemove }: { items: GenResult[]; onOpen: (r: GenResult) => void; onRemove: (id: string) => void }) {
  const { t, locale } = useI18n()
  if (!items.length)
    return (
      <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-parchment/55">
        {t('The decks you generate show up here (only in this browser), so you can open them again.')}
      </p>
    )
  return (
    <ul className="space-y-2">
      {items.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/60 p-3">
          {r.deck.commanders[0] && <img src={r.deck.commanders[0].small || r.deck.commanders[0].image} alt="" className="h-14 w-10 rounded object-cover" />}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-parchment">{r.deck.name}</p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-parchment/50">
              <ColorIdentity colors={identityOf(r.deck.commanders).join('')} />
              {r.bracket && <BracketBadge bracket={r.bracket} />}
              <span className="text-emerald-300/80">{money(r.price, 'USD', locale)}</span>
              {r.themes.length > 0 && <span>{r.themes.map((th) => th.name).join(' · ')}</span>}
              <span>{new Date(r.createdAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpen(r)}
            className="rounded-md border border-gold/60 px-3 py-1.5 text-sm font-semibold text-gold transition hover:bg-gold/10"
          >
            {t('Open')}
          </button>
          <button
            type="button"
            onClick={() => onRemove(r.id)}
            aria-label={t('Remove {name}', { name: r.deck.name })}
            title={t('Remove from the history')}
            className="grid h-8 w-8 place-items-center rounded-md text-parchment/50 transition hover:text-red-300"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}
