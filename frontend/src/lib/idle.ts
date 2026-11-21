/*
 * Pessoa parada: sem mexer o mouse, tocar na tela ou usar o teclado há IDLE_AFTER. Nesse estado as
 * consultas que se repetem sozinhas (amigos, conquistas, mesas abertas, torneios) param, porque
 * cada uma passa pelo banco (login por token) e uma aba esquecida aberta mantinha o Neon acordado
 * o dia todo. Ao voltar a mexer, as consultas ativas rodam na hora e o ritmo normal volta.
 */
import type { QueryClient } from '@tanstack/react-query'

export const IDLE_AFTER = 5 * 60_000

let last = Date.now()
let idle = false
let client: QueryClient | null = null

/** A pessoa está parada há IDLE_AFTER (ou mais) */
export function isIdle(): boolean {
  if (!idle && Date.now() - last >= IDLE_AFTER) idle = true
  return idle
}

/**
 * Para usar em `refetchInterval`: repete a cada `ms` só com a pessoa mexendo na página.
 * Parada, devolve false e a consulta para até ela voltar (ver `wake`).
 */
export function whileActive(ms: number): () => number | false {
  return () => (isIdle() ? false : ms)
}

function wake() {
  last = Date.now()
  if (!idle) return
  idle = false
  // As consultas paradas não têm mais um relógio: roda agora e o refetchInterval volta a contar
  client?.refetchQueries({ type: 'active', stale: true })
}

let started = false

/** Começa a observar a atividade (uma vez, em main.tsx) */
export function watchActivity(queryClient: QueryClient) {
  client = queryClient
  if (started || typeof window === 'undefined') return
  started = true
  const opts = { passive: true, capture: true } as const
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const) {
    window.addEventListener(ev, wake, opts)
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) wake()
  })
}
