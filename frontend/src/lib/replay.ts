/*
 * Partida para rever (Histórico → Rever): o resumo de cada turno que o servidor guarda quando a
 * partida termina (tables/state.py, take_replay), com os lugares que mudaram depois de cada ação.
 * Aqui: os passos para rever ação a ação, cada passo como o estado de uma mesa (a página desenha
 * com a própria mesa) e a versão em texto, para baixar.
 */
import type { FieldCard, LogItem, TableCard, TablePlayer, TableState } from '../hooks/useTableSocket'
import { logText, type T } from '../components/table/logText'
import { fmtClock } from './duration'

/**
 * Carta do campo. Partidas guardadas antes das posições não têm id, x e y (a página arruma as cartas
 * em fila); virada para baixo vem sem nome e imagem.
 */
export type ReplayCard = {
  id?: string
  name?: string
  image?: string
  tapped?: boolean
  x?: number
  y?: number
  /** Vaga na zona do comandante */
  slot?: number | null
  counters?: Record<string, number>
  stats?: { p: number; t: number } | null
  attached_to?: string
  commander?: boolean
  token?: boolean
  face_down?: boolean
  /** Transformada: mostra o verso */
  flipped?: boolean
}
export type ReplayBoard = {
  seat: number
  life: number
  poison: number
  counts: { hand: number; library: number; graveyard: number; exile: number }
  field: ReplayCard[]
  /** Cemitério e exílio (ids, de baixo para cima); partidas antigas não têm */
  gy?: string[]
  ex?: string[]
  /** A mão (aberta ao rever); partidas antigas não têm */
  hd?: string[]
}
/** Evento do registro; `b`: os lugares que mudaram com esta ação (como ficaram depois dela) */
export type ReplayEvent = LogItem & { b?: ReplayBoard[] }
export type ReplayTurn = {
  turn: number
  player: string | null
  took: number | null
  boards: ReplayBoard[]
  events: ReplayEvent[]
}
export type ReplayPlayer = {
  name: string
  seat: number
  deck: { kind: 'precon' | 'user'; ref: string; name: string }
}
export type Replay = {
  id: number
  finished_at: string
  started: number
  ended: number
  winner: string | null
  players: ReplayPlayer[]
  turns: ReplayTurn[]
  /** A partida passou do limite de turnos guardados: os últimos não estão aqui */
  cut?: boolean
  /** Lugar de quem está vendo (o campo dele fica embaixo); null para o admin que não jogou */
  you?: number | null
  /** Nome e imagem de cada carta, por id (as cartas dos passos citam só o id); partidas antigas não têm */
  cards?: Record<string, { name: string; image: string; back?: string }>
  /** Fechou sem vencedor: dá para restaurar a mesa e continuar a partida */
  restorable?: boolean
  /** Mesa restaurada desta partida que continua aberta (código) */
  table?: string | null
  /** Chave do link público (só para quem jogou); null: desligado */
  share?: string | null
  /** Aberta pelo link público: jogadores que não autorizaram aparecem como "Player N" */
  shared?: boolean
}
export type ReplaySummary = {
  id: number
  finished_at: string
  turns: number
  minutes: number
  winner: string | null
  players: { name: string; deck: string }[]
  restorable?: boolean
  table?: string | null
}

/**
 * Um passo da partida: depois de uma ação (`event`) ou o fim do turno (`event` null). `changed`:
 * lugares que mudaram; `cards`: cartas do campo que entraram ou mudaram (posição, virada, marcadores).
 */
export type ReplayStep = {
  turn: number
  event: number | null
  boards: ReplayBoard[]
  changed: number[]
  cards: string[]
}

const cardState = (c: ReplayCard) =>
  JSON.stringify([c.x, c.y, c.tapped, c.slot, c.counters, c.stats, c.attached_to, c.image, c.face_down])

/** A partida com nome e imagem em cada carta do campo (vêm do dicionário `cards`) */
export function replayNamed(r: Replay): Replay {
  const cards = r.cards
  if (!cards) return r
  const card = (c: ReplayCard): ReplayCard => {
    const face = c.id && !c.face_down && !c.name ? cards[c.id] : undefined
    if (!face) return c
    return { ...c, name: face.name, image: c.flipped && face.back ? face.back : face.image }
  }
  const board = (b: ReplayBoard): ReplayBoard => ({ ...b, field: b.field.map(card) })
  return {
    ...r,
    turns: r.turns.map((turn) => ({
      ...turn,
      boards: turn.boards.map(board),
      events: turn.events.map((e) => (e.b ? { ...e, b: e.b.map(board) } : e)),
    })),
  }
}

/**
 * Partida do link público: quem não autorizou o nome vem como "Player N" (N = o lugar) em todo
 * lugar (jogadores, turnos, registro, vencedor); aqui vira o texto traduzido.
 */
export function replayAliases(r: Replay, label: (seat: number) => string): Replay {
  const alias = new Map(
    r.players.filter((p) => p.name === `Player ${p.seat}`).map((p) => [p.name, label(p.seat)] as const),
  )
  if (!alias.size) return r
  const swap = (value: unknown): unknown => {
    if (typeof value === 'string') return alias.get(value) ?? value
    if (Array.isArray(value)) return value.map(swap)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swap(v)]))
    return value
  }
  return swap(r) as Replay
}

const NO_UNDO = { count: 0, last: null, checkpoints: [], request: null }
const NO_OPTIONS = { title: '', style: null, friends_only: false, allow_watch: false }

/**
 * Um passo como o estado de uma mesa (o mesmo que o servidor manda durante a partida), para a
 * página desenhar com a própria mesa. Id de cada jogador = o lugar dele. `lit`: cartas que brilham
 * (as que a ação mexeu). Partida guardada antes das posições: as cartas ficam em fileiras.
 */
export function replayTable(r: Replay, step: ReplayStep, lit: Set<string>): TableState {
  const turn = r.turns[step.turn]
  const zone = (ids: string[] | undefined): TableCard[] =>
    (ids ?? []).map((id) => ({ id, name: r.cards?.[id]?.name ?? '', image: r.cards?.[id]?.image ?? '', back: '' }))
  const players: TablePlayer[] = step.boards.map((b) => {
    const p = r.players.find((x) => x.seat === b.seat)
    const battlefield: FieldCard[] = b.field.map((c, i) => ({
      id: c.id || `${b.seat}-${i}`,
      name: c.face_down ? '' : (c.name ?? ''),
      image: c.face_down ? '' : (c.image ?? ''),
      back: '',
      x: c.x ?? 0.04 + (i % 9) * 0.11,
      y: c.y ?? Math.floor(i / 9) * 0.5,
      tapped: !!c.tapped,
      counters: c.counters ?? {},
      token: !!c.token,
      helper: false,
      commander: !!c.commander,
      stats: c.stats ?? null,
      base: null,
      owner: b.seat,
      controller: null,
      attached_to: c.attached_to ?? null,
      inverted: false,
      highlight: !!c.id && lit.has(c.id),
      locked: false,
      face_down: !!c.face_down,
      flipped: !!c.flipped,
      note: null,
      symbols: [],
      slot: c.slot ?? null,
    }))
    return {
      id: b.seat,
      name: p?.name ?? '?',
      seat: b.seat,
      life: b.life,
      online: true,
      afk: false,
      hand_shown: [],
      hand_spectators: false,
      deck: p?.deck ?? null,
      poison: b.poison,
      mana: {},
      opening: false,
      top_revealed: false,
      top: null,
      cmd_damage: {},
      tax: {},
      counts: { ...b.counts, battlefield: battlefield.length, command: 0, facedown: 0 },
      battlefield,
      graveyard: zone(b.gy),
      exile: zone(b.ex),
      command: [],
      hand: b.hd ? zone(b.hd) : null,
      facedown: null,
    }
  })
  const active = r.players.find((p) => p.name === turn.player)?.seat ?? null
  return {
    code: '',
    max_seats: Math.max(2, ...players.map((p) => p.seat)),
    players,
    log: [],
    dealt: [],
    result: null,
    undo: NO_UNDO,
    control: [],
    spectators: [],
    turn: { player: active, number: turn.turn },
    idle_left: 0,
    idle_close: 0,
    you: r.you ?? players[0]?.seat ?? 0,
    options: NO_OPTIONS,
    started: true,
    end_request: null,
    close_request: null,
  }
}

/** Cartas do campo que entraram ou mudaram de um passo para o outro */
function changedCards(before: ReplayBoard[] | undefined, after: ReplayBoard[]): string[] {
  const old = new Map<string, string>()
  for (const b of before ?? []) for (const c of b.field) if (c.id) old.set(c.id, cardState(c))
  const out: string[] = []
  for (const b of after) for (const c of b.field) if (c.id && old.get(c.id) !== cardState(c)) out.push(c.id)
  return before ? out : []
}

/**
 * Todos os passos, na ordem: cada ação de cada turno e o fim do turno. A mesa de cada passo vem
 * da anterior com os lugares que a ação mudou; lugar sem foto ainda (começo da partida) usa a do
 * fim do turno.
 */
export function replaySteps(r: Replay): ReplayStep[] {
  const steps: ReplayStep[] = []
  const now = new Map<number, ReplayBoard>()
  r.turns.forEach((turn, ti) => {
    const boards = () => turn.boards.map((b) => now.get(b.seat) ?? b)
    turn.events.forEach((e, ei) => {
      for (const b of e.b ?? []) now.set(b.seat, b)
      const after = boards()
      steps.push({
        turn: ti,
        event: ei,
        boards: after,
        changed: (e.b ?? []).map((b) => b.seat),
        cards: changedCards(steps.at(-1)?.boards, after),
      })
    })
    const before = boards()
    for (const b of turn.boards) now.set(b.seat, b)
    // Fim do turno: o que mudou sem entrar no registro (virar cartas, mexer no campo) aparece aqui
    const changed = turn.boards.filter((b, i) => JSON.stringify(b) !== JSON.stringify(before[i])).map((b) => b.seat)
    steps.push({
      turn: ti,
      event: null,
      boards: turn.boards,
      changed: turn.events.length ? changed : [],
      cards: changedCards(steps.at(-1)?.boards, turn.boards),
    })
  })
  return steps
}

const cardName = (c: ReplayCard, t: T) => (c.face_down ? t('a face-down card') : (c.name ?? ''))

/** A partida inteira em texto: cada turno, o que aconteceu e como ficou o campo de cada um */
export function replayText(r: Replay, t: T, locale: string): string {
  const name = (seat: number) => r.players.find((p) => p.seat === seat)?.name ?? '?'
  const lines = [
    t('Game of {date}', {
      date: new Date(r.finished_at).toLocaleString(locale),
    }),
    r.players.map((p) => `${p.name} (${p.deck.name})`).join(' × '),
    r.winner ? t('{name} won', { name: r.winner }) : t('No winner'),
    t('{n} turns · {time}', {
      n: r.turns.length,
      time: fmtClock(r.ended - r.started),
    }),
    '',
  ]
  for (const turn of r.turns) {
    lines.push(
      `== ${t('Turn {n}', { n: turn.turn })}${turn.player ? ` · ${turn.player}` : ''}${turn.took != null ? ` · ${fmtClock(turn.took)}` : ''}`,
    )
    for (const e of turn.events) lines.push(`- ${logText(t, e)}`)
    for (const b of turn.boards) {
      const field = b.field.map((c) => cardName(c, t) + (c.tapped ? ' (T)' : '')).join(', ')
      lines.push(`  ${name(b.seat)}: ${t('{n} life', { n: b.life })} · ${field || '—'}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
