import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setAuthToken } from './api'
import { localDecks } from './localDecks'
import { readJSON, writeJSON } from './storage'
import type { AuthResponse, User } from './types'

const TOKEN_KEY = 'precon-draft:auth'

type Stored = { token: string; user: User } | null

type AuthContextValue = {
  user: User | null
  ready: boolean
  login: (login: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Define o token já na carga do módulo, antes da primeira requisição
const initial = readJSON<Stored>(TOKEN_KEY, null)
setAuthToken(initial?.token ?? null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Stored>(initial)
  const [ready, setReady] = useState(!initial)

  const clear = useCallback(() => {
    writeJSON(TOKEN_KEY, null)
    setAuthToken(null)
    setSession(null)
    queryClient.removeQueries({ queryKey: ['me'] })
  }, [queryClient])

  const start = useCallback(
    async ({ token, user }: AuthResponse) => {
      writeJSON(TOKEN_KEY, { token, user })
      setAuthToken(token, clear)
      setSession({ token, user })
      // Leva para a conta os precons marcados antes do login (salvos só no navegador)
      const local = localDecks.get()
      if (local.length) {
        try {
          await api.addPrecons(local)
          localDecks.set([])
        } catch {
          /* tenta de novo no próximo login */
        }
      }
      queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    [clear, queryClient],
  )

  // Confere se o token salvo ainda vale
  useEffect(() => {
    if (!initial) return
    setAuthToken(initial.token, clear)
    api
      .me()
      .then((user) => setSession({ token: initial.token, user }))
      .catch(() => clear())
      .finally(() => setReady(true))
  }, [clear])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      ready,
      login: async (login, password) => start(await api.login(login, password)),
      register: async (username, email, password) => start(await api.register(username, email, password)),
      logout: async () => {
        try {
          await api.logout()
        } finally {
          clear()
        }
      },
    }),
    [session, ready, start, clear],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook acompanha o provider
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return ctx
}
