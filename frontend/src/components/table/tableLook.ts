import { Droplet, Flame, Leaf, Moon } from 'lucide-react'
import { type TablePlayer } from '../../hooks/useTableSocket'

/* Cores, ícones e medidas da mesa virtual, usados pela página da mesa e pelo rever. */

// Cor de cada cadeira (classes escritas por extenso para o Tailwind encontrar)
export const SEAT_BORDER = ['border-l-gold', 'border-l-sky-400', 'border-l-emerald-400', 'border-l-violet-400']
export const SEAT_TEXT = ['text-gold', 'text-sky-400', 'text-emerald-400', 'text-violet-400']
export const SEAT_RING = ['ring-gold', 'ring-sky-400', 'ring-emerald-400', 'ring-violet-400']
// Ícone de cada cadeira (no lugar da inicial do nome), um por cor
export const SEAT_ICONS = [Flame, Droplet, Leaf, Moon]
/** Zona do comandante: margem interna do quadro e altura da faixa do nome (px) */
export const CMD_PAD = 6
export const CMD_LABEL = 14
/** Espaço embaixo da carta no quadro para a força/resistência, que fica logo abaixo da carta */
export const CMD_STAT = 10
export const SEAT_TINT = ['from-gold/[0.08]', 'from-sky-400/[0.08]', 'from-emerald-400/[0.08]', 'from-violet-400/[0.08]']

// Split: o oponente em foco aparece grande e os outros pequenos ao lado. Full: todos do mesmo tamanho.
// Duel: como um 1 contra 1, só um oponente (quem está jogando, ou o que você clicou neste turno).
export type ViewMode = 'split' | 'full' | 'duel'
export const VIEW_MODES: ViewMode[] = ['split', 'full', 'duel']
export const VIEW_KEY = 'precon-draft:table-view'
// Campo grande típico (o seu, numa tela de ~1600 px) com cartas de BOARD_CARD.large: os campos
// pequenos usam cartas proporcionais a ele (já com o tamanho escolhido nas configurações), no mínimo SMALL_MIN px
export const REF_BOARD = { w: 1270, h: 340 }
export const SMALL_MIN = 20
// Largura das cartas no campo (px): as posições são frações do campo, então valem nos dois tamanhos
export const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export const SEAT_DOT = ['bg-gold', 'bg-sky-400', 'bg-emerald-400', 'bg-violet-400']

export const NO_PLAYERS: TablePlayer[] = []

export const overlapFor = (n: number, width: number) => (n > 8 ? -Math.min(width * 0.55, (n - 8) * 6 + 16) : 4)
