import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { History, RotateCcw, LogIn } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useT } from '../lib/i18n'

const ERRORS: Record<string, string> = {
  has_winner: 'This game has a winner, so it can’t be restored.',
  server_full: 'The server is full right now. Try again in a few minutes.',
  too_many_tables: 'You already have the most open tables. Close one to restore this game.',
  bad_moment: 'This moment is not in the game anymore. Reload the page and try again.',
}

/**
 * Partida que fechou sem vencedor (por tempo ou por um jogador): abre a mesa de novo onde parou,
 * cada um no seu lugar com mão, grimório, cemitério e campo. Já restaurada e aberta: volta para ela.
 * `compact`: só o botão pequeno (lista do histórico). `moment`: o momento que o rever está mostrando,
 * quando não é o fim: dá também para voltar dali (com confirmação).
 */
export default function RestoreTable({
  id,
  table,
  compact = false,
  moment = null,
}: {
  id: number
  table?: string | null
  compact?: boolean
  moment?: { turn: number; event: number | null } | null
}) {
  const t = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const restore = useMutation({
    mutationFn: (from?: { turn: number; event: number | null }) => api.restoreReplay(id, from),
    onSuccess: ({ code }) => {
      void queryClient.invalidateQueries({ queryKey: ['my-replays'] })
      void queryClient.invalidateQueries({ queryKey: ['tables', 'mine'] })
      navigate(`/table/${code}`)
    },
  })
  const err = restore.error
  const message =
    err instanceof ApiError ? (ERRORS[err.message] ? t(ERRORS[err.message]) : err.message) : err ? String(err) : null
  const size = compact ? 'px-2.5 py-1 text-xs' : 'w-full px-3 py-1.5 text-sm'
  const button = table ? (
    <button
      type="button"
      onClick={() => navigate(`/table/${table}`)}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md bg-gold font-semibold text-ink hover:brightness-110 ${size}`}
    >
      <LogIn className="h-3.5 w-3.5" aria-hidden />
      {t('Back to the table')}
    </button>
  ) : (
    <button
      type="button"
      disabled={restore.isPending}
      onClick={() => restore.mutate(undefined)}
      title={t(
        'Opens this game again where it stopped: everyone goes back to their seat with hand, library, graveyard and battlefield as they were. The other players get an invite.',
      )}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border border-gold/60 font-semibold text-gold hover:bg-gold/10 disabled:opacity-60 ${size}`}
    >
      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
      {restore.isPending ? t('Restoring…') : t('Restore table')}
    </button>
  )
  if (compact) return button
  return (
    <div className="mt-2 space-y-1">
      {button}
      {!table && moment && !confirming && (
        <button
          type="button"
          disabled={restore.isPending}
          onClick={() => setConfirming(true)}
          className={`inline-flex items-center justify-center gap-1.5 rounded-md border border-line text-parchment/80 hover:border-gold/60 hover:text-gold disabled:opacity-60 ${size}`}
        >
          <History className="h-3.5 w-3.5" aria-hidden />
          {t('Restore from this moment')}
        </button>
      )}
      {!table && moment && confirming && (
        <div className="space-y-1.5 rounded-md border border-gold/40 bg-gold/[0.05] p-2">
          <p className="text-[0.7rem] leading-snug text-parchment/75">
            {t(
              'The game goes back to the moment on screen: battlefield, hands, graveyards, exile and life as they were, and the rest of each deck shuffled as the library. What came after leaves the replay when the restored table closes.',
            )}
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={restore.isPending}
              onClick={() => restore.mutate(moment)}
              className="flex-1 rounded-md bg-gold px-2 py-1 text-xs font-semibold text-ink hover:brightness-110 disabled:opacity-60"
            >
              {restore.isPending ? t('Restoring…') : t('Restore from here')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-line px-2 py-1 text-xs hover:border-parchment/40"
            >
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}
      {!table && !message && (
        <p className="text-[0.68rem] leading-snug text-parchment/45">
          {t(
            'Opens this game again where it stopped: everyone goes back to their seat with hand, library, graveyard and battlefield as they were. The other players get an invite.',
          )}
        </p>
      )}
      {message && <p className="text-[0.7rem] leading-snug text-red-400">{message}</p>}
    </div>
  )
}
