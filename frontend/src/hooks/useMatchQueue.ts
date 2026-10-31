import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { playstyleLabel } from '../lib/playstyles'
import type { QueuePick, QueueStatus } from '../lib/types'

type T = (s: string, v?: Record<string, string | number>) => string

/**
 * A fila "Achar partida" (tables/queue.py), uma consulta só para o site inteiro: a cada 4 s
 * enquanto você está na fila (é assim que o servidor sabe que você continua lá), a cada 25 s fora
 * dela (para avisar que tem gente procurando partida).
 */
export function useMatchQueue() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: ['queue'],
    queryFn: api.queue,
    enabled: !!user,
    refetchInterval: (q) => (q.state.data?.mine ? 4_000 : 25_000),
    refetchIntervalInBackground: true,
  })
  const set = (data: QueueStatus) => queryClient.setQueryData(['queue'], data)
  const join = useMutation({ mutationFn: (pick: QueuePick) => api.joinQueue(pick), onSuccess: set })
  const leave = useMutation({ mutationFn: api.leaveQueue, onSuccess: set })
  return { status: user ? status.data : undefined, join, leave }
}

/** "4 jogadores · bracket 3 · Descontraído" (o que for "qualquer" não aparece) */
export function queueLabel(t: T, pick: QueuePick) {
  return [
    t('{n} players', { n: pick.size }),
    pick.bracket ? t('Bracket {n}', { n: pick.bracket }) : null,
    pick.style ? playstyleLabel(t, pick.style) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
