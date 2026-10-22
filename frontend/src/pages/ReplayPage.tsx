import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Gauge,
  LogOut,
  Pause,
  Play,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { logText } from '../components/table/logText'
import { IconButton } from '../components/table/TableKit'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { fmtClock } from '../lib/duration'
import { useI18n } from '../lib/i18n'
import { replayNamed, replaySteps, replayTable, replayText, type ReplayEvent } from '../lib/replay'
import { isMuted, logSound, playSound, setMuted, type SoundName } from '../lib/tableSounds'
import { ReplayRoom } from './TablePage'

// Tocar sozinho: tempo em cada ação (o botão de velocidade passa de uma para a outra)
const SPEEDS = [
  { ms: 2000, label: 'Slow' },
  { ms: 1000, label: 'Normal' },
  { ms: 450, label: 'Fast' },
]

/**
 * O som de cada ação ao avançar: os mesmos da mesa (compra, embaralhar, dado, turno, carta entrando
 * no campo...) e, aqui, também carta mudando de zona (cemitério, exílio, mão)
 */
function replaySound(e: ReplayEvent): SoundName | null {
  const moved = e.kind === 'move' || e.kind === 'move_many' || e.kind === 'draw_to' || e.kind === 'search_put'
  return moved && e.to !== 'battlefield' ? 'draw' : logSound(e)
}

/**
 * Rever uma partida encerrada, ação a ação e turno a turno, com a própria mesa (TablePage:
 * ReplayRoom): o campo de cada jogador depois de cada ação, do jeito que se via jogando, com as
 * cartas que a ação mexeu brilhando. Os controles (voltar, avançar, tocar) ficam na barra da
 * esquerda, onde ficam os da mesa; à direita, o que aconteceu em cada turno, no lugar do chat. Só
 * quem jogou vê. Dá para baixar em texto.
 */
export default function ReplayPage() {
  const { id = '' } = useParams()
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const replay = useQuery({ queryKey: ['replay', id], queryFn: () => api.replay(id), retry: false })
  const r = useMemo(() => (replay.data ? replayNamed(replay.data) : undefined), [replay.data])
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
  const [speed, setSpeed] = useState(1)
  const [muted, setMutedState] = useState(isMuted)
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
  const manual = (n: number) => {
    setPlaying(false)
    go(n)
  }

  // Tocando: uma ação por vez, para no fim
  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => setIndex(i + 1), SPEEDS[speed].ms)
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

  // Como o chat da mesa: a lista vai até a ação atual e fica rolada para baixo (rola só a lista)
  useEffect(() => {
    const box = list.current
    if (box) box.scrollTop = box.scrollHeight
  }, [i])

  // Som de cada ação ao avançar uma por vez (tocando ou na próxima ação); pular não toca
  const heard = useRef(0)
  useEffect(() => {
    const prev = heard.current
    heard.current = i
    if (i !== prev + 1 || !r || !step || step.event === null) return
    const sound = replaySound(r.turns[step.turn].events[step.event])
    if (sound) playSound(sound)
  }, [i, r, step])

  // A mesa deste passo: as cartas que a ação mexeu (e a carta citada no registro) brilham
  const table = useMemo(() => {
    if (!r || !step) return null
    const turn = r.turns[step.turn]
    const event = step.event === null ? null : turn.events[step.event]
    const lit = new Set(step.cards)
    const named = event?.card
    const onField = named
      ? (step.boards.find((b) => b.seat === event?.seat)?.field.find((c) => c.name === named) ??
        step.boards.flatMap((b) => b.field).find((c) => c.name === named))
      : undefined
    if (onField?.id) lit.add(onField.id)
    return replayTable(r, step, lit)
  }, [r, step])

  if (replay.isPending) return <p className="py-16 text-center text-parchment/60">{t('Loading…')}</p>
  if (!r || !step || !table)
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center text-parchment/70">
        <p>{t('This game is not available. Only the players can see it, and it is kept for 6 months.')}</p>
        <Link to="/history" className="text-gold underline">
          {t('My history')}
        </Link>
      </div>
    )

  const turn = r.turns[step.turn]
  const download = () => {
    const blob = new Blob([replayText(r, t, locale)], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `upkeeper-partida-${r.id}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const controls = (
    <>
      <IconButton icon={LogOut} label={t('Back to my history')} tipSide="right" onClick={() => navigate('/history')} />
      <span className="mx-1 h-6 w-px bg-line lg:mx-0 lg:my-1 lg:h-px lg:w-6" aria-hidden />
      <IconButton
        icon={ChevronsLeft}
        label={t('Previous turn')}
        hotkey="Shift+←"
        tipSide="right"
        disabled={i === 0}
        onClick={() => {
          setPlaying(false)
          prevTurn()
        }}
      />
      <IconButton
        icon={ChevronLeft}
        label={t('Previous action')}
        hotkey="←"
        tipSide="right"
        disabled={i === 0}
        onClick={() => manual(i - 1)}
      />
      <IconButton
        icon={playing ? Pause : Play}
        label={playing ? t('Pause') : t('Autoplay')}
        hotkey={t('Space')}
        tipSide="right"
        active={playing}
        onClick={togglePlay}
      />
      <IconButton
        icon={ChevronRight}
        label={t('Next action')}
        hotkey="→"
        tipSide="right"
        disabled={i >= last}
        onClick={() => manual(i + 1)}
      />
      <IconButton
        icon={ChevronsRight}
        label={t('Next turn')}
        hotkey="Shift+→"
        tipSide="right"
        disabled={step.turn >= r.turns.length - 1}
        onClick={() => {
          setPlaying(false)
          nextTurn()
        }}
      />
      <IconButton
        icon={Gauge}
        label={`${t('Speed')}: ${t(SPEEDS[speed].label)}`}
        tipSide="right"
        onClick={() => setSpeed((speed + 1) % SPEEDS.length)}
      />
      <span className="mx-1 h-6 w-px bg-line lg:mx-0 lg:my-1 lg:h-px lg:w-6" aria-hidden />
      <IconButton
        icon={muted ? VolumeX : Volume2}
        label={muted ? t('Sound off') : t('Sound on')}
        tipSide="right"
        onClick={() => {
          setMuted(!muted)
          setMutedState(!muted)
        }}
      />
      <IconButton icon={Download} label={t('Download as text')} tipSide="right" onClick={download} />
    </>
  )

  const side = (
    <>
      {/* Como o quadro da mesa: a partida, o turno e a ação */}
      <div className="rounded-lg border border-line bg-surface px-3 py-2">
        <p className="font-display truncate text-lg leading-tight">{t('Game replay')}</p>
        <p className="truncate text-[0.7rem] text-parchment/50">
          {new Date(r.finished_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
          {t('{n} turns · {time}', { n: r.turns.length, time: fmtClock(r.ended - r.started) })}
        </p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[0.7rem] text-gold">
          <Trophy className="h-3 w-3 shrink-0" aria-hidden />
          {r.winner ? t('{name} won', { name: r.winner }) : t('No winner')}
        </p>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <select
            value={step.turn}
            onChange={(e) => manual(starts[Number(e.target.value)])}
            aria-label={t('Jump to turn')}
            className="min-w-0 flex-1 rounded-md border border-line bg-ink px-1.5 py-1 text-xs"
          >
            {r.turns.map((tn, ti) => (
              <option key={ti} value={ti}>
                {t('Turn {n}', { n: tn.turn })}
                {tn.player ? ` · ${tn.player}` : ''}
              </option>
            ))}
          </select>
          {turn.took != null && <span className="text-parchment/50 tabular-nums">{fmtClock(turn.took)}</span>}
        </div>
        <input
          type="range"
          min={0}
          max={last}
          value={i}
          onChange={(e) => manual(Number(e.target.value))}
          aria-label={t('Moment of the game')}
          className="mt-2 w-full accent-[#e4572e]"
        />
        <p className="text-[0.7rem] text-parchment/50 tabular-nums">
          {step.event !== null
            ? t('Action {a} of {n}', { a: step.event + 1, n: turn.events.length })
            : t('End of turn')}
        </p>
      </div>

      {/* O que aconteceu: no lugar do chat, com a altura toda */}
      <section className="flex min-h-[12rem] flex-1 flex-col rounded-lg border border-line bg-surface">
        <h2 className="border-b border-line px-3 py-2 text-xs font-semibold tracking-wide text-parchment/60 uppercase">
          {t('What happened')}
        </h2>
        <ul ref={list} className="relative min-h-0 flex-1 overflow-y-auto p-2 text-sm">
          {r.turns.slice(0, step.turn + 1).map((tn, ti) => {
            // Turno atual: até a ação em que está; os anteriores, inteiros
            const shown = ti < step.turn || step.event === null ? tn.events : tn.events.slice(0, step.event + 1)
            const current = ti === step.turn
            return (
              <li key={ti} className="mb-1.5">
                <button
                  onClick={() => manual(starts[ti])}
                  className="sticky top-0 z-10 flex w-full items-center gap-2 bg-surface py-1 text-left text-[0.68rem] font-semibold tracking-wide text-parchment/50 uppercase hover:text-gold"
                >
                  <span className="h-px flex-1 bg-line" aria-hidden />
                  {t('Turn {n}', { n: tn.turn })}
                  {tn.player ? ` · ${tn.player}` : ''}
                  <span className="h-px flex-1 bg-line" aria-hidden />
                </button>
                <ul className="space-y-0.5">
                  {tn.events.length === 0 && (
                    <li className="px-1.5 text-parchment/40">{t('Nothing recorded in this turn.')}</li>
                  )}
                  {shown.map((e, ei) => (
                    <li key={ei}>
                      <button
                        onClick={() => manual(starts[ti] + ei)}
                        className={`w-full rounded px-1.5 py-0.5 text-left ${
                          current && step.event === ei
                            ? 'bg-gold/15 text-parchment'
                            : 'text-parchment/70 hover:bg-parchment/[0.05]'
                        }`}
                      >
                        {logText(t, e)}
                      </button>
                    </li>
                  ))}
                  {current && step.event === null && (
                    <li className="rounded bg-gold/15 px-1.5 py-0.5 text-xs tracking-wide text-parchment uppercase">
                      {t('End of turn')}
                    </li>
                  )}
                </ul>
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )

  return <ReplayRoom table={table} controls={controls} side={side} />
}
