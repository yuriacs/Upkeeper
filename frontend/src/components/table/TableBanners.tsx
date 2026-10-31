import { useEffect, useState } from 'react'
import { Hand, Power, Undo2, Trophy } from 'lucide-react'
import { smallImage } from '../../lib/cardImage'
import { actionText, logText } from './logText'
import { CardBack } from './TableKit'
import {
  type CloseRequest,
  type EndRequest,
  type UndoRequest,
  type ControlRequest,
} from '../../hooks/useTableSocket'
import { useT } from '../../lib/i18n'

const IDLE_WARN = 120

/** Liga de torneio: quanto falta para a partida poder começar */
export function StartWait({ lock, left }: { lock: { seated: number; needed: number; left: number | null }; left: number | null }) {
  const t = useT()
  const clock = left != null ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''
  return (
    <p className="mt-2 rounded-md bg-gold/10 px-2 py-1 text-xs text-gold" role="status">
      {lock.left == null
        ? t('Waiting for a 2nd player to sit down ({seated}/{needed}).', { seated: lock.seated, needed: lock.needed })
        : t('The match can start in {clock}, or as soon as everyone is seated ({seated}/{needed}).', {
            clock,
            seated: lock.seated,
            needed: lock.needed,
          })}
    </p>
  )
}

export function IdleWarning({ closesAt, onKeep }: { closesAt: number; onKeep: () => void }) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, Math.ceil((closesAt - now) / 1000))
  if (left > IDLE_WARN) return null
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold"
    >
      <span>{t('No changes for a while: this table closes in {time}.', { time: clock })}</span>
      <button
        onClick={onKeep}
        className="rounded-full bg-gold px-3 py-0.5 text-xs font-semibold text-ink transition hover:brightness-110"
      >
        {t('Keep table open')}
      </button>
    </div>
  )
}

/**
 * Pedido de desfazer aberto: quem pediu espera (e pode desistir); cada jogador conectado aprova ou
 * recusa; os demais só acompanham. Fica no topo da mesa até todos responderem ou expirar.
 */
/**
 * Fim de partida esperando confirmação: quem pediu pode desistir; outro jogador sentado confirma
 * (a vitória conta e a mesa fecha) ou recusa. Quem assiste só vê.
 */
export function EndBanner({
  request,
  you,
  seated,
  onVote,
}: {
  request: EndRequest
  you: number
  seated: boolean
  onVote: (approve: boolean) => void
}) {
  const t = useT()
  const mine = request.by === you
  const result = request.placings
    ? request.placings.map((p, i) => `${i + 1}. ${p.name}`).join(' · ')
    : request.winner_name
      ? t('{name} won', { name: request.winner_name })
      : t('No winner')
  return (
    <div
      role="alertdialog"
      aria-label={t('End the game')}
      className="fixed top-20 left-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-gold/60 bg-ink/95 p-4 shadow-2xl shadow-black"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-gold">
        <Trophy className="h-4 w-4" aria-hidden />
        {mine ? t('You asked to end the game') : t('{name} wants to end the game', { name: request.name })}
      </p>
      <p className="font-display mt-1 text-2xl text-parchment">{result}</p>
      <p className="mt-1 text-xs text-parchment/60">
        {t('Another player confirms: the result counts and the table closes.')}
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {mine ? (
          <>
            <span className="mr-auto self-center text-xs text-parchment/50">{t('Waiting for another player…')}</span>
            <button
              onClick={() => onVote(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-parchment/80 hover:border-parchment/40"
            >
              {t('Cancel')}
            </button>
          </>
        ) : seated ? (
          <>
            <button
              onClick={() => onVote(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-parchment/80 hover:border-red-400/60 hover:text-red-300"
            >
              {t('Decline')}
            </button>
            <button
              onClick={() => onVote(true)}
              className="rounded-md btn-ember px-4 py-1.5 text-sm font-semibold text-ink hover:brightness-110"
            >
              {t('Confirm and end')}
            </button>
          </>
        ) : (
          <span className="text-xs text-parchment/50">{t('Waiting for a player to confirm…')}</span>
        )}
      </div>
    </div>
  )
}

/** Pedido de fechar a mesa: outro jogador sentado confirma (basta um) ou recusa */
export function CloseBanner({
  request,
  you,
  seated,
  onVote,
}: {
  request: CloseRequest
  you: number
  seated: boolean
  onVote: (approve: boolean) => void
}) {
  const t = useT()
  const mine = request.by === you
  return (
    <div
      role="alertdialog"
      aria-label={t('Close the table')}
      className="fixed top-20 left-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-red-400/60 bg-ink/95 p-4 shadow-2xl shadow-black"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-red-300">
        <Power className="h-4 w-4" aria-hidden />
        {mine ? t('You asked to close the table') : t('{name} wants to close the table', { name: request.name })}
      </p>
      <p className="mt-1 text-xs text-parchment/60">
        {t('Another player confirms and the table closes for everyone. No result is recorded.')}
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {mine ? (
          <>
            <span className="mr-auto self-center text-xs text-parchment/50">{t('Waiting for another player…')}</span>
            <button
              onClick={() => onVote(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-parchment/80 hover:border-parchment/40"
            >
              {t('Cancel')}
            </button>
          </>
        ) : seated ? (
          <>
            <button
              onClick={() => onVote(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-parchment/80 hover:border-parchment/40"
            >
              {t('Keep playing')}
            </button>
            <button
              onClick={() => onVote(true)}
              className="rounded-md bg-red-500/90 px-4 py-1.5 text-sm font-semibold text-ink hover:brightness-110"
            >
              {t('Close the table')}
            </button>
          </>
        ) : (
          <span className="text-xs text-parchment/50">{t('Waiting for a player to confirm…')}</span>
        )}
      </div>
    </div>
  )
}

export function UndoBanner({
  request,
  you,
  onVote,
}: {
  request: UndoRequest
  you: number
  onVote: (approve: boolean) => void
}) {
  const t = useT()
  const action = request.kind === 'rewind' ? logText(t, request.entry) : actionText(t, request.entry)
  const mine = request.by === you
  const myVote = request.needed.find((n) => n.id === you)
  const waiting = request.needed.filter((n) => !n.approved).map((n) => n.name)
  return (
    <div
      role="alertdialog"
      aria-label={t('Undo request')}
      className="fixed top-20 left-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-gold/60 bg-ink/95 p-4 shadow-2xl shadow-black"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-gold">
        <Undo2 className="h-4 w-4" aria-hidden />
        {request.kind === 'rewind'
          ? mine
            ? t('You asked to take the table back to')
            : t('{name} wants to take the table back to', { name: request.name })
          : mine
            ? t('You asked to undo')
            : t('{name} wants to undo', { name: request.name })}
      </p>
      <p className="mt-1 text-parchment">{action}</p>
      <p className="mt-2 text-xs text-parchment/60">
        {request.needed.map((n) => (
          <span key={n.id} className={`mr-3 ${n.approved ? 'text-emerald-400' : ''}`}>
            {n.approved ? '✓' : '…'} {n.name}
          </span>
        ))}
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {mine ? (
          <>
            <span className="mr-auto self-center text-xs text-parchment/50">
              {t('Waiting for {names}', { names: waiting.join(', ') })}
            </span>
            <button
              onClick={() => onVote(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-parchment/80 hover:border-parchment/40"
            >
              {t('Cancel')}
            </button>
          </>
        ) : myVote && !myVote.approved ? (
          <>
            <button
              onClick={() => onVote(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-parchment/80 hover:border-red-400/60 hover:text-red-300"
            >
              {t('Decline')}
            </button>
            <button
              onClick={() => onVote(true)}
              className="rounded-md btn-ember px-4 py-1.5 text-sm font-semibold text-ink hover:brightness-110"
            >
              {request.kind === 'rewind' ? t('Allow going back') : t('Allow undo')}
            </button>
          </>
        ) : (
          <span className="text-xs text-parchment/50">{t('Waiting for {names}', { names: waiting.join(', ') })}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Pedidos de controle (canto de baixo, à direita): quem controla a carta aceita ou recusa; quem
 * pediu vê que está esperando. Somem sozinhos quando vencem.
 */
export function ControlRequests({
  requests,
  you,
  onAnswer,
}: {
  requests: ControlRequest[]
  you: number
  onAnswer: (card: string, accept: boolean) => void
}) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(id)
  }, [])
  // Margem para a diferença entre o relógio daqui e o do servidor
  const open = requests.filter((r) => r.until + 5 > now)
  if (!open.length) return null
  return (
    <div className="fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {open.map((r) => {
        const asking = r.to === you
        const name = r.name || t('a face-down card')
        return (
          <div
            key={r.card}
            role={asking ? 'alertdialog' : 'status'}
            aria-label={t('Control request')}
            className="flex gap-3 rounded-xl border border-gold/60 bg-ink/95 p-3 shadow-2xl shadow-black"
          >
            {r.image ? (
              <img src={smallImage(r.image)} alt="" className="w-14 shrink-0 self-start rounded-[6%]" />
            ) : (
              <CardBack width={56} />
            )}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-gold">
                <Hand className="h-3.5 w-3.5" aria-hidden />
                {t('Control request')}
                <span className="ml-auto font-normal text-parchment/40 tabular-nums">
                  {Math.max(0, Math.round(r.until - now))}s
                </span>
              </p>
              <p className="mt-1 text-sm text-parchment">
                {asking
                  ? t('{name} asks for control of {card}', { name: r.from_name, card: name })
                  : t('You asked {name} for control of {card}', { name: r.to_name, card: name })}
              </p>
              {asking ? (
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={() => onAnswer(r.card, false)}
                    className="rounded-md border border-line px-3 py-1 text-sm text-parchment/80 hover:border-red-400/60 hover:text-red-300"
                  >
                    {t('Decline')}
                  </button>
                  <button
                    onClick={() => onAnswer(r.card, true)}
                    className="rounded-md btn-ember px-3 py-1 text-sm font-semibold text-ink hover:brightness-110"
                  >
                    {t('Give control')}
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-parchment/50">{t('Waiting for an answer…')}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** "Seu turno": desvirar tudo e comprar com um clique (Enter), ou deixar automático. */
export function TurnPrompt({
  turn,
  onAction,
  onAuto,
}: {
  turn: number
  onAction: (untap: boolean, draw: boolean) => void
  onAuto: () => void
}) {
  const t = useT()
  useEffect(() => {
    // Um botão em foco (ex.: "Passar o turno") também reagiria ao Enter: tira o foco dele
    const focused = document.activeElement
    if (focused instanceof HTMLButtonElement) focused.blur()
  }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && ['INPUT', 'TEXTAREA'].includes(el.tagName)) return // Enter no chat não compra carta
      if (e.key === 'Enter') {
        e.preventDefault()
        onAction(true, true)
      } else if (e.key === 'Escape') onAction(false, false)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onAction])
  const btn =
    'rounded-md border border-line px-3 py-1.5 text-sm transition hover:border-parchment/40 hover:bg-parchment/10'
  return (
    <div
      role="alertdialog"
      aria-label={t('Your turn')}
      className="fixed top-24 left-1/2 z-40 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 animate-[flip-in_0.3s_ease-out] rounded-xl border border-gold/60 bg-ink/95 p-4 text-center shadow-2xl shadow-black"
    >
      <p className="font-display text-3xl text-gold">{t('Your turn')}</p>
      <p className="text-xs text-parchment/50">{t('Turn {n}', { n: turn })}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <button
          onClick={() => onAction(true, true)}
          className="rounded-md btn-ember px-3 py-1.5 text-sm font-semibold text-ink transition hover:brightness-110"
        >
          {t('Untap all + draw')} <span className="opacity-60">(Enter)</span>
        </button>
        <button onClick={() => onAction(true, false)} className={btn}>
          {t('Only untap')}
        </button>
        <button onClick={() => onAction(false, false)} className={btn}>
          {t('Not now')}
        </button>
      </div>
      <button
        onClick={() => {
          onAuto()
          onAction(true, true)
        }}
        className="mt-3 text-xs text-parchment/50 underline hover:text-gold"
      >
        {t('Always do it automatically')}
      </button>
    </div>
  )
}
