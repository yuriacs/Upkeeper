import { createContext, useContext, type DragEvent } from 'react'
import type { TableAction, TableCard, ZoneName } from '../../hooks/useTableSocket'

export type MenuTarget = { card: TableCard; zone: ZoneName; tapped?: boolean; x: number; y: number }

type Ctx = {
  send: (a: TableAction) => void
  you: number
  preview: (card: TableCard | null, clientX?: number) => void
  openMenu: (m: MenuTarget) => void
}
export const TableCtx = createContext<Ctx>({ send: () => {}, you: 0, preview: () => {}, openMenu: () => {} })
export const useTable = () => useContext(TableCtx)

export const CARD_RATIO = 1.4 // altura / largura de uma carta de Magic (63 × 88 mm)
export const DRAG_TYPE = 'application/x-table-card'

// Onde o mouse pegou a carta (para soltar no campo no mesmo ponto), guardado durante o arraste
export const dragInfo = { dx: 0, dy: 0, w: 1 }

export function readDrag(e: DragEvent): { id: string; from: ZoneName } | null {
  const raw = e.dataTransfer.getData(DRAG_TYPE)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const acceptsCard = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE)

export const zoneLabel = (t: (s: string) => string, z: string) =>
  ({
    library: t('Library'),
    hand: t('Hand'),
    battlefield: t('Battlefield'),
    graveyard: t('Graveyard'),
    exile: t('Exile'),
    command: t('Command zone'),
    facedown: t('Facedown pile'),
  })[z] ?? z
