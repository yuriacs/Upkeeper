/*
 * Previsão local das ações da mesa: a tela muda na hora em que você age, sem esperar o servidor.
 * Quando o estado oficial chega (com "ack" = última ação já aplicada lá), as previsões
 * confirmadas saem da fila e as que faltam são aplicadas de novo por cima.
 * Só entram aqui ações cujo resultado o cliente já conhece (comprar depende do grimório, que
 * só o servidor sabe, então fica de fora).
 */
import type { FieldCard, TableAction, TableCard, TablePlayer, TableState, ZoneName } from '../hooks/useTableSocket'

const LIST_ZONES = ['hand', 'graveyard', 'exile', 'command', 'facedown'] as const
type ListZone = (typeof LIST_ZONES)[number]
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export const isOptimistic = (a: TableAction) =>
  ['move', 'tap', 'untap_all', 'counter', 'life', 'poison', 'cmd_damage', 'tax'].includes(a.type)

/** Aplica uma ação ao estado (cópia rasa só do seu jogador). Ação desconhecida → estado igual. */
export function applyLocal(state: TableState, action: TableAction): TableState {
  const idx = state.players.findIndex((p) => p.id === state.you)
  if (idx < 0) return state
  const me: TablePlayer = { ...state.players[idx], counts: { ...state.players[idx].counts } }
  let changed = true

  switch (action.type) {
    case 'move':
      changed = moveCard(me, action.card, action.to, action.x, action.y)
      break
    case 'tap':
      me.battlefield = me.battlefield.map((c) => (c.id === action.card ? { ...c, tapped: !c.tapped } : c))
      break
    case 'untap_all':
      me.battlefield = me.battlefield.map((c) => (c.tapped ? { ...c, tapped: false } : c))
      break
    case 'counter':
      me.battlefield = me.battlefield.map((c) => {
        if (c.id !== action.card) return c
        const counters = { ...c.counters }
        const value = clamp((counters[action.kind] ?? 0) + action.delta, 0, 999)
        if (value) counters[action.kind] = value
        else delete counters[action.kind]
        return { ...c, counters }
      })
      break
    case 'life':
      me.life = clamp(me.life + action.delta, -999, 999)
      break
    case 'poison':
      me.poison = clamp(me.poison + action.delta, 0, 99)
      break
    case 'cmd_damage': {
      const key = String(action.from)
      const before = me.cmd_damage[key] ?? 0
      const after = clamp(before + action.delta, 0, 99)
      me.cmd_damage = { ...me.cmd_damage, [key]: after }
      me.life = clamp(me.life - (after - before), -999, 999)
      break
    }
    case 'tax':
      me.tax = { ...me.tax, [action.card]: clamp((me.tax[action.card] ?? 0) + action.delta, 0, 20) }
      break
    default:
      changed = false
  }
  if (!changed) return state
  const players = [...state.players]
  players[idx] = me
  return { ...state, players }
}

function moveCard(me: TablePlayer, id: string, to: ZoneName, x?: number, y?: number): boolean {
  // Já no campo e indo para o campo: só reposiciona
  const onField = me.battlefield.find((c) => c.id === id)
  if (onField && to === 'battlefield') {
    me.battlefield = me.battlefield.map((c) => (c.id === id ? { ...c, x: x ?? c.x, y: y ?? c.y } : c))
    return true
  }
  let card: TableCard | FieldCard | undefined = onField
  let from: ZoneName | undefined = onField ? 'battlefield' : undefined
  if (onField) me.battlefield = me.battlefield.filter((c) => c.id !== id)
  else {
    for (const z of LIST_ZONES) {
      const list = me[z] as TableCard[] | null
      const found = list?.find((c) => c.id === id)
      if (found) {
        card = found
        from = z
        me[z] = list!.filter((c) => c.id !== id) as never
        break
      }
    }
  }
  if (!card || !from) return false // carta do grimório (ex.: busca): espera o servidor
  me.counts[from] -= 1
  if (onField?.token) return true // ficha que sai do campo some
  const base: TableCard = { id: card.id, name: card.name, image: card.image, back: card.back }
  if (to === 'battlefield') {
    me.battlefield = [
      ...me.battlefield,
      {
        ...base,
        x: x ?? 0.5,
        y: y ?? 0.5,
        tapped: false,
        counters: {},
        token: false,
        commander: !!(card as FieldCard).commander,
      },
    ]
  } else if (to !== 'library') {
    const list = (me[to as ListZone] as TableCard[] | null) ?? []
    me[to as ListZone] = [...list, base] as never
  }
  me.counts[to] += 1
  return true
}
