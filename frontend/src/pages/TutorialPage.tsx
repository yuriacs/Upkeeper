import { useEffect, useReducer, useRef, useState } from 'react'
import { BookOpen, Check, LogOut, RotateCcw, Swords, Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  CardBackView,
  CardImg,
  EmptySlot,
  FieldCardView,
  HandCardView,
  ManaPool,
  PhaseBar,
  Pile,
  PlayerBadge,
  Rich,
  type Lang,
} from '../components/tutorial/TutorialKit'
import { useTitle } from '../hooks/useTitle'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { writeJSON } from '../lib/storage'
import { def, pick, type L } from '../lib/tutorial/cards'
import { TERMS, type TermKey } from '../lib/tutorial/glossary'
import { STEPS, type Step, type Target } from '../lib/tutorial/script'
import { TUTORIAL_DONE_KEY } from '../lib/tutorial/progress'
import { canPay, clone, initialState, type FieldCard, type TState } from '../lib/tutorial/state'

// ------------------------------------------------------------------ Motor do roteiro

type Hint = { text: L; at: number }
type Run = { i: number; s: TState; done: Target[]; busy: boolean; hint: Hint | null }

type Action = { type: 'click'; target: Target } | { type: 'next' } | { type: 'restart' }

function enterStep(i: number, prev: TState): TState {
  const s = clone(prev)
  STEPS[i]?.enter?.(s)
  return s
}

const start = (): Run => ({ i: 0, s: enterStep(0, initialState()), done: [], busy: false, hint: null })

const UI = {
  oneLand: {
    en: 'Only one land per turn! You already played a land this turn.',
    pt: 'Só um terreno por turno! Você já jogou um terreno neste turno.',
  },
  mainOnly: {
    en: 'Lands and creatures are played in your main phase.',
    pt: 'Terrenos e criaturas são jogados na sua fase principal.',
  },
  noMana: {
    en: 'Not enough mana in your pool for this card yet: you need to tap lands first.',
    pt: 'Ainda não tem mana suficiente na reserva para esta carta: primeiro é preciso virar terrenos.',
  },
  tapped: {
    en: 'This land is already tapped: it has made its mana this turn.',
    pt: 'Este terreno já está virado: ele já gerou a mana dele neste turno.',
  },
  sick: {
    en: 'Summoning sickness: this creature arrived this turn and can’t attack yet.',
    pt: 'Enjoo de invocação: esta criatura chegou neste turno e ainda não pode atacar.',
  },
  notYours: {
    en: 'That’s the Upkeeper’s. You only control your own cards.',
    pt: 'Essa é do Upkeeper. Você só mexe nas suas cartas.',
  },
  continue: {
    en: 'The Upkeeper is talking: click Continue when you’re done reading.',
    pt: 'O Upkeeper está falando: clique em Continuar quando terminar de ler.',
  },
  follow: {
    en: 'Follow the Upkeeper’s tip: what glows gold is the next step.',
    pt: 'Siga a dica do Upkeeper: o que brilha em dourado é o próximo passo.',
  },
} satisfies Record<string, L>

/** Por que esse clique não vale agora (para a dica) */
function whyNot(s: TState, step: Step, target: Target): L {
  const own = step.wrong?.[target]
  if (own) return own
  if (!step.click) return UI.continue
  if (s.you.hand.includes(target)) {
    const d = def(target)
    if (d.kind === 'land') return s.you.landPlayed ? UI.oneLand : s.phase !== 'main1' && s.phase !== 'main2' ? UI.mainOnly : UI.follow
    if (d.kind !== 'instant' && s.phase !== 'main1' && s.phase !== 'main2') return UI.mainOnly
    if (!canPay(s.you, d.cost)) return UI.noMana
    return UI.follow
  }
  const mine = s.you.field.find((c) => c.id === target)
  if (mine) {
    const d = def(target)
    if (d.kind === 'land' && mine.tapped) return UI.tapped
    if (d.kind === 'creature' && mine.sick && s.phase === 'combat' && s.active === 'you') return UI.sick
    return UI.follow
  }
  if (s.opp.field.some((c) => c.id === target)) return UI.notYours
  return UI.follow
}

function reducer(run: Run, action: Action): Run {
  if (action.type === 'restart') return start()
  const step = STEPS[run.i]
  if (action.type === 'next') {
    if (run.i >= STEPS.length - 1) return run
    const i = run.i + 1
    return { i, s: enterStep(i, run.s), done: [], busy: false, hint: null }
  }
  if (run.busy) return run
  const { target } = action
  if (step.click?.includes(target) && !run.done.includes(target)) {
    const s = clone(run.s)
    step.act?.(s, target)
    const done = [...run.done, target]
    return { ...run, s, done, busy: done.length >= (step.need ?? 1), hint: null }
  }
  return { ...run, hint: { text: whyNot(run.s, step, target), at: Date.now() } }
}

// ------------------------------------------------------------------ Página

const TEXT = {
  title: { en: 'Tutorial', pt: 'Tutorial' },
  you: { en: 'You', pt: 'Você' },
  upkeeper: { en: 'Upkeeper', pt: 'Upkeeper' },
  library: { en: 'Library', pt: 'Grimório' },
  graveyard: { en: 'Graveyard', pt: 'Cemitério' },
  hand: { en: 'Hand', pt: 'Mão' },
  mana: { en: 'Mana pool', pt: 'Reserva de mana' },
  mulligan: { en: 'Mulligan', pt: 'Mulligan' },
  keep: { en: 'Keep', pt: 'Manter' },
  combat: { en: 'Combat', pt: 'Combate' },
  attack: { en: 'Attack', pt: 'Atacar' },
  pass: { en: 'Pass turn', pt: 'Passar o turno' },
  next: { en: 'Continue', pt: 'Continuar' },
  restart: { en: 'Start over', pt: 'Recomeçar' },
  exit: { en: 'Leave tutorial', pt: 'Sair do tutorial' },
  learned: { en: 'What you’ve learned', pt: 'O que você aprendeu' },
  learnedNone: { en: 'The terms you learn show up here.', pt: 'Os termos que você aprender aparecem aqui.' },
  yourTurn: { en: 'Turn {n} · your turn', pt: 'Turno {n} · sua vez' },
  oppTurn: { en: 'Turn {n} · Upkeeper’s turn', pt: 'Turno {n} · vez do Upkeeper' },
  setup: { en: 'Before the game', pt: 'Antes da partida' },
  casting: { en: 'Casting… choose the target', pt: 'Conjurando… escolha o alvo' },
  victory: { en: 'Victory!', pt: 'Vitória!' },
  playNow: { en: 'Open a table', pt: 'Abrir uma mesa' },
  again: { en: 'Play the tutorial again', pt: 'Jogar o tutorial de novo' },
  commanderTitle: { en: 'What changes in Commander', pt: 'O que muda no Commander' },
  commander: [
    { en: '100-card decks, one copy of each card (except basic lands).', pt: 'Decks de 100 cartas, uma cópia de cada (fora os terrenos básicos).' },
    {
      en: 'A legendary creature is your **commander**: it starts in the command zone and you can cast it from there.',
      pt: 'Uma criatura lendária é o seu **comandante**: ela começa na zona de comando e você pode conjurá-la de lá.',
    },
    { en: '**40** life and usually 3 or 4 players at the table.', pt: '**40** de vida e, em geral, 3 ou 4 jogadores na mesa.' },
    { en: 'The first mulligan is free.', pt: 'O primeiro mulligan é de graça.' },
  ],
  step: { en: 'Step {i} of {n}', pt: 'Passo {i} de {n}' },
} satisfies Record<string, L | L[]>

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k) => String(vars[k] ?? m))

/** O que fica aceso: alvos que faltam clicar (dourado) e o que a fala comenta (azul) */
function glowFor(step: Step, done: Target[], busy: boolean) {
  return (target: Target): 'target' | 'spot' | null =>
    !busy && step.click?.includes(target) && !done.includes(target) ? 'target' : step.spot?.includes(target) ? 'spot' : null
}

export default function TutorialPage() {
  const { lang } = useI18n()
  const { user } = useAuth()
  const lg = lang as Lang
  const tx = (text: L) => pick(text, lg)
  useTitle(tx(TEXT.title))
  const [run, dispatch] = useReducer(reducer, undefined, start)
  const [hover, setHover] = useState<string | null>(null)
  const { s, i } = run
  const step = STEPS[i]
  const glow = glowFor(step, run.done, run.busy)
  const click = (target: Target) => dispatch({ type: 'click', target })

  // Clique certo que fecha o passo: uma pausa curta para ver o efeito, e a aula segue
  useEffect(() => {
    if (!run.busy) return
    const id = setTimeout(() => dispatch({ type: 'next' }), 650)
    return () => clearTimeout(id)
  }, [run.busy])

  // A dica de clique errado some sozinha
  const [hintSeen, setHintSeen] = useState(0)
  useEffect(() => {
    if (!run.hint) return
    const at = run.hint.at
    const id = setTimeout(() => setHintSeen(at), 4500)
    return () => clearTimeout(id)
  }, [run.hint])
  const hint = run.hint && run.hint.at !== hintSeen ? run.hint : null

  useEffect(() => {
    if (step.finish) writeJSON(TUTORIAL_DONE_KEY, true)
  }, [step.finish])

  // Celular: a mesa rola; traz para a vista o que precisa ser clicado agora, e a fala nova
  // aparece no topo do painel
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = 0
    const id = requestAnimationFrame(() =>
      document.querySelector('.tut-target')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }),
    )
    return () => cancelAnimationFrame(id)
  }, [i, run.done.length])

  // Enter/espaço = Continuar (quando a fala não pede clique)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (step.click || step.finish || e.repeat) return
      if (e.key === 'Enter' || e.key === ' ') {
        if ((e.target as HTMLElement).closest('button, a, input')) return
        e.preventDefault()
        dispatch({ type: 'next' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  const learned = [...new Set(STEPS.slice(0, i + 1).flatMap((st) => st.learn ?? []))] as TermKey[]
  const fresh = new Set(step.learn ?? [])
  const name = user?.username ?? tx(TEXT.you)

  // Botões de ação do seu lado, conforme a fase
  const actions: { key: Target; label: L; primary?: boolean }[] =
    s.phase === 'setup'
      ? s.you.hand.length
        ? [
            { key: 'mulligan', label: TEXT.mulligan },
            { key: 'keep', label: TEXT.keep, primary: true },
          ]
        : []
      : s.active !== 'you'
        ? []
        : s.phase === 'main1'
          ? [
              { key: 'combat', label: TEXT.combat },
              { key: 'pass', label: TEXT.pass, primary: true },
            ]
          : s.phase === 'combat' && !s.declared
            ? [{ key: 'attack', label: TEXT.attack, primary: true }]
            : s.phase === 'main2'
              ? [{ key: 'pass', label: TEXT.pass, primary: true }]
              : []

  const turnLabel =
    s.phase === 'setup' ? tx(TEXT.setup) : fill(tx(s.active === 'you' ? TEXT.yourTurn : TEXT.oppTurn), { n: s.turn })
  const lands = (list: FieldCard[]) => list.filter((c) => def(c.id).kind === 'land')
  const creatures = (list: FieldCard[]) => list.filter((c) => def(c.id).kind !== 'land')
  const field = (c: FieldCard) => (
    <FieldCardView key={c.id} card={c} lang={lg} glow={glow(c.id)} onClick={() => click(c.id)} onHover={setHover} />
  )
  const graveyardPile = (ids: string[]) => (
    <Pile label={tx(TEXT.graveyard)} count={ids.length} glow={ids.some((id) => step.spot?.includes(id)) ? 'spot' : null}>
      {ids.length ? (
        <span
          className="block h-full w-full"
          onMouseEnter={() => setHover(ids[ids.length - 1])}
          onMouseLeave={() => setHover(null)}
        >
          <CardImg id={ids[ids.length - 1]} lang={lg} className="opacity-90 grayscale-[30%]" />
        </span>
      ) : (
        <EmptySlot />
      )}
    </Pile>
  )
  const won = !!step.finish

  return (
    <div className="tutorial-root flex h-dvh flex-col bg-ink [--cw:46px] sm:[--cw:58px] lg:flex-row lg:[--cw:min(70px,6.6dvh)] xl:[--cw:min(82px,7dvh)] 2xl:[--cw:min(92px,7.6dvh)]">
      {/* ------------------------------------------------------------ Mesa */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto bg-[radial-gradient(ellipse_at_50%_45%,#1b1a14_0%,#0d0d0f_65%)]">
        {/* Upkeeper: jogador, mão (verso), grimório e cemitério */}
        <div className="flex items-start justify-between gap-3 border-b border-line/70 px-3 py-2 sm:px-5">
          <PlayerBadge
            name={tx(TEXT.upkeeper)}
            life={s.opp.life}
            upkeeper
            active={s.active === 'opp' && s.phase !== 'setup'}
            hitKey={s.hit?.who === 'opp' ? s.hit.at : undefined}
          />
          <div className="flex min-w-0 flex-1 justify-center overflow-hidden pt-1" aria-label={`${tx(TEXT.hand)}: ${s.opp.hand.length}`}>
            {s.opp.hand.map((id, n) => (
              <CardBackView
                key={id}
                className="-ml-[calc(var(--cw)*0.55)] first:ml-0"
                style={{ width: 'calc(var(--cw) * 0.62)', height: 'calc(var(--cw) * 0.62 * 1.396)', zIndex: n }}
              />
            ))}
          </div>
          <div className="flex items-start gap-2">
            {graveyardPile(s.opp.graveyard)}
            <Pile label={tx(TEXT.library)} count={s.opp.library}>
              <CardBackView />
            </Pile>
          </div>
        </div>

        {/* Campo do Upkeeper (espelhado: terrenos longe de você) */}
        <section className="flex flex-1 flex-col justify-center gap-3 px-3 py-3 sm:px-6">
          <div className="flex min-h-[calc(var(--cw)*1.4)] flex-wrap items-center justify-center gap-2">
            {lands(s.opp.field).map(field)}
          </div>
          <div className="flex min-h-[calc(var(--cw)*1.4)] flex-wrap items-center justify-center gap-3">
            {creatures(s.opp.field).map(field)}
          </div>
        </section>

        {/* Meio: fases do turno e a mágica sendo conjurada */}
        <div className="relative flex flex-col items-center gap-2 border-y border-gold/15 bg-black/30 px-2 py-2">
          <PhaseBar
            phase={s.phase === 'setup' ? 'setup' : s.phase}
            lang={lg}
            label={turnLabel}
            glow={!!step.learn?.some((k) => k === 'phases' || k === 'untap' || k === 'upkeep' || k === 'draw')}
          />
          {s.casting && (
            <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-2 rounded-lg border border-gold/50 bg-ink/90 p-1.5 pr-3 shadow-lg animate-[tut-enter_0.3s_ease-out]">
              <span style={{ width: 'calc(var(--cw) * 0.7)', height: 'calc(var(--cw) * 0.7 * 1.396)' }}>
                <CardImg id={s.casting} lang={lg} />
              </span>
              <span className="max-w-28 text-xs leading-snug font-semibold text-gold">{tx(TEXT.casting)}</span>
            </div>
          )}
        </div>

        {/* Seu campo: criaturas na frente, terrenos perto de você */}
        <section className="flex flex-1 flex-col justify-center gap-3 px-3 py-3 sm:px-6">
          <div className="flex min-h-[calc(var(--cw)*1.4)] flex-wrap items-center justify-center gap-3">
            {creatures(s.you.field).map(field)}
          </div>
          <div className="flex min-h-[calc(var(--cw)*1.4)] flex-wrap items-center justify-center gap-2">
            {lands(s.you.field).map(field)}
          </div>
        </section>

        {/* Você: jogador, reserva de mana, ações, cemitério e grimório */}
        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line/70 px-3 pt-2 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <PlayerBadge
              name={name}
              life={s.you.life}
              active={s.active === 'you' && s.phase !== 'setup'}
              hitKey={s.hit?.who === 'you' ? s.hit.at : undefined}
            />
            <ManaPool side={s.you} label={tx(TEXT.mana)} glow={!!step.learn?.includes('mana')} />
          </div>
          <div className="flex items-center gap-2">
            {actions.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => click(a.key)}
                className={`h-10 rounded-full px-5 text-sm font-semibold transition ${
                  glow(a.key) === 'target' ? 'tut-target' : ''
                } ${a.primary ? 'btn-ember hover:brightness-110' : 'border border-parchment/25 bg-ink/70 text-parchment hover:border-gold/60 hover:text-gold'}`}
              >
                {a.key === 'attack' && <Swords className="mr-1.5 inline h-4 w-4 align-[-3px]" aria-hidden />}
                {tx(a.label)}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            {graveyardPile(s.you.graveyard)}
            <Pile label={tx(TEXT.library)} count={s.you.library} glow={glow('library')} onClick={() => click('library')}>
              <CardBackView />
            </Pile>
          </div>
        </div>

        {/* Sua mão */}
        <div
          className="flex min-h-[calc(var(--cw)*1.15*1.396+1.5rem)] items-end justify-center gap-1.5 overflow-x-auto px-3 pt-3 pb-3 sm:gap-2"
          aria-label={tx(TEXT.hand)}
        >
          {s.you.hand.map((id) => (
            <HandCardView key={id} id={id} lang={lg} glow={glow(id)} onClick={() => click(id)} onHover={setHover} />
          ))}
        </div>

        {/* Carta ampliada ao passar o mouse (computador) */}
        {hover && <CardZoom id={hover} lang={lg} />}

        {won && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/45 animate-[fade-in_0.6s_ease-out]">
            <div className="flex flex-col items-center gap-2 text-center">
              <Trophy className="h-14 w-14 text-gold drop-shadow-[0_0_18px_rgb(236_185_63/0.7)]" aria-hidden />
              <p className="font-epic text-metal text-5xl font-bold tracking-wide sm:text-6xl">{tx(TEXT.victory)}</p>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ Upkeeper falando */}
      <aside className="flex max-h-[40dvh] shrink-0 flex-col border-t border-line bg-surface/60 lg:max-h-none lg:w-[24rem] lg:border-t-0 lg:border-l xl:w-[26rem]">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
          <span className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-gold uppercase">
            <BookOpen className="h-4 w-4" aria-hidden />
            {tx(TEXT.title)}
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => dispatch({ type: 'restart' })}
              title={tx(TEXT.restart)}
              aria-label={tx(TEXT.restart)}
              className="grid h-8 w-8 place-items-center rounded-full text-parchment/60 transition hover:bg-parchment/5 hover:text-gold"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </button>
            <Link
              to="/"
              title={tx(TEXT.exit)}
              aria-label={tx(TEXT.exit)}
              className="grid h-8 w-8 place-items-center rounded-full text-parchment/60 transition hover:bg-parchment/5 hover:text-gold"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </Link>
          </span>
        </div>
        {/* Progresso */}
        <div className="h-1 bg-line" aria-hidden>
          <div className="h-full bg-gold transition-[width] duration-500" style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} />
        </div>

        <div ref={panel} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {/* Fala */}
          <div className="flex gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-gold/70 bg-[radial-gradient(circle,#3a2a12,#09090b)] shadow-[0_0_18px_-4px_rgb(236_185_63/0.6)]">
              <img src="/logo-mark.webp" alt="" className="h-8 w-8 object-contain" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline justify-between gap-2">
                <span className="font-epic text-sm font-semibold tracking-wide text-gold">Upkeeper</span>
                <span className="text-[0.65rem] text-parchment/40 tabular-nums">
                  {fill(tx(TEXT.step), { i: i + 1, n: STEPS.length })}
                </span>
              </p>
              <p
                key={step.id}
                aria-live="polite"
                className="relative mt-1.5 rounded-xl rounded-tl-sm border border-line bg-ink/80 px-3.5 py-3 text-[0.95rem] leading-relaxed text-parchment/90 animate-[fade-in_0.35s_ease-out]"
              >
                <Rich text={tx(step.say)} />
              </p>
              {hint && (
                <p
                  key={hint.at}
                  role="status"
                  className="mt-2 rounded-lg border border-amber-400/40 bg-amber-950/40 px-3 py-2 text-sm text-amber-100 animate-[fade-in_0.25s_ease-out]"
                >
                  <Rich text={tx(hint.text)} />
                </p>
              )}
              {!step.click && !won && (
                <button
                  type="button"
                  autoFocus
                  onClick={() => dispatch({ type: 'next' })}
                  className="btn-ember mt-3 h-10 w-full rounded-full text-sm font-semibold transition hover:brightness-110"
                >
                  {tx(step.next ?? TEXT.next)}
                </button>
              )}
            </div>
          </div>

          {won && <Victory lang={lg} onAgain={() => dispatch({ type: 'restart' })} />}

          {/* Glossário */}
          <section>
            <h2 className="flex items-center gap-2 text-[0.7rem] font-semibold tracking-[0.2em] text-parchment/55 uppercase">
              {tx(TEXT.learned)}
              <span className="rounded-full bg-parchment/10 px-1.5 text-parchment/70 tabular-nums">
                {learned.length}/{Object.keys(TERMS).length}
              </span>
            </h2>
            {learned.length ? (
              <ul className="mt-2 space-y-1.5">
                {learned
                  .slice()
                  .reverse()
                  .map((k) => (
                    <li
                      key={k}
                      className={`rounded-lg border px-3 py-2 text-sm transition ${
                        fresh.has(k) ? 'border-gold/50 bg-gold/5 animate-[fade-in_0.4s_ease-out]' : 'border-line bg-ink/40'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 font-semibold text-parchment">
                        <Check className="h-3.5 w-3.5 text-gold" aria-hidden />
                        {tx(TERMS[k].name)}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-parchment/60">{tx(TERMS[k].text)}</span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-parchment/40">{tx(TEXT.learnedNone)}</p>
            )}
          </section>
        </div>
      </aside>
    </div>
  )
}

/** Carta ampliada: imagem grande, tipo e texto (só em telas com mouse) */
function CardZoom({ id, lang }: { id: string; lang: Lang }) {
  const d = def(id)
  return (
    <div className="pointer-events-none absolute top-1/2 left-3 z-20 hidden w-56 -translate-y-1/2 flex-col gap-2 [@media(hover:hover)]:flex xl:w-64">
      <span className="block aspect-[488/680] w-full">
        <CardImg id={id} lang={lang} className="rounded-[4.5%] shadow-2xl" />
      </span>
      <div className="rounded-lg border border-line bg-ink/95 px-3 py-2 text-xs leading-relaxed">
        <p className="font-semibold text-parchment">{d.name[lang]}</p>
        <p className="text-parchment/55">{d.type[lang]}</p>
        {d.text && (
          <p className="mt-1 text-parchment/80">
            <Rich text={d.text[lang]} />
          </p>
        )}
      </div>
    </div>
  )
}

function Victory({ lang, onAgain }: { lang: Lang; onAgain: () => void }) {
  const tx = (text: L) => pick(text, lang)
  return (
    <div className="space-y-3 rounded-xl border border-gold/40 bg-gold/5 p-4 animate-[fade-in_0.5s_ease-out]">
      <Link
        to="/"
        className="btn-ember flex h-11 items-center justify-center gap-2 rounded-full text-sm font-semibold transition hover:brightness-110"
      >
        <Swords className="h-4 w-4" aria-hidden />
        {tx(TEXT.playNow)}
      </Link>
      <button
        type="button"
        onClick={onAgain}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-parchment/25 text-sm font-semibold text-parchment transition hover:border-gold/60 hover:text-gold"
      >
        <RotateCcw className="h-4 w-4" aria-hidden />
        {tx(TEXT.again)}
      </button>
      <div>
        <p className="font-epic text-sm font-semibold tracking-wide text-gold">{tx(TEXT.commanderTitle)}</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed text-parchment/75">
          {TEXT.commander.map((line, n) => (
            <li key={n}>
              <Rich text={tx(line)} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
