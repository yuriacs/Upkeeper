/*
 * Artes personalizadas das fichas do Scryfall (como no untap): o jogador escolhe uma imagem para
 * uma ficha (Treasure, Soldier...) e, em toda mesa, a ficha dele aparece com essa imagem. Ligadas
 * pela ficha (oracle id), vêm do backend como {oracle_id: url}.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { useAuth } from './auth'

export const TOKEN_ARTS_KEY = ['token-arts']

/** {oracle_id da ficha: url da arte} de quem está logado (vazio para visitantes) */
export function useTokenArts(): Record<string, string> {
  const { user } = useAuth()
  const q = useQuery({
    queryKey: TOKEN_ARTS_KEY,
    queryFn: () => api.tokenArts().then((r) => r.arts),
    enabled: !!user,
    staleTime: Infinity,
    retry: false,
  })
  return q.data ?? {}
}

/** Imagem da ficha com a arte do jogador, se ele escolheu uma */
export const tokenImage = (arts: Record<string, string>, image: string, oracleId?: string) =>
  (oracleId && arts[oracleId]) || image
