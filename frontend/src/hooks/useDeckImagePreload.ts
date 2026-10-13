import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../lib/api'
import { cardImage } from '../lib/cardImage'
import { BOARD_CARD, getTableSettings } from '../lib/tableSettings'
import type { TableDeck } from './useTableSocket'

/**
 * Baixa antes as imagens das cartas do seu deck (em segundo plano, aos poucos), para que a carta
 * comprada apareça na hora em vez de carregar do Scryfall naquele momento. A lista do deck é
 * pública (é a mesma da página do deck), então não revela a ordem do grimório.
 */
export function useDeckImagePreload(deck: TableDeck | null | undefined) {
  const detail = useQuery({
    queryKey: ['table-deck-images', deck?.kind, deck?.ref],
    queryFn: () => (deck!.kind === 'precon' ? api.deck(deck!.ref) : api.userDeck(deck!.ref)),
    enabled: !!deck,
    staleTime: Infinity,
  })
  useEffect(() => {
    const d = detail.data
    if (!d) return
    const urls = [
      ...new Set(
        [...d.commanders, ...d.sections.flatMap((s) => s.cards)]
          .map((c) => c.card.image_normal)
          .filter(Boolean)
          // Mesmo tamanho que o campo e a mão usam (a versão grande só baixa ao ampliar a carta)
          .map((url) => cardImage(url, BOARD_CARD.large * getTableSettings().boardScale)),
      ),
    ]
    let i = 0
    let cancelled = false
    const kept: HTMLImageElement[] = []
    const next = () => {
      if (cancelled || i >= urls.length) return
      // 4 por vez, para não disputar a rede com o resto da página
      for (const url of urls.slice(i, i + 4)) {
        const img = new Image()
        img.decoding = 'async'
        img.src = url
        kept.push(img)
      }
      i += 4
      setTimeout(next, 150)
    }
    const start = setTimeout(next, 500)
    return () => {
      cancelled = true
      clearTimeout(start)
    }
  }, [detail.data])
}
