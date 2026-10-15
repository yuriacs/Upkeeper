import { useSyncExternalStore } from 'react'

/*
 * Código de recuperação recém-criado, esperando a pessoa guardar. Fica só na memória da aba:
 * o diálogo (components/RecoveryCodeDialog) mostra uma vez e esquece.
 */
let current: string | null = null
const listeners = new Set<() => void>()

export function showRecoveryCode(code: string | null | undefined) {
  current = code ?? null
  listeners.forEach((l) => l())
}

export function useRecoveryCode(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
