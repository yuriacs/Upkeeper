/*
 * Texto oficial das cartas (Oracle, com as erratas) para a carta ampliada da mesa e do
 * deckbuilder: nome original, custo, tipo e texto de cada face, do Scryfall. As cartas pedidas
 * juntas vão numa consulta só (/cards/collection, 75 por vez) e ficam guardadas enquanto a página
 * estiver aberta. A arte personalizada pode esconder o nome e o texto: aqui eles aparecem sempre.
 */
import { useEffect, useSyncExternalStore } from 'react'

export type OracleFace = {
  name: string
  manaCost: string
  typeLine: string
  text: string
  /** Força/resistência ("3/3") ou lealdade, quando a face tem */
  stats: string
}

/** `dfc`: carta de duas faces de verdade (frente e verso), em que só uma aparece por vez */
export type Oracle = { name: string; faces: OracleFace[]; dfc: boolean }

type ScryFace = {
  name: string
  mana_cost?: string
  type_line?: string
  oracle_text?: string
  power?: string
  toughness?: string
  loyalty?: string
  defense?: string
}
type ScryCard = ScryFace & { layout?: string; card_faces?: ScryFace[] }

const DFC_LAYOUTS = new Set(['transform', 'modal_dfc', 'reversible_card', 'meld'])
const TOKEN_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series'])

/** Chave da carta: o nome da frente, em minúsculas ("Delver of Secrets // Insectile Aberration" → "delver of secrets") */
const keyOf = (name: string) => name.split(' // ')[0].trim().toLowerCase()

// Carta guardada (null = o Scryfall não conhece) e as já pedidas, esperando a resposta
const cache = new Map<string, Oracle | null>()
const requested = new Set<string>()
const queue = new Map<string, string>()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined
let running = false

const emit = () => listeners.forEach((fn) => fn())
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function face(f: ScryFace): OracleFace {
  const stats = f.power != null && f.toughness != null ? `${f.power}/${f.toughness}` : (f.loyalty ?? f.defense ?? '')
  return { name: f.name, manaCost: f.mana_cost ?? '', typeLine: f.type_line ?? '', text: f.oracle_text ?? '', stats }
}

function toOracle(c: ScryCard): Oracle {
  const faces = c.card_faces?.length ? c.card_faces.map(face) : [face(c)]
  return { name: c.name, faces, dfc: DFC_LAYOUTS.has(c.layout ?? '') && faces.length > 1 }
}

async function flush() {
  if (running) return
  running = true
  try {
    while (queue.size) {
      const batch = [...queue.entries()].slice(0, 75)
      for (const [key] of batch) queue.delete(key)
      let found: ScryCard[] = []
      try {
        const r = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ identifiers: batch.map(([, name]) => ({ name })) }),
        })
        if (!r.ok) throw new Error(`Scryfall ${r.status}`)
        found = ((await r.json()) as { data?: ScryCard[] }).data ?? []
      } catch {
        // Sem rede ou Scryfall fora: tenta de novo na próxima vez que a carta for ampliada
        for (const [key] of batch) requested.delete(key)
        continue
      }
      const byName = new Map<string, Oracle>()
      for (const c of found) {
        if (TOKEN_LAYOUTS.has(c.layout ?? '')) continue
        const oracle = toOracle(c)
        for (const n of [c.name, ...oracle.faces.map((f) => f.name)]) byName.set(keyOf(n), oracle)
      }
      for (const [key] of batch) cache.set(key, byName.get(key) ?? null)
      emit()
      if (queue.size) await new Promise((r) => setTimeout(r, 100)) // o Scryfall pede um respiro entre consultas
    }
  } finally {
    running = false
  }
}

/** Pede o texto destas cartas (as já guardadas não são pedidas de novo) */
export function prefetchOracle(names: string[]) {
  let added = false
  for (const name of names) {
    const key = keyOf(name)
    if (!key || cache.has(key) || requested.has(key)) continue
    requested.add(key)
    queue.set(key, name.split(' // ')[0].trim())
    added = true
  }
  if (!added) return
  clearTimeout(timer)
  timer = setTimeout(flush, 40) // junta as cartas pedidas no mesmo instante numa consulta só
}

/** Texto oficial da carta: undefined enquanto carrega, null se o Scryfall não conhece */
export function useOracle(name: string | null | undefined): Oracle | null | undefined {
  const key = name ? keyOf(name) : ''
  const value = useSyncExternalStore(
    subscribe,
    () => (key ? cache.get(key) : null),
    () => undefined,
  )
  useEffect(() => {
    if (name) prefetchOracle([name])
  }, [name])
  return value
}
