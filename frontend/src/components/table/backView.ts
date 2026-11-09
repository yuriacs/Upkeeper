/*
 * Verso das cartas de duas faces na mão, só para você olhar (L com o mouse em cima, ou o menu da
 * carta): não vai para o servidor e ninguém mais vê. Ao jogar a carta ela entra pela frente; no
 * campo, o L vira a carta de verdade (todos veem).
 */
import { useSyncExternalStore } from 'react'

const shown = new Set<string>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Mostra o verso da carta da mão (ou volta para a frente) */
export function toggleBackView(id: string) {
  if (!shown.delete(id)) shown.add(id)
  emit()
}

/** Esquece as cartas que saíram da mão: se voltarem, voltam pela frente */
export function keepBackView(ids: string[]) {
  const keep = new Set(ids)
  let changed = false
  for (const id of [...shown]) {
    if (!keep.has(id)) {
      shown.delete(id)
      changed = true
    }
  }
  if (changed) emit()
}

/** A carta está mostrando o verso agora (só cartas fora do campo; no campo vale a carta virada) */
export const useBackView = (id: string | undefined) =>
  useSyncExternalStore(
    subscribe,
    () => !!id && shown.has(id),
    () => false,
  )
