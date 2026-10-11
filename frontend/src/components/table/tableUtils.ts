import { Flame, Moon, Shield, ShieldCheck, Skull, Star, Swords, Target, type LucideIcon } from 'lucide-react'
import { createContext, useContext, type DragEvent } from 'react'
import type { FieldCard, TableAction, TableCard, ZoneName } from '../../hooks/useTableSocket'

export type MenuTarget = {
  card: TableCard | FieldCard
  zone: ZoneName
  tapped?: boolean
  /** Imposto atual, se a carta for um comandante */
  tax?: number
  x: number
  y: number
  /** Abre já com o campo da nota aberto (atalho N) */
  sub?: 'note'
}

export type HoverTarget = { card: TableCard; zone: ZoneName; mine: boolean; tapped: boolean }

/** Escolhendo o alvo de uma seta ("Mirar…") ou a carta onde prender ("Prender em…") */
export type PickMode = 'target' | 'attach'

/** Marcadores mais comuns no menu da carta (o nome em inglês é o que vai para o servidor) */
export const COUNTER_KINDS = ['+1/+1', '-1/-1', 'Loyalty', 'Charge'] as const

/** Símbolos que dá para pôr numa carta do campo (mesma lista do servidor, tables/state.py) */
export const SYMBOL_KEYS = ['attack', 'block', 'sick', 'target', 'star', 'skull', 'shield', 'flame'] as const

/** Desenho de cada símbolo que dá para pôr numa carta (a chave é a que vai para o servidor) */
export const SYMBOL_ICONS: Record<string, LucideIcon> = {
  attack: Swords,
  block: Shield,
  sick: Moon,
  target: Target,
  star: Star,
  skull: Skull,
  shield: ShieldCheck,
  flame: Flame,
}

export const symbolLabel = (t: (s: string) => string, key: string) =>
  ({
    attack: t('Attacking'),
    block: t('Blocking'),
    sick: t('Summoning sick'),
    target: t('Targeted'),
    star: t('Important'),
    skull: t('Dies'),
    shield: t('Protected'),
    flame: t('Damage'),
  })[key] ?? key

export const isField = (c: TableCard | FieldCard): c is FieldCard => 'counters' in c

type Ctx = {
  send: (a: TableAction) => void
  you: number
  /** Jogadores sentados (para "Dar o controle") */
  players: { id: number; name: string; seat: number }[]
  /** Carta sob o mouse: mostra a prévia ampliada e serve de alvo para os atalhos de teclado */
  preview: (card: TableCard | null, clientX?: number, hover?: HoverTarget) => void
  openMenu: (m: MenuTarget) => void
  /** Começa a escolher o alvo/hospedeiro de uma carta do campo */
  startPick: (mode: PickMode, card: TableCard) => void
  /** Clique numa carta durante a escolha: usa a carta e devolve true (o clique não faz mais nada) */
  pickCard: (id: string, zone: ZoneName) => boolean
  /** Ctrl/Shift + clique numa carta do campo: entra ou sai da seleção */
  toggleSelect: (id: string) => void
}
export const TableCtx = createContext<Ctx>({
  send: () => {},
  you: 0,
  players: [],
  preview: () => {},
  openMenu: () => {},
  startPick: () => {},
  pickCard: () => false,
  toggleSelect: () => {},
})
export const useTable = () => useContext(TableCtx)

export const CARD_RATIO = 1.4 // altura / largura de uma carta de Magic (63 × 88 mm)
export const DRAG_TYPE = 'application/x-table-card'

// Onde o mouse pegou a carta (para soltar no campo no mesmo ponto), guardado durante o arraste
export const dragInfo = { dx: 0, dy: 0, w: 1 }

/** Última posição do mouse (o menu aberto por atalho aparece ali) */
export const pointer = { x: 0, y: 0 }

export function readDrag(e: DragEvent): { id: string; from: ZoneName; attach?: string | null; name?: string } | null {
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
