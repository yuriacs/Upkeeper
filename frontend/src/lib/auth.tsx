import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loginAccount, registerAccount } from './account'
import { api, ApiError, setAuthToken } from './api'
import { localDecks } from './localDecks'
import { showRecoveryCode } from './recoveryCode'
import { readJSON, writeJSON } from './storage'
import type { AuthResponse, User } from './types'
import { forgetKeys } from './vault'

const TOKEN_KEY = 'precon-draft:auth'

type Stored = { token: string; user: User } | null

type AuthContextValue = {
  user: User | null
  ready: boolean
  login: (login: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** Login que já chegou pronto (Google/Discord) */
  startSession: (res: AuthResponse) => Promise<void>
  /** Dados da conta mudaram (ex.: ligou o Google) */
  updateUser: (user: User) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Define o token já na carga do módulo, antes da primeira requisição
const initial = readJSON<Stored>(TOKEN_KEY, null)
setAuthToken(initial?.token ?? null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Stored>(initial)
  // A sessão salva vale de imediato; a conferência com o servidor acontece em segundo plano
  const ready = true

  const clear = useCallback(() => {
    writeJSON(TOKEN_KEY, null)
    setAuthToken(null)
    setSession(null)
    // A chave do cofre sai deste navegador junto com a sessão
    void forgetKeys()
    showRecoveryCode(null)
    queryClient.removeQueries({ queryKey: ['me'] })
    queryClient.removeQueries({ queryKey: ['vault'] })
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
    // Só desloga se o servidor disser que o token não vale (401). Se ele estiver acordando
    // ou a rede falhar, segue com a sessão salva e confere de novo mais tarde.
    let cancelled = false
    const check = async (attempt: number): Promise<void> => {
      try {
        const user = await api.me()
        if (!cancelled) {
          // Regrava a sessão com os dados novos (e sem campos antigos, como o e-mail)
          writeJSON(TOKEN_KEY, { token: initial.token, user })
          setSession({ token: initial.token, user })
        }
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) clear()
        else if (attempt < 5) setTimeout(() => void check(attempt + 1), Math.min(2000 * 2 ** attempt, 20000))
      }
    }
    void check(0)
    return () => {
      cancelled = true
    }
  }, [clear])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      ready,
      // A senha fica no navegador: vai a chave derivada dela (lib/account.ts)
      login: async (login, password) => {
        const { res, recoveryCode } = await loginAccount(login, password)
        await start(res)
        showRecoveryCode(recoveryCode)
      },
      register: async (username, email, password) => {
        const { res, recoveryCode } = await registerAccount(username, email, password)
        await start(res)
        showRecoveryCode(recoveryCode)
      },
      logout: async () => {
        try {
          await api.logout()
        } finally {
          clear()
        }
      },
      startSession: start,
      updateUser: (user) => {
        if (!session) return
        writeJSON(TOKEN_KEY, { token: session.token, user })
        setSession({ token: session.token, user })
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
