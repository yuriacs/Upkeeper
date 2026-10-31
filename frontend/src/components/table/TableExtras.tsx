import { useEffect, useRef, useState } from 'react'
import type { LogItem } from '../../hooks/useTableSocket'
import { useT } from '../../lib/i18n'
import { logSound, playSound } from '../../lib/tableSounds'
import { Coins, Dices, Megaphone, ThumbsUp } from 'lucide-react'
import { ToolbarMenu } from './ToolbarMenu'
import { useTable } from './tableUtils'

/*
 * O que aparece sozinho durante a partida: carta revelada, dados, setas de alvo, sinais e o fim da
 * partida. As janelas que alguém abre ficam em TableDialogs (carregadas sob demanda).
 */

/** Carta revelada: aparece para todos por alguns segundos (vem do log, então chega a todo mundo). */
export function RevealOverlay({ entry, onDone }: { entry: LogItem; onDone: () => void }) {
  const t = useT()
  useEffect(() => {
    const timer = setTimeout(onDone, entry.cards && entry.cards.length > 1 ? 7000 : 4500)
    return () => clearTimeout(timer)
  }, [entry, onDone])
  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-black/40">
      <div className="animate-[flip-in_0.35s_ease-out] text-center">
        <p className="mb-3 text-sm font-semibold text-parchment/80">
          {entry.cards && entry.cards.length > 1
            ? t('{who} revealed the top {n} cards of their library', { who: entry.who, n: entry.cards.length })
            : entry.frm === 'library'
              ? t('{who} revealed the top card of their library', { who: entry.who })
              : t('{who} revealed', { who: entry.who })}
        </p>
        {entry.cards && entry.cards.length > 1 ? (
          <div className="flex max-w-[90vw] flex-wrap justify-center gap-3">
            {entry.cards.map((c, i) => (
              <img
                key={i}
                src={c.image}
                alt={c.name}
                className={`${entry.cards!.length > 5 ? 'w-36' : 'w-48'} rounded-[4.5%] shadow-2xl shadow-black`}
              />
            ))}
          </div>
        ) : (
          entry.image && (
            <img src={entry.image} alt={entry.card ?? ''} className="w-72 rounded-[4.5%] shadow-2xl shadow-black" />
          )
        )}
      </div>
    </div>
  )
}

/** Dados e moeda: o resultado sai do servidor e aparece no log para todos. */
export function DiceMenu() {
  const t = useT()
  const { send } = useTable()
  // Dado personalizado ("d?"): o jogador escolhe quantos lados (2 a 1000)
  const [sides, setSides] = useState('100')
  const n = Math.round(Number(sides))
  const valid = Number.isFinite(n) && n >= 2 && n <= 1000
  return (
    <ToolbarMenu
      icon={Dices}
      label={t('Dice')}
      rows={[
        { icon: Coins, label: t('Flip a coin'), hotkey: 'Shift+C', onClick: () => send({ type: 'roll', sides: 2 }) },
        { text: 'd6', label: t('Roll a d{sides}', { sides: 6 }), hotkey: '`', onClick: () => send({ type: 'roll', sides: 6 }) },
        {
          text: 'd20',
          label: t('Roll a d{sides}', { sides: 20 }),
          hotkey: 'Shift+`',
          onClick: () => send({ type: 'roll', sides: 20 }),
        },
      ]}
      extra={(close) => (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid) return
            send({ type: 'roll', sides: n })
            close()
          }}
          className="flex items-center gap-2 border-t border-line px-3 pt-1.5 pb-1 text-xs text-parchment/60"
        >
          {t('Custom die')}
          <span className="ml-auto">d</span>
          <input
            type="number"
            min={2}
            max={1000}
            value={sides}
            onChange={(e) => setSides(e.target.value)}
            aria-label={t('Number of sides')}
            className="w-14 rounded border border-line bg-transparent px-1 py-0.5 text-center"
          />
          <button
            disabled={!valid}
            className="rounded border border-line px-2 py-0.5 transition enabled:hover:border-gold enabled:hover:text-gold disabled:opacity-40"
          >
            {t('Roll')}
          </button>
        </form>
      )}
    />
  )
}


/**
 * Setas de alvo ("Mirar…"): da carta até a carta ou o jogador mirado, por alguns segundos, na
 * tela de todos. As posições vêm da própria página (data-card-id e data-seat-avatar), então a
 * seta acompanha a carta se o campo mudar de tamanho.
 */
export function TargetArrows({ log, start }: { log: LogItem[]; start: number | null }) {
  const [seen, setSeen] = useState(0)
  const [, setFrame] = useState(0)
  const active = log.filter((e) => e.kind === 'target' && e.ref && (e.id ?? 0) > Math.max(start ?? Infinity, seen))
  const lastId = active.at(-1)?.id ?? 0
  useEffect(() => {
    if (!lastId) return
    let raf = 0
    const loop = () => {
      setFrame((f) => (f + 1) % 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    playSound('target')
    const timer = setTimeout(() => setSeen(lastId), 5000)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [lastId])
  if (!active.length) return null
  const center = (selector: string) => {
    const el = document.querySelector(selector)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
  }
  const arrows = active.flatMap((e) => {
    const from = center(`[data-card-id="${e.ref}"]`)
    const to = e.to_ref ? center(`[data-card-id="${e.to_ref}"]`) : center(`[data-seat-avatar="${e.to_seat}"]`)
    if (!from || !to) return []
    // Para um pouco antes do centro do alvo, para a ponta não ficar escondida
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.max(1, Math.hypot(dx, dy))
    const end = { x: to.x - (dx / len) * 18, y: to.y - (dy / len) * 18 }
    return [{ id: e.id, from, to: end, target: to }]
  })
  return (
    <svg className="pointer-events-none fixed inset-0 z-[35] h-full w-full" aria-hidden>
      <defs>
        <marker id="target-head" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#e4572e" />
        </marker>
      </defs>
      {arrows.map((a) => (
        <g key={a.id}>
          <line
            x1={a.from.x}
            y1={a.from.y}
            x2={a.to.x}
            y2={a.to.y}
            stroke="#000"
            strokeOpacity={0.6}
            strokeWidth={8}
            strokeLinecap="round"
          />
          <line
            x1={a.from.x}
            y1={a.from.y}
            x2={a.to.x}
            y2={a.to.y}
            stroke="#e4572e"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray="10 6"
            markerEnd="url(#target-head)"
            className="animate-[dash_0.8s_linear_infinite]"
          />
          <circle cx={a.from.x} cy={a.from.y} r={7} fill="#e4572e" stroke="#000" strokeWidth={2} />
          <circle cx={a.target.x} cy={a.target.y} r={22} fill="none" stroke="#e4572e" strokeWidth={3} />
        </g>
      ))}
    </svg>
  )
}

/**
 * Aviso rápido de um jogador (Alerta ou Sem resposta), no alto da mesa por um instante, para todos.
 * Não bloqueia nada: a mesa continua clicável por baixo.
 */
export function SignalBanner({ entry, onDone }: { entry: LogItem; onDone: () => void }) {
  const t = useT()
  useEffect(() => {
    const timer = setTimeout(onDone, 2500)
    return () => clearTimeout(timer)
  }, [entry, onDone])
  const alert = entry.what === 'alert'
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center px-4">
      <div
        role="status"
        className={`flex animate-[flip-in_0.3s_ease-out] items-center gap-3 rounded-xl border px-6 py-3 shadow-2xl shadow-black ${
          alert ? 'border-red-400/70 bg-red-950/95 text-red-100' : 'border-emerald-400/60 bg-emerald-950/95 text-emerald-100'
        }`}
      >
        {alert ? <Megaphone className="h-6 w-6 text-red-300" aria-hidden /> : <ThumbsUp className="h-6 w-6 text-emerald-300" aria-hidden />}
        <p className="text-lg">
          <span className="font-semibold">{entry.who}</span>
          {': '}
          {alert ? t('Alert! I have a response') : t('No response')}
        </p>
      </div>
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
      const sound = logSound(e)
      if (sound) playSound(sound)
    }
    last.current = Math.max(last.current, log.at(-1)?.id ?? 0)
  }, [log, start])
  return null
}

/** Fim de partida: aparece para todos, com a opção de jogar de novo com os mesmos decks. */
export function GameOverOverlay({
  winner,
  fromDraw,
  onNewGame,
  onClose,
}: {
  winner: string | null
  fromDraw: boolean
  onNewGame: () => void
  onClose: () => void
}) {
  const t = useT()
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-label={t('Game over')}
        className="w-full max-w-md animate-[flip-in_0.4s_ease-out] rounded-2xl border border-gold/60 bg-ink p-6 text-center shadow-2xl shadow-black"
      >
        <p className="text-5xl" aria-hidden>
          🏆
        </p>
        <p className="mt-2 text-sm tracking-wide text-parchment/60 uppercase">{t('Game over')}</p>
        <p className="font-display mt-1 text-4xl text-gold">
          {winner ? t('{name} won!', { name: winner }) : t('No winner')}
        </p>
        {fromDraw && winner && (
          <p className="mt-2 text-xs text-parchment/50">{t('Result saved to the deal and the ranking.')}</p>
        )}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            onClick={onNewGame}
            className="rounded-md btn-ember px-4 py-2 text-sm font-semibold text-ink hover:brightness-110"
          >
            {t('Play again (same decks)')}
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-line px-4 py-2 text-sm hover:border-parchment/40"
          >
            {t('Look at the table')}
          </button>
        </div>
      </div>
    </div>
  )
}
