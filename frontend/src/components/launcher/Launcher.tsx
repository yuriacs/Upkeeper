import { ArrowRight, Eye, Swords } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useT } from '@/lib/i18n'
import type { MyTable } from '@/lib/types'
import CardCarousel from './CardCarousel'
import CardScatter from './CardScatter'
import MagicWord from './MagicWord'
import ModeSelect from './ModeSelect'

/** Brasas da placa: posição, deriva, tamanho e ritmo de cada uma (fixos, espalhados) */
const EMBERS = Array.from({ length: 18 }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin((i + 1) * n * 12.9898) * 43758.5453
    return x - Math.floor(x)
  }
  return { x: 8 + r(1) * 88, dx: (r(2) - 0.5) * 50, size: 2 + r(3) * 3, dur: 1.2 + r(4) * 1.2, delay: r(5) * 1.4 }
})

/** Uma mesa no painel da esquerda: código, situação e lugares ocupados numa barra */
function TableItem({ table, mine }: { table: MyTable; mine: boolean }) {
  const t = useT()
  const seated = table.players.length
  const full = seated >= table.max_seats
  const to = !mine && full ? `/mesa/${table.code}?assistir=1` : `/mesa/${table.code}`
  return (
    <li>
      <Link
        to={to}
        className="group flex items-center gap-3 rounded-md border border-transparent bg-gradient-to-r from-parchment/[0.07] to-transparent px-2.5 py-2 transition hover:border-gold/30 hover:from-gold/15"
      >
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded border ${
            mine ? 'border-gold/60 bg-gold/15 text-gold' : 'border-parchment/20 bg-black/40 text-parchment/70'
          }`}
        >
          {!mine && full ? <Eye className="h-4 w-4" aria-hidden /> : <Swords className="h-4 w-4" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2 text-[0.8rem]">
            <span className="truncate font-semibold text-parchment/90">
              {mine ? t('Your table {code}', { code: table.code }) : t('Table {code}', { code: table.code })}
            </span>
            <span className="shrink-0 text-[0.7rem] text-parchment/55 tabular-nums">
              {seated}/{table.max_seats}
            </span>
          </span>
          <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-parchment/10">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-gold/60 to-gold shadow-[0_0_8px_rgb(236_185_63/0.7)]"
              style={{ width: `${(seated / table.max_seats) * 100}%` }}
            />
          </span>
          <span className="mt-1 block text-[0.68rem] text-parchment/45">
            {table.finished ? t('Game over') : table.turn ? t('Turn {n}', { n: table.turn }) : t('Waiting to start')}
          </span>
        </span>
      </Link>
    </li>
  )
}

/**
 * Capa da página Jogar no estilo de tela de jogo, sobre o tabuleiro de uma partida: à esquerda o
 * título com a palavra mágica e as mesas abertas; à direita o carrossel de comandantes, entrar
 * com código e a placa dourada que abre uma mesa nova. Atalhos: N (mesa nova), J (código),
 * P (modos de jogo) e D (sortear).
 */
export default function Launcher({
  mine,
  others,
  playersOnline,
  onNewTable,
}: {
  mine: MyTable[]
  others: MyTable[]
  playersOnline: number
  onNewTable: () => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const [modes, setModes] = useState(false)
  const [code, setCode] = useState('')
  const codeRef = useRef<HTMLInputElement>(null)
  const list = [...mine.map((tb) => ({ tb, mine: true })), ...others.map((tb) => ({ tb, mine: false }))].slice(0, 4)
  const total = mine.length + others.length

  const join = (e: FormEvent) => {
    e.preventDefault()
    const clean = code.trim().toUpperCase()
    if (/^[A-Z0-9]{4,12}$/.test(clean)) navigate(`/mesa/${clean}`)
  }

  // Atalhos de teclado, como num jogo (fora de campos de texto e de janelas abertas)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('[role="dialog"]')) return
      const key = e.key.toLowerCase()
      if (key === 'n') onNewTable()
      else if (key === 'p') setModes(true)
      else if (key === 'd') navigate('/sortear')
      else if (key === 'j') {
        e.preventDefault()
        codeRef.current?.focus()
      } else return
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, onNewTable])

  const hints: [string, string][] = [
    ['N', t('New table')],
    ['J', t('Join')],
    ['P', t('Game modes')],
    ['D', t('Deal decks')],
  ]

  return (
    <section className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden bg-ink">
      {/* Fundo: cartas de comandantes sorteadas, espalhadas */}
      <CardScatter className="-z-20" />
      {/* Vinheta: escurece as bordas e o lado do título, como na tela de um jogo */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_60%_45%,transparent_35%,rgb(0_0_0/0.75)_100%)]" />
      <div aria-hidden className="absolute inset-y-0 left-0 -z-10 w-2/3 bg-gradient-to-r from-black/70 to-transparent" />

      {/* Ancorado nas bordas da tela (como a interface de um jogo), na mesma largura do cabeçalho */}
      <div className="hero-exit mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-5 pt-32 pb-8 sm:px-8 lg:px-16">
        {/* Topo: título e mesas abertas à esquerda, carrossel de cartas à direita */}
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          {/* Título no formato de capa de jogo: linha pequena, linha grande, linha pequena */}
          <div className="launcher-title max-w-3xl">
            <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.35em] text-gold uppercase">
              <span aria-hidden className="flex items-center gap-1.5">
                <span className="h-px w-8 bg-gradient-to-r from-gold/0 to-gold" />
                <span className="h-1.5 w-1.5 rotate-45 bg-gold" />
              </span>
              {t('Commander online')}
            </p>
            <h1 className="font-epic mt-5 font-semibold text-parchment uppercase">
              <span className="block text-[clamp(1.3rem,2.1vw,2rem)] tracking-[0.22em] text-parchment/85">
                {t('Play Magic with')}
              </span>
              <span className="mt-1 block text-[clamp(2.6rem,4.3vw,4.5rem)] leading-[1.02] tracking-[0.02em]">
                {t('your')} <MagicWord words={[t('friends'), t('enemies'), t('allies'), t('rivals'), t('heroes'), t('demons'), t('dragons')]} />
              </span>
              <span className="mt-2 block text-[clamp(1.3rem,2.1vw,2rem)] tracking-[0.22em] text-parchment/85">
                {t('right in the browser')}
              </span>
            </h1>
            {/* Divisor ornamental */}
            <span aria-hidden className="mt-6 flex items-center gap-2">
              <span className="h-px w-16 bg-gradient-to-r from-gold/70 to-gold/10" />
              <span className="h-2 w-2 rotate-45 border border-gold/70" />
              <span className="h-px w-6 bg-gold/20" />
            </span>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-parchment/70 sm:text-lg">
              {t('Open a table, send the link and play Commander with official precons or your own decks. No install.')}
            </p>
            {/* Opções para abrir uma mesa: entrar com código e a placa */}
            <form onSubmit={join} className="mt-8 flex items-center gap-3">
              <label htmlFor="launcher-code" className="text-[0.7rem] font-semibold tracking-[0.2em] text-parchment/70 uppercase">
                {t('Join with code')}
              </label>
              <input
                id="launcher-code"
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ABC123"
                maxLength={12}
                className="h-10 w-32 min-w-0 rounded-md border border-parchment/20 bg-black/50 px-3 text-center tracking-[0.25em] uppercase backdrop-blur placeholder:text-parchment/25 focus:border-gold focus:outline-none"
              />
              <button
                aria-label={t('Join')}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-parchment/20 bg-black/50 text-parchment/80 backdrop-blur transition hover:border-gold hover:text-gold"
              >
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </form>
            {/* Placa: abre uma mesa nova, encostada na borda esquerda. No hover, brasas sobem dela */}
            <div className="bleed-left group relative mt-4 w-fit max-w-full">
              <button
                type="button"
                onClick={onNewTable}
                className="play-plate is-left bleed-left-pad relative flex h-24 w-full items-center gap-5 overflow-hidden pr-24"
              >
                {/* Ícone: três cartas com o símbolo do Magic; no hover, as de trás abrem para os lados */}
                <span aria-hidden className="card-fan">
                  {['fan-left', 'fan-right', 'fan-front'].map((k) => (
                    <span key={k} className={`fan-card ${k}`}>
                      <span className="fan-inner">
                        <i className="ms ms-planeswalker" />
                      </span>
                    </span>
                  ))}
                </span>
                <span className="flex flex-col items-start">
                  <span className="font-epic text-metal text-[clamp(1.6rem,2.6vw,2.3rem)] leading-none font-bold tracking-wide whitespace-nowrap">
                    {t('Start a game')}
                  </span>
                  <span className="mt-2 flex items-center gap-2 text-[0.68rem] font-semibold tracking-[0.25em] text-gold/75 uppercase">
                    <span aria-hidden className="h-1.5 w-1.5 rotate-45 bg-gold/70" />
                    {t('Commander · 2 to 4 players · free')}
                  </span>
                </span>
                {/* Seta que avança no hover */}
                <ArrowRight aria-hidden className="plate-arrow ml-2 h-6 w-6 shrink-0 text-gold" />
              </button>
              <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-full">
                {EMBERS.map((e, i) => (
                  <span
                    key={i}
                    className="plate-ember"
                    style={
                      {
                        left: `${e.x}%`,
                        '--dx': `${e.dx}px`,
                        '--size': `${e.size}px`,
                        '--dur': `${e.dur}s`,
                        '--delay': `${e.delay}s`,
                      } as CSSProperties
                    }
                  />
                ))}
              </span>
            </div>
            {/* Atalhos de teclado, logo abaixo da placa */}
            <div className="mt-4 hidden flex-wrap items-center gap-x-5 gap-y-2 text-[0.66rem] font-semibold tracking-[0.15em] text-parchment/60 uppercase lg:flex">
              {hints.map(([key, label]) => (
                <span key={key} className="flex items-center gap-2">
                  <span className="keycap">{key}</span>
                  {label}
                </span>
              ))}
            </div>
            {/* Mesas abertas, logo abaixo da descrição (só em telas altas: nas baixas a lista completa vem logo abaixo) */}
            <div className="mt-10 hidden w-80 lg:tall:block">
              <div className="flex items-baseline justify-between border-b border-parchment/10 pb-2">
                <h2 className="font-epic text-sm font-semibold tracking-[0.12em] text-parchment">{t('Open tables')}</h2>
                <span className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-gold">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  {t('{n} online', { n: playersOnline })}
                </span>
              </div>
              {list.length ? (
                <ul className="mt-3 space-y-2">
                  {list.map(({ tb, mine: isMine }) => (
                    <TableItem key={tb.code} table={tb} mine={isMine} />
                  ))}
                </ul>
              ) : (
                <p className="mt-3 rounded-md bg-gradient-to-r from-parchment/[0.07] to-transparent px-3 py-3 text-[0.8rem] text-parchment/60">
                  {t('No open tables right now.')}
                </p>
              )}
              {total > list.length && (
                <a href="#open-tables" className="mt-2 inline-block text-[0.72rem] text-parchment/50 hover:text-gold">
                  {t('See all {n} tables ↓', { n: total })}
                </a>
              )}
            </div>
          </div>
          {/* Direita: carrossel de comandantes em alta */}
          <CardCarousel className="lg:mt-2 lg:w-[min(40vw,640px)]" />
        </div>

        {/* Embaixo: a linha das mesas, à direita */}
        <div className="mt-auto pt-10">
          <div className="flex justify-end border-t border-parchment/10 pt-4">
            <p className="flex items-center gap-4 text-xs font-semibold tracking-[0.12em] text-parchment/70 uppercase">
              <span>{total === 1 ? t('1 open table') : t('{n} open tables', { n: total })}</span>
              <span className="flex items-center gap-1.5">
                {t('Online')} {playersOnline}
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153/0.9)]" />
              </span>
            </p>
          </div>
        </div>
      </div>

      <ModeSelect open={modes} onOpenChange={setModes} onNewTable={onNewTable} />
    </section>
  )
}
