import { useEffect, useRef, useState } from 'react'
import { Search, Users, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { queueLabel, useMatchQueue } from '../hooks/useMatchQueue'
import { callAttention } from '../lib/attention'
import { fmtClock } from '../lib/duration'
import { useT } from '../lib/i18n'
import { readJSON, writeJSON } from '../lib/storage'
import { playSound } from '../lib/tableSounds'

const SEEN_KEY = 'precon-draft:queue-notice'

/**
 * Fila "Achar partida" em qualquer página: enquanto você espera, um aviso no canto com o tempo e o
 * botão de sair; quando a mesa abre, vai para ela (com som e, em outra aba, título piscando e
 * notificação). Fora da fila, avisa quando tem gente procurando partida, com o botão para entrar
 * junto. O aviso some ao fechar e só volta se aparecer mais gente.
 */
export default function MatchQueue() {
  const t = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { status, join, leave } = useMatchQueue()
  const [, redraw] = useState(0)

  // Mesa achada: vai para ela e sai da fila (o servidor guarda o aviso por alguns minutos)
  const match = status?.match
  const went = useRef<string | null>(null)
  useEffect(() => {
    if (!match || went.current === match) return
    went.current = match
    playSound('join')
    callAttention(t('Game found!'), { title: t('Game found!'), body: t('Your table is open.'), tag: `queue-${match}` })
    leave.mutate()
    navigate(`/table/${match}`)
  }, [match, navigate, leave, t])

  // Relógio da espera
  const mine = status?.mine
  const [since, setSince] = useState(0)
  useEffect(() => {
    if (!mine) return
    setSince(Date.now() - mine.waited * 1000)
    const id = window.setInterval(() => redraw((n) => n + 1), 1000)
    return () => window.clearInterval(id)
    // só quando entra na fila (waited muda a cada consulta)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!mine])

  // Gente procurando partida: avisa uma vez por quantidade (fecha e só volta se crescer)
  const waiting = status?.waiting ?? []
  const best = waiting[0]
  const total = waiting.reduce((n, w) => n + w.count, 0)
  const [seen, setSeen] = useState(() => readJSON<number>(SEEN_KEY, 0))
  useEffect(() => {
    if (total < seen) {
      setSeen(total)
      writeJSON(SEEN_KEY, total)
    }
  }, [total, seen])
  const onTable = pathname.startsWith('/table/') || pathname.startsWith('/replay/')

  if (mine)
    return (
      <div
        role="status"
        className="fixed bottom-4 left-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-gold/50 bg-ink/95 px-3 py-2 shadow-2xl shadow-black/70 backdrop-blur"
      >
        <Search className="h-4 w-4 shrink-0 animate-pulse text-gold" aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">{t('Looking for a game…')}</p>
          <p className="truncate text-xs text-parchment/55">
            {queueLabel(t, mine)} · {fmtClock(Math.max(0, Math.round((Date.now() - since) / 1000)))}
          </p>
        </div>
        <button
          onClick={() => leave.mutate()}
          className="rounded-md border border-line px-2 py-1 text-xs text-parchment/70 hover:border-parchment/40"
        >
          {t('Leave queue')}
        </button>
      </div>
    )
  if (!best || onTable || total <= seen) return null
  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-xl border border-gold/50 bg-ink/95 p-3 shadow-2xl shadow-black/70 backdrop-blur"
    >
      <Users className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p>
          {total === 1
            ? t('Someone is looking for a game: {what}', { what: queueLabel(t, best) })
            : t('{n} people are looking for a game, like: {what}', { n: total, what: queueLabel(t, best) })}
        </p>
        <button
          onClick={() => join.mutate({ size: best.size, bracket: best.bracket, style: best.style })}
          disabled={join.isPending}
          className="mt-2 rounded-md bg-gold px-3 py-1 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-60"
        >
          {t('Join the queue')}
        </button>
      </div>
      <button
        onClick={() => {
          setSeen(total)
          writeJSON(SEEN_KEY, total)
        }}
        aria-label={t('Close')}
        className="rounded p-0.5 text-parchment/50 hover:text-parchment"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
