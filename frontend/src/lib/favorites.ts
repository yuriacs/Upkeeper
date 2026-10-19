/*
 * Cartas favoritas do deckbuilder (as que o usuário mais usa), guardadas na conta pelo oracle id:
 * valem para qualquer edição e em qualquer aparelho.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

const KEY = ['favorite-cards']

export function useFavorites() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: api.favoriteCards, staleTime: 60_000 })
  const ids = query.data?.oracle_ids ?? []
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api.setFavoriteCard(id, on),
    // Na hora, sem esperar o servidor; se falhar, volta como estava
    onMutate: async ({ id, on }) => {
      await queryClient.cancelQueries({ queryKey: KEY })
      const before = queryClient.getQueryData<{ oracle_ids: string[]; max: number }>(KEY)
      queryClient.setQueryData(KEY, {
        max: before?.max ?? 500,
        oracle_ids: on ? [id, ...(before?.oracle_ids ?? []).filter((x) => x !== id)] : (before?.oracle_ids ?? []).filter((x) => x !== id),
      })
      return { before }
    },
    onError: (_e, _v, ctx) => ctx?.before && queryClient.setQueryData(KEY, ctx.before),
  })
  const set = new Set(ids)
  return {
    ids,
    loading: query.isPending,
    has: (id: string) => !!id && set.has(id),
    toggle: (id: string) => id && toggle.mutate({ id, on: !set.has(id) }),
    error: toggle.error,
  }
}
