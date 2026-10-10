import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

/** Artes dos comandantes (roleta e topo da home): uma chamada leve, guardada a sessão inteira. */
export function useArts(enabled = true) {
  const query = useQuery({ queryKey: ['arts'], queryFn: api.arts, staleTime: Infinity, enabled })
  return { arts: query.data?.arts ?? [], items: query.data?.items ?? [], isPending: query.isPending }
}
