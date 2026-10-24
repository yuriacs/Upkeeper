import type { QueryClient } from '@tanstack/react-query'
import { api } from './api'

/** Biblioteca de fichas personalizadas do jogador (components/table/CustomTokens.tsx) */
export const CUSTOM_TOKENS_KEY = ['custom-tokens']

/** Ficha personalizada sua com esse nome (os atalhos de carta usam quando o Scryfall não tem a ficha) */
export async function findCustomToken(queryClient: QueryClient, name: string) {
  try {
    const library = await queryClient.fetchQuery({ queryKey: CUSTOM_TOKENS_KEY, queryFn: api.customTokens, staleTime: 60_000 })
    return library.arts.find((tok) => tok.name?.toLowerCase() === name.toLowerCase())
  } catch {
    return undefined
  }
}
