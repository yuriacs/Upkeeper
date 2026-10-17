import { useMemo } from 'react'
import type { TableCard, TablePlayer } from '../../hooks/useTableSocket'

/** Cartas que dá para ver na mesa agora, pelo id e pelo nome (em minúsculas) */
export type CardLookup = { byId: Map<string, TableCard>; byName: Map<string, TableCard[]> }

export function useCardLookup(players: TablePlayer[]): CardLookup {
  return useMemo(() => {
    const byId = new Map<string, TableCard>()
    const byName = new Map<string, TableCard[]>()
    for (const p of players) {
      const visible = [
        ...p.battlefield.filter((c) => !c.face_down),
        ...p.command,
        ...p.graveyard,
        ...p.exile,
        ...(p.hand ?? []),
      ]
      for (const c of visible) {
        if (!c.name) continue
        byId.set(c.id, c)
        const key = c.name.toLowerCase()
        byName.set(key, [...(byName.get(key) ?? []), c])
      }
    }
    return { byId, byName }
  }, [players])
}
