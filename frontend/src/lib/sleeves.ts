/*
 * Cores de sleeve dos apoiadores (verso das cartas viradas para baixo na mesa). As chaves são as
 * mesmas do servidor (accounts/supporter.py, SLEEVES). Sem sleeve (ou não apoiador): o verso
 * padrão do site.
 */
import type { CSSProperties } from 'react'

export type Sleeve = { key: string; name: string; from: string; to: string; edge: string }

export const SLEEVES: Sleeve[] = [
  { key: 'ember', name: 'Ember', from: '#2a1810', to: '#0b0b0d', edge: 'rgb(236 185 63 / 0.4)' },
  { key: 'azure', name: 'Azure', from: '#123a66', to: '#060b14', edge: 'rgb(125 190 255 / 0.55)' },
  { key: 'emerald', name: 'Emerald', from: '#0f4a30', to: '#050d09', edge: 'rgb(110 220 160 / 0.5)' },
  { key: 'crimson', name: 'Crimson', from: '#5c1020', to: '#0e0507', edge: 'rgb(255 110 120 / 0.5)' },
  { key: 'violet', name: 'Violet', from: '#3b1a66', to: '#0a0612', edge: 'rgb(190 150 255 / 0.55)' },
  { key: 'gold', name: 'Gold', from: '#7a5510', to: '#1a1206', edge: 'rgb(255 215 110 / 0.85)' },
  { key: 'silver', name: 'Silver', from: '#5d636e', to: '#121418', edge: 'rgb(225 230 240 / 0.7)' },
  { key: 'obsidian', name: 'Obsidian', from: '#1c1c20', to: '#000000', edge: 'rgb(150 150 160 / 0.45)' },
]

const BY_KEY = new Map(SLEEVES.map((s) => [s.key, s]))

/** Fundo e borda do verso para uma chave de sleeve (vazio ou desconhecido: o verso padrão) */
export function sleeveStyle(key: string | null | undefined): CSSProperties {
  const s = BY_KEY.get(key ?? '') ?? SLEEVES[0]
  return {
    background: `radial-gradient(circle at 50% 40%, ${s.from}, ${s.to} 70%)`,
    borderColor: s.edge,
  }
}
