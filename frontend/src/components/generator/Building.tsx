/* Tela da montagem: as fases com o tempo de cada uma, o quadro das 100 vagas e o que está acontecendo agora */
import { Check, Circle, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { BRACKET_NAMES } from '../../lib/brackets'
import type { BuilderCard } from '../../lib/deckbuilder'
import { identityOf, PHASES, type Phase, type Progress } from '../../lib/generator'
import { useI18n } from '../../lib/i18n'
import { ColorIdentity } from '../Mana'
import { NoteText } from './ui'

const PHASE_LABELS: Record<Phase, string> = {
  commander: 'Reading your commander',
  community: 'Looking at what other people play',
  plan: 'Planning the deck',
  spells: 'Choosing the spells',
  lands: 'Building the mana base',
  budget: 'Fitting the budget',
  power: 'Checking the bracket',
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function Building({
  progress,
  commanders,
  bracket,
  budget,
  onCancel,
}: {
  progress: Progress
  commanders: BuilderCard[]
  bracket: number
  budget: number | null
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  const current = PHASES.indexOf(progress.phase)
  const chosen = Math.min(100, progress.chosen)
  const label = (p: Phase) => (p === 'budget' && budget === null ? t('No budget limit') : t(PHASE_LABELS[p]))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1.5">
          <p className="text-xs font-semibold tracking-[0.2em] text-emerald-300 uppercase">
            {t('Generating')} · {label(progress.phase)}
          </p>
          <h2 className="font-display text-3xl text-parchment sm:text-4xl">{t('Building your deck')}</h2>
          <p className="min-h-10 text-sm text-parchment/60" aria-live="polite">
            {progress.note && <NoteText note={progress.note} />}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-5xl text-emerald-300 tabular-nums">
            {chosen}
            <span className="text-2xl text-parchment/35"> / 100</span>
          </p>
          <p className="text-xs text-parchment/45">
            {t('cards chosen so far')} · {clock(elapsed)}
          </p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="space-y-5 rounded-xl border border-line bg-surface/60 p-4">
          <div className="flex items-center gap-3">
            {commanders[0] && <img src={commanders[0].small || commanders[0].image} alt="" className="h-16 w-12 rounded object-cover" />}
            <div className="min-w-0">
              <p className="truncate font-semibold text-parchment">{commanders.map((c) => c.name.split(' // ')[0]).join(' + ')}</p>
              <p className="flex items-center gap-2 text-xs text-parchment/55">
                <ColorIdentity colors={identityOf(commanders).join('')} />
                {t('Bracket {n} · {name}', { n: bracket, name: BRACKET_NAMES[bracket] })}
              </p>
            </div>
          </div>
          <ol className="space-y-3">
            {PHASES.map((p, i) => {
              const done = progress.done[p] !== undefined
              const running = !done && i === current
              return (
                <li key={p} className="flex gap-3">
                  <span className="mt-0.5">
                    {done ? (
                      <Check className="h-4 w-4 text-emerald-300" aria-hidden />
                    ) : running ? (
                      <LoaderCircle className="h-4 w-4 animate-spin text-emerald-300" aria-hidden />
                    ) : (
                      <Circle className="h-4 w-4 text-parchment/25" aria-hidden />
                    )}
                  </span>
                  <span>
                    <span className={`block text-sm ${done ? 'text-emerald-200' : running ? 'text-parchment' : 'text-parchment/40'}`}>{label(p)}</span>
                    <span className="text-xs text-parchment/40">
                      {done ? clock(progress.done[p]!) : running ? t('running…') : t('queued')}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-lg border border-line py-2 text-sm text-parchment/70 transition hover:border-red-400/50 hover:text-red-300"
          >
            {t('Cancel build')}
          </button>
        </aside>

        <section className="space-y-4 rounded-xl border border-line bg-surface/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold tracking-[0.15em] text-parchment/70 uppercase">{label(progress.phase)}</h3>
            <span className="text-xs text-parchment/40">{t('100 slots · every pick checked on Scryfall')}</span>
          </div>
          <div className="grid grid-cols-10 gap-1.5 sm:grid-cols-20" aria-hidden>
            {Array.from({ length: 100 }, (_, i) => (
              <span
                key={i}
                className={`aspect-[5/7] rounded-[3px] border transition-colors duration-300 ${
                  i < chosen
                    ? i >= chosen - 3
                      ? 'border-emerald-300/70 bg-emerald-400/35 shadow-[0_0_10px_rgb(52_211_153/0.35)]'
                      : 'border-emerald-400/35 bg-emerald-400/15'
                    : 'border-line bg-ink/40'
                }`}
              />
            ))}
          </div>
          <p className="flex gap-4 text-xs text-parchment/50">
            <span>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400/70" />
              {t('Chosen')} {chosen}
            </span>
            <span>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-parchment/20" />
              {t('Still to fill')} {100 - chosen}
            </span>
          </p>
        </section>
      </div>
    </div>
  )
}
