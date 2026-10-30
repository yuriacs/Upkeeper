import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, LogIn } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useT } from '../lib/i18n'

const ERRORS: Record<string, string> = {
  has_winner: 'This game has a winner, so it can’t be restored.',
  server_full: 'The server is full right now. Try again in a few minutes.',
  too_many_tables: 'You already have the most open tables. Close one to restore this game.',
}

/**
 * Partida que fechou sem vencedor (por tempo ou por um jogador): abre a mesa de novo onde parou,
 * cada um no seu lugar com mão, grimório, cemitério e campo. Já restaurada e aberta: volta para ela.
 * `compact`: só o botão pequeno (lista do histórico).
 */
export default function RestoreTable({
  id,
  table,
  compact = false,
}: {
  id: number
  table?: string | null
  compact?: boolean
}) {
  const t = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const restore = useMutation({
    mutationFn: () => api.restoreReplay(id),
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
      onClick={() => restore.mutate()}
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
