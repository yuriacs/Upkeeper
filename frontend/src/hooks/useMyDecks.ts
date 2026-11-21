import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { localDecks } from '../lib/localDecks'
import type { PoolOrganize } from '../lib/types'

// "Meus precons": sem login ficam no navegador; com login, na conta (e entram na deckpool).
export function useMyDecks() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const local = useSyncExternalStore(localDecks.subscribe, localDecks.get)

  const remote = useQuery({
    queryKey: ['me', 'precons', user?.id],
    queryFn: api.myPrecons,
    enabled: !!user,
    staleTime: 60_000,
  })

  const mutation = useMutation({
    mutationFn: ({ slug, owned }: { slug: string; owned: boolean }) => api.setPrecon(slug, owned),
    onMutate: async ({ slug, owned }) => {
      const key = ['me', 'precons', user?.id]
      await queryClient.cancelQueries({ queryKey: key })
      const prev = queryClient.getQueryData<{ slugs: string[]; organize?: Record<string, PoolOrganize> }>(key)
      const slugs = prev?.slugs ?? []
      queryClient.setQueryData(key, { ...prev, slugs: owned ? [...slugs, slug] : slugs.filter((s) => s !== slug) })
      return { prev, key }
    },
    onError: (_err, _vars, ctx) => ctx && queryClient.setQueryData(ctx.key, ctx.prev),
    onSuccess: (data) => queryClient.setQueryData(['me', 'precons', user?.id], data),
  })

  const slugs = user ? (remote.data?.slugs ?? []) : local
  return {
    slugs,
    /** Pasta e etiquetas de cada precon (só com login) */
    organize: (user ? remote.data?.organize : undefined) ?? {},
    synced: !!user,
    has: (slug: string) => slugs.includes(slug),
    toggle: (slug: string) => {
      const owned = !slugs.includes(slug)
      if (user) mutation.mutate({ slug, owned })
      else localDecks.set(owned ? [...local, slug] : local.filter((s) => s !== slug))
    },
  }
}
