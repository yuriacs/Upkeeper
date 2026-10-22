import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Pause, Play, Trophy } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { logText } from '../components/table/logText'
import { ReplayBoard } from '../components/table/ReplayBoard'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { fmtClock } from '../lib/duration'
import { useI18n } from '../lib/i18n'
import { cardImage } from '../lib/cardImage'
import { replayImages, replaySteps, replayText, type ReplayBoard as Board, type ReplayCard } from '../lib/replay'

// Tocar sozinho: tempo em cada ação
const SPEEDS = [
  { ms: 2000, label: 'Slow' },
  { ms: 1000, label: 'Normal' },
  { ms: 450, label: 'Fast' },
]

/**
 * Rever uma partida encerrada, ação a ação e turno a turno, numa mesa como a da partida: o campo de
 * cada jogador depois de cada ação (o seu embaixo, os oponentes em cima), a vida, as contagens e o
 * texto da ação no registro. As cartas que a ação mexeu brilham e a carta dela aparece grande ao
 * lado (ou a que estiver sob o mouse). Dá para tocar sozinho e pular para um turno. Só quem jogou
 * vê. Dá para baixar em texto.
 */
export default function ReplayPage() {
  const { id = '' } = useParams()
  const { t, locale } = useI18n()
  const replay = useQuery({
    queryKey: ['replay', id],
    queryFn: () => api.replay(id),
    retry: false,
  })
  const r = replay.data
  const steps = useMemo(() => (r ? replaySteps(r) : []), [r])
  // Primeiro passo de cada turno (para pular de turno)
  const starts = useMemo(() => {
    const out: number[] = []
    steps.forEach((s, i) => {
      if (out[s.turn] === undefined) out[s.turn] = i
    })
    return out
  }, [steps])
  const [index, setIndex] = useState(0)
  const [playingState, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1000)
  const [hover, setHover] = useState<ReplayCard | null>(null)
  const images = useMemo(() => (r ? replayImages(r) : new Map<string, string>()), [r])
  const list = useRef<HTMLUListElement>(null)
  useTitle(t('Game replay'))
  const last = Math.max(0, steps.length - 1)
  const i = Math.min(index, last)
  const step = steps[i]
  const playing = playingState && i < last // tocando para sozinho no fim

  const go = (n: number) => setIndex(Math.max(0, Math.min(last, n)))
  const prevTurn = () => {
    if (!step) return
    const start = starts[step.turn]
    go(i > start ? start : (starts[step.turn - 1] ?? 0))
  }
  const nextTurn = () => step && go(starts[step.turn + 1] ?? last)
  const togglePlay = () => {
    if (!playing && i >= last) setIndex(0) // do fim: recomeça
    setPlaying(!playing)
  }

  // Tocando: uma ação por vez, para no fim
  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => setIndex(i + 1), speed)
    return () => window.clearTimeout(timer)
  }, [playing, i, speed])

  // Teclado: ← → ação, Shift + ← → turno, espaço toca ou pausa
  const keys = useRef({ prevTurn, nextTurn, togglePlay, last })
  useEffect(() => {
    keys.current = { prevTurn, nextTurn, togglePlay, last }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const k = keys.current
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setPlaying(false)
        if (e.shiftKey) k.prevTurn()
        else setIndex((n) => Math.max(0, Math.min(k.last, n) - 1)) // tecla repetida: conta do valor atual
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setPlaying(false)
        if (e.shiftKey) k.nextTurn()
        else setIndex((n) => Math.min(k.last, n + 1))
      } else if (e.key === ' ' && tag !== 'BUTTON') {
        e.preventDefault()
        k.togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A ação atual fica à vista na lista (rola só a lista, não a página)
  useEffect(() => {
    const box = list.current
    const el = box?.querySelector<HTMLElement>('[data-current]')
    if (!box || !el) return
    if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop - 8
    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight + 8
  }, [i])

  if (replay.isPending) return <p className="text-center text-parchment/60">{t('Loading…')}</p>
  if (!r || !step)
    return (
      <p className="text-center text-parchment/60">
        {t('This game is not available. Only the players can see it, and it is kept for 6 months.')}
      </p>
    )

  const turn = r.turns[step.turn]
  const event = step.event === null ? null : turn.events[step.event]
  const download = () => {
    const blob = new Blob([replayText(r, t, locale)], {
      type: 'text/plain;charset=utf-8',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `upkeeper-partida-${r.id}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const player = (b: Board) => r.players.find((p) => p.seat === b.seat)
  // A carta da ação: no campo de quem fez (brilha), em outro campo, ou só a imagem (foi para o cemitério...)
  const named = event?.card
  const onField = named
    ? (step.boards.find((b) => b.seat === event?.seat)?.field.find((c) => c.name === named) ??
      step.boards.flatMap((b) => b.field).find((c) => c.name === named))
    : undefined
  const lit = new Set(step.cards)
  // Sem o nome no registro (pôr do topo no campo...): a carta que acendeu, de preferência a de quem fez
  const litCards = step.boards
    .flatMap((b) => b.field.map((c) => ({ c, mine: b.seat === event?.seat })))
    .filter(({ c }) => c.id && lit.has(c.id))
  const firstLit = (litCards.find((x) => x.mine) ?? litCards[0])?.c
  const actionCard: ReplayCard | null =
    onField ??
    (named && images.get(named) ? { name: named, image: images.get(named) } : ((event ? firstLit : null) ?? null))
  if (onField?.id) lit.add(onField.id)
  const shown = hover ?? actionCard
  // O seu campo embaixo (como na mesa); os oponentes em cima, espelhados
  const youSeat = r.you ?? r.players[0]?.seat
  const mine = step.boards.find((b) => b.seat === youSeat) ?? step.boards[0]
  const others = step.boards.filter((b) => b !== mine)
  const board = (b: Board, facing: boolean) => (
    <ReplayBoard
      key={b.seat}
      board={b}
      player={player(b)}
      facing={facing}
      active={player(b)?.name === turn.player}
      changed={step.changed.includes(b.seat)}
      lit={lit}
      onHover={setHover}
    />
  )
  const btn = 'rounded-full border border-line p-1.5 hover:border-parchment/40 disabled:opacity-30'
  const manual = (n: number) => {
    setPlaying(false)
    go(n)
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold tracking-[0.3em] text-gold uppercase">{t('Game replay')}</p>
          <h1 className="font-display text-3xl text-parchment">{r.players.map((p) => p.name).join(' × ')}</h1>
          <p className="text-sm text-parchment/60">
            {new Date(r.finished_at).toLocaleString(locale, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}{' '}
            ·{' '}
            {t('{n} turns · {time}', {
              n: r.turns.length,
              time: fmtClock(r.ended - r.started),
            })}
          </p>
          <p className="flex items-center gap-1.5 text-sm text-gold">
            <Trophy className="h-4 w-4" aria-hidden />
            {r.winner ? t('{name} won', { name: r.winner }) : t('No winner')}
          </p>
        </div>
        <button
          onClick={download}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:border-parchment/40"
        >
          <Download className="h-4 w-4" aria-hidden />
          {t('Download as text')}
        </button>
      </header>

      <div className="space-y-3 rounded-lg border border-line bg-surface/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setPlaying(false)
              prevTurn()
            }}
            disabled={i === 0}
            aria-label={t('Previous turn')}
            title={t('Previous turn')}
            className={btn}
          >
            <ChevronsLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            onClick={() => manual(i - 1)}
            disabled={i === 0}
            aria-label={t('Previous action')}
            title={t('Previous action')}
            className={btn}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            onClick={togglePlay}
            aria-label={playing ? t('Pause') : t('Autoplay')}
            title={playing ? t('Pause') : t('Autoplay')}
            className="rounded-full bg-gold p-2 text-ink hover:bg-gold/90"
          >
            {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          </button>
          <button
            onClick={() => manual(i + 1)}
            disabled={i >= last}
            aria-label={t('Next action')}
            title={t('Next action')}
            className={btn}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          <button
            onClick={() => {
              setPlaying(false)
              nextTurn()
            }}
            disabled={step.turn >= r.turns.length - 1}
            aria-label={t('Next turn')}
            title={t('Next turn')}
            className={btn}
          >
            <ChevronsRight className="h-4 w-4" aria-hidden />
          </button>
          <select
            value={step.turn}
            onChange={(e) => manual(starts[Number(e.target.value)])}
            aria-label={t('Jump to turn')}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
          >
            {r.turns.map((tn, ti) => (
              <option key={ti} value={ti}>
                {t('Turn {n}', { n: tn.turn })}
                {tn.player ? ` · ${tn.player}` : ''}
              </option>
            ))}
          </select>
          <span className="text-sm text-parchment/60">{turn.took != null && fmtClock(turn.took)}</span>
          <label className="ml-auto flex items-center gap-2 text-sm text-parchment/60">
            {t('Speed')}
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-parchment"
            >
              {SPEEDS.map((s) => (
                <option key={s.ms} value={s.ms}>
                  {t(s.label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input
          type="range"
          min={0}
          max={last}
          value={i}
          onChange={(e) => manual(Number(e.target.value))}
          aria-label={t('Moment of the game')}
          className="w-full accent-[#ecb93f]"
        />
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-xl tabular-nums">{t('Turn {n}', { n: turn.turn })}</span>
          <span className="text-xs text-parchment/50 tabular-nums">
            {event
              ? t('Action {a} of {n}', {
                  a: (step.event ?? 0) + 1,
                  n: turn.events.length,
                })
              : t('End of turn')}
          </span>
          <span className="min-w-0 flex-1 text-sm text-parchment">
            {event ? logText(t, event) : turn.player ? t("{name}'s turn", { name: turn.player }) : ''}
          </span>
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-2">
          <div
            className={`grid gap-2 ${others.length > 1 ? 'md:grid-cols-2' : ''} ${others.length > 2 ? '2xl:grid-cols-3' : ''}`}
          >
            {others.map((b) => board(b, false))}
          </div>
          {mine && board(mine, true)}
        </div>
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <section className="rounded-lg border border-line bg-surface/60 p-3">
            {shown?.image && !shown.face_down ? (
              <img
                src={cardImage(shown.image, 300)}
                alt={shown.name}
                className="mx-auto w-full max-w-[15rem] rounded-[4.5%] shadow-lg shadow-black/60"
              />
            ) : (
              <p className="py-6 text-center text-xs text-parchment/40">
                {shown?.face_down ? t('a face-down card') : t('Point at a card to see it bigger.')}
              </p>
            )}
          </section>
          <section className="space-y-2 rounded-lg border border-line bg-surface/60 p-3">
            <h2 className="text-xs font-semibold tracking-wide text-parchment/60 uppercase">{t('What happened')}</h2>
            {turn.events.length === 0 && (
              <p className="text-sm text-parchment/40">{t('Nothing recorded in this turn.')}</p>
            )}
            <ul ref={list} className="relative max-h-[22rem] space-y-0.5 overflow-y-auto text-sm">
              {turn.events.map((e, ei) => (
                <li key={ei} data-current={step.event === ei || undefined}>
                  <button
                    onClick={() => manual(starts[step.turn] + ei)}
                    className={`w-full rounded px-1.5 py-0.5 text-left ${
                      step.event === ei ? 'bg-gold/15 text-parchment' : 'text-parchment/70 hover:bg-parchment/[0.05]'
                    }`}
                  >
                    {logText(t, e)}
                  </button>
                </li>
              ))}
              <li data-current={step.event === null || undefined}>
                <button
                  onClick={() => manual(starts[step.turn] + turn.events.length)}
                  className={`w-full rounded px-1.5 py-0.5 text-left text-xs tracking-wide uppercase ${
                    step.event === null ? 'bg-gold/15 text-parchment' : 'text-parchment/50 hover:bg-parchment/[0.05]'
                  }`}
                >
                  {t('End of turn')}
                </button>
              </li>
            </ul>
          </section>
        </aside>
      </div>
      <p className="text-xs text-parchment/40">
        {t(
          'The table shows each player’s battlefield after the selected action; the cards it touched glow. Arrow keys: previous and next action; Shift + arrows: turn; space: play or pause.',
        )}
      </p>
    </section>
  )
}
