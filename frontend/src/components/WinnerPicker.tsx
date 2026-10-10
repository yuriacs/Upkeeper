import { useMutation } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { Draw } from '../lib/types'
import Trophy from './Trophy'

/**
 * Depois da partida: alguém da mesa marca quem ganhou. Alimenta o ranking e o placar da sala.
 * Quem não pode marcar só vê o resultado (se já houver).
 */
export default function WinnerPicker({
  draw,
  roomToken,
  onSaved,
}: {
  draw: Draw
  roomToken?: string | null
  onSaved: (draw: Draw) => void
}) {
  const save = useMutation({
    mutationFn: (winner: number | null) => api.setDrawResult(draw.code, winner, roomToken),
    onSuccess: onSaved,
  })
  const winner = draw.entries.find((e) => e.position === draw.winner_position)

  if (!draw.can_set_result) {
    if (!winner) return null
    return (
      <p className="flex items-center justify-center gap-2 text-center text-gold">
        <Trophy />
        <span>
          <strong>{winner.player_name}</strong> venceu{winner.deck ? ` com ${winner.deck.name}` : ''}
        </span>
      </p>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-3 rounded-xl border border-gold/20 bg-surface/60 p-4 text-center">
      <p className="text-sm text-parchment/70">
        {winner ? (
          <span className="inline-flex items-center gap-1.5 text-gold">
            <Trophy /> <strong>{winner.player_name}</strong> venceu a partida
          </span>
        ) : (
          'Terminou a partida? Marque quem ganhou para o ranking.'
        )}
      </p>
      <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Quem ganhou">
        {draw.entries.map((e) => {
          const selected = e.position === draw.winner_position
          return (
            <button
              key={e.position}
              role="radio"
              aria-checked={selected}
              disabled={save.isPending}
              onClick={() => save.mutate(selected ? null : e.position)}
              title={selected ? 'Clique de novo para desmarcar' : undefined}
              className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-3.5 py-1.5 text-sm transition disabled:opacity-60 ${
                selected
                  ? 'border-gold bg-gold font-semibold text-ink'
                  : 'border-gold/30 text-parchment/80 hover:border-gold/70 hover:text-gold'
              }`}
            >
              {selected && <Trophy />}
              {e.player_name}
            </button>
          )
        })}
      </div>
      {winner && <p className="text-xs text-parchment/40">Marcou errado? Clique em outro nome, ou no mesmo para desmarcar.</p>}
      {save.isError && <p className="text-sm text-red-400">{save.error.message}</p>}
    </div>
  )
}
