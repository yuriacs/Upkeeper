import { useEffect, useState } from 'react'
import { X, History } from 'lucide-react'
import { logText } from './logText'
import { type LogItem } from '../../hooks/useTableSocket'
import { useT } from '../../lib/i18n'
import { SEAT_DOT } from './tableLook'

/**
 * Histórico da partida: os registros do log, do mais novo para o mais antigo, separados por turno.
 * Os momentos guardados têm "Voltar para cá": a mesa inteira volta a como estava logo depois
 * daquele evento (todos os jogadores conectados aprovam antes).
 */
export function HistoryDialog({
  log,
  checkpoints,
  pending,
  onRewind,
  onClose,
}: {
  log: LogItem[]
  checkpoints: number[]
  pending: boolean
  onRewind: (id: number) => void
  onClose: () => void
}) {
  const t = useT()
  const [chosen, setChosen] = useState<number | null>(null)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const points = new Set(checkpoints)
  const items = [...log].reverse().filter((e) => e.kind !== 'chat' && e.kind !== 'spectator_chat')
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('Game history')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-xl flex-col rounded-xl border border-line bg-ink shadow-2xl shadow-black"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <History className="h-5 w-5 text-gold" aria-hidden />
          <h2 className="font-display text-2xl">{t('Game history')}</h2>
          <button
            onClick={onClose}
            aria-label={t('Close')}
            className="ml-auto rounded-md p-1 text-parchment/60 hover:text-gold"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="border-b border-line px-5 py-2 text-xs text-parchment/50">
          {t('Click a moment to take the whole table back to right after it. Everyone at the table must agree.')}
        </p>
        {pending && (
          <p className="border-b border-line bg-gold/10 px-5 py-2 text-xs text-gold">
            {t('There is already a request waiting for an answer.')}
          </p>
        )}
        <ol className="min-h-0 flex-1 overflow-y-auto py-2">
          {items.length === 0 && <li className="px-5 py-3 text-sm text-parchment/40">{t('Nothing happened yet.')}</li>}
          {items.map((e, i) => {
            const id = e.id ?? -i
            const can = points.has(id) && !pending
            const turn = e.kind === 'turn'
            return (
              <li key={id}>
                {turn && (
                  <p className="mt-2 border-t border-line px-5 pt-2 text-[0.65rem] font-semibold tracking-wide text-parchment/40 uppercase">
                    {t('Turn {n}', { n: e.n ?? 0 })}
                  </p>
                )}
                <button
                  type="button"
                  disabled={!can}
                  onClick={() => setChosen(chosen === id ? null : id)}
                  className={`flex w-full items-start gap-2 px-5 py-1.5 text-left text-sm transition ${
                    chosen === id
                      ? 'bg-gold/15 text-gold'
                      : can
                        ? 'hover:bg-parchment/5'
                        : 'cursor-default text-parchment/45'
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEAT_DOT[(e.seat || 1) - 1] ?? 'bg-parchment/30'}`}
                  />
                  <span className="flex-1">{logText(t, e)}</span>
                  {can && chosen !== id && (
                    <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-parchment/30" aria-hidden />
                  )}
                </button>
                {chosen === id && (
                  <div className="flex items-center gap-2 bg-gold/10 px-5 pb-2">
                    <span className="flex-1 text-xs text-parchment/70">
                      {t('Everything after this goes away for everyone.')}
                    </span>
                    <button
                      onClick={() => onRewind(id)}
                      className="rounded-md btn-ember px-3 py-1 text-xs font-semibold text-ink hover:brightness-110"
                    >
                      {t('Go back to here')}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
