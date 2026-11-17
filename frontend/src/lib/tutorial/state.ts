/*
 * Estado da partida tutorial: tudo no navegador, sem servidor. O roteiro (script.ts) muda o
 * estado com as funções daqui; a página só desenha e repassa os cliques.
 */
import { def, type ManaColor } from './cards'

export type Who = 'you' | 'opp'
export type Phase = 'setup' | 'untap' | 'upkeep' | 'draw' | 'main1' | 'combat' | 'main2' | 'end'
export const PHASES: Phase[] = ['untap', 'upkeep', 'draw', 'main1', 'combat', 'main2', 'end']

export type FieldCard = {
  id: string
  tapped: boolean
  /** Enjoo de invocação: entrou neste turno e ainda não pode atacar */
  sick: boolean
  attacking: boolean
  /** Bloqueando esta carta (id do atacante) */
  blocking: string | null
  /** Dano marcado neste turno (some no fim do turno) */
  damage: number
  /** Bônus até o fim do turno (+3/+3 do Crescimento Desenfreado) */
  pump: number
}

export type Side = {
  life: number
  library: number
  hand: string[]
  field: FieldCard[]
  graveyard: string[]
  mana: Partial<Record<ManaColor, number>>
  /** Já jogou um terreno neste turno */
  landPlayed: boolean
}

export type TState = {
  you: Side
  opp: Side
  turn: number
  active: Who
  phase: Phase
  /** Mágica sendo conjurada, esperando o alvo */
  casting: string | null
  /** Combate: os atacantes já foram confirmados (o botão Atacar some) */
  declared: boolean
  /** Última mudança de vida (para piscar o número): quem e quanto */
  hit: { who: Who; n: number; at: number } | null
}

const side = (life: number, library: number): Side => ({
  life,
  library,
  hand: [],
  field: [],
  graveyard: [],
  mana: {},
  landPlayed: false,
})

export const initialState = (): TState => ({
  you: side(20, 40),
  opp: side(10, 40),
  turn: 0,
  active: 'you',
  phase: 'setup',
  casting: null,
  declared: false,
  hit: null,
})

export const ownerOf = (s: TState, id: string): Who | null =>
  s.you.hand.includes(id) || s.you.field.some((c) => c.id === id) || s.you.graveyard.includes(id)
    ? 'you'
    : s.opp.hand.includes(id) || s.opp.field.some((c) => c.id === id) || s.opp.graveyard.includes(id)
      ? 'opp'
      : null

export const fieldCard = (s: TState, id: string): FieldCard | undefined =>
  s.you.field.find((c) => c.id === id) ?? s.opp.field.find((c) => c.id === id)

/** Força/resistência atuais de uma criatura no campo */
export function stats(c: FieldCard) {
  const d = def(c.id)
  return { p: (d.power ?? 0) + c.pump, t: (d.toughness ?? 0) + c.pump }
}

// --- Ações (mudam o estado no lugar; o roteiro trabalha numa cópia) ---

export function draw(s: TState, who: Who, ...ids: string[]) {
  const p = s[who]
  p.hand.push(...ids)
  p.library -= ids.length
}

export function enterField(s: TState, who: Who, id: string) {
  const p = s[who]
  p.hand = p.hand.filter((h) => h !== id)
  const creature = def(id).kind === 'creature'
  p.field.push({ id, tapped: false, sick: creature, attacking: false, blocking: null, damage: 0, pump: 0 })
}

export function playLand(s: TState, who: Who, id: string) {
  enterField(s, who, id)
  s[who].landPlayed = true
}

/** Vira um terreno e põe a mana dele na reserva */
export function tapLand(s: TState, id: string) {
  const who = ownerOf(s, id)
  const c = fieldCard(s, id)
  const color = def(id).makes
  if (!who || !c || c.tapped || !color) return
  c.tapped = true
  s[who].mana[color] = (s[who].mana[color] ?? 0) + 1
}

/** Paga um custo ("{2}{G}") com a reserva: as cores primeiro, o genérico com o que sobrar */
export function pay(s: TState, who: Who, cost: string) {
  const mana = s[who].mana
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
  let generic = 0
  for (const sym of symbols) {
    if (/^\d+$/.test(sym)) generic += Number(sym)
    else mana[sym as ManaColor] = (mana[sym as ManaColor] ?? 0) - 1
  }
  for (const color of ['R', 'B', 'G'] as ManaColor[]) {
    while (generic > 0 && (mana[color] ?? 0) > 0) {
      mana[color]! -= 1
      generic -= 1
    }
  }
  for (const color of Object.keys(mana) as ManaColor[]) if (!mana[color]) delete mana[color]
}

/** A reserva de mana tem o bastante para este custo? */
export function canPay(side: Side, cost: string): boolean {
  const mana = { ...side.mana }
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
  let generic = 0
  for (const sym of symbols) {
    if (/^\d+$/.test(sym)) generic += Number(sym)
    else {
      const left = (mana[sym as ManaColor] ?? 0) - 1
      if (left < 0) return false
      mana[sym as ManaColor] = left
    }
  }
  return Object.values(mana).reduce((a, b) => a + (b ?? 0), 0) >= generic
}

/** Conjura uma criatura: paga e ela entra no campo */
export function castCreature(s: TState, who: Who, id: string) {
  pay(s, who, def(id).cost)
  enterField(s, who, id)
}

/** Uma mágica instantânea ou feitiço: paga, faz o efeito (fora daqui) e vai para o cemitério */
export function castSpell(s: TState, who: Who, id: string) {
  pay(s, who, def(id).cost)
  s[who].hand = s[who].hand.filter((h) => h !== id)
  s[who].graveyard.push(id)
}

/** Uma permanente sai do campo para o cemitério do dono */
export function destroy(s: TState, id: string) {
  for (const who of ['you', 'opp'] as Who[]) {
    const p = s[who]
    if (p.field.some((c) => c.id === id)) {
      p.field = p.field.filter((c) => c.id !== id)
      p.graveyard.push(id)
    }
  }
}

export function loseLife(s: TState, who: Who, n: number) {
  s[who].life -= n
  s.hit = { who, n, at: Date.now() }
}

/** Começo do turno: desvira tudo, tira o enjoo e zera o terreno do turno */
export function startTurn(s: TState, who: Who, turn: number) {
  s.active = who
  s.turn = turn
  s.phase = 'untap'
  s.declared = false
  const p = s[who]
  p.landPlayed = false
  for (const c of p.field) {
    c.tapped = false
    c.sick = false
  }
}

/** Fim do turno: o dano e os bônus somem, a mana que sobrou também */
export function endTurn(s: TState) {
  s.phase = 'end'
  for (const who of ['you', 'opp'] as Who[]) {
    s[who].mana = {}
    for (const c of s[who].field) {
      c.damage = 0
      c.pump = 0
      c.attacking = false
      c.blocking = null
    }
  }
}

export const clone = (s: TState): TState => structuredClone(s)
