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
  [
    'move',
    'tap',
    'untap_all',
    'counter',
    'life',
    'poison',
    'cmd_damage',
    'tax',
    'stat',
    'toggle_stats',
    'invert',
    'highlight',
    'lock',
  ].includes(a.type)

// Ações numa carta do campo: valem para a carta em qualquer campo (sua ou de um oponente)
const FIELD_ACTIONS = ['tap', 'counter', 'stat', 'toggle_stats', 'invert', 'highlight', 'lock']

function applyField(state: TableState, action: TableAction): TableState {
  if (!('card' in action)) return state
  const idx = state.players.findIndex((p) => p.battlefield.some((c) => c.id === action.card))
  if (idx < 0) return state
  const update = (c: FieldCard): FieldCard => {
    switch (action.type) {
      case 'tap':
        return { ...c, tapped: !c.tapped }
      case 'invert':
        return { ...c, inverted: !c.inverted }
      case 'highlight':
        return { ...c, highlight: !c.highlight }
      case 'lock':
        return { ...c, locked: !c.locked }
      case 'counter': {
        const counters = { ...c.counters }
        const value = clamp((counters[action.kind] ?? 0) + action.delta, 0, 999)
        if (value) counters[action.kind] = value
        else delete counters[action.kind]
        return { ...c, counters }
      }
      case 'stat':
        return c.stats
          ? { ...c, stats: { ...c.stats, [action.which]: clamp(c.stats[action.which] + action.delta, -99, 999) } }
          : c
      case 'toggle_stats':
        return { ...c, stats: c.stats ? null : (c.base ?? { p: 0, t: 0 }) }
      default:
        return c
    }
  }
  const players = [...state.players]
  const p = players[idx]
  players[idx] = { ...p, battlefield: p.battlefield.map((c) => (c.id === action.card ? update(c) : c)) }
  return { ...state, players }
}

/** Aplica uma ação ao estado (cópia rasa só do seu jogador). Ação desconhecida → estado igual. */
export function applyLocal(state: TableState, action: TableAction): TableState {
  if (FIELD_ACTIONS.includes(action.type)) return applyField(state, action)
  const idx = state.players.findIndex((p) => p.id === state.you)
  if (idx < 0) return state
  const me: TablePlayer = { ...state.players[idx], counts: { ...state.players[idx].counts } }
  let changed = true

  switch (action.type) {
    case 'move':
      changed = moveCard(me, action.card, action.to, action.x, action.y)
      break
    case 'untap_all':
      me.battlefield = me.battlefield.map((c) => (c.tapped ? { ...c, tapped: false } : c))
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
  // Carta de outro dono (controle trocado) saindo do campo: vai para o dono, espera o servidor
  if (onField && onField.owner !== me.id && to !== 'battlefield') return false
  if (onField && to === 'battlefield') {
    me.battlefield = me.battlefield.map((c) =>
      c.id === id ? { ...c, x: x ?? c.x, y: y ?? c.y, attached_to: null } : c,
    )
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
        stats: null,
        base: null,
        token: false,
        commander: !!(card as FieldCard).commander,
        owner: me.id,
        controller: null,
        attached_to: null,
        inverted: false,
        highlight: false,
        locked: false,
        face_down: false,
        flipped: false,
        note: null,
        symbol: null,
      },
    ]
  } else if (to !== 'library') {
    const list = (me[to as ListZone] as TableCard[] | null) ?? []
    me[to as ListZone] = [...list, base] as never
  }
  me.counts[to] += 1
  return true
}
