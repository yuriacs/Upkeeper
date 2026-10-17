import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AuthMode } from './AuthForm'

// O modal (animações, tabuleiro, formulário) só é baixado na primeira vez que alguém o abre
const AuthModal = lazy(() => import('./AuthModal'))

type OpenOptions = {
  /** Aviso em destaque no topo do formulário (ex.: senha trocada) */
  notice?: string
  /** Chamado quando o modal fecha: true se a conta entrou */
  onClose?: (signedIn: boolean) => void
}

type AuthDialogContext = { openAuth: (mode?: AuthMode, options?: OpenOptions) => void }

const Context = createContext<AuthDialogContext>({ openAuth: () => {} })

/** Abre o modal de entrar/criar conta de qualquer lugar, por cima da página atual. */
// eslint-disable-next-line react-refresh/only-export-components
export const useAuthDialog = () => useContext(Context)

export function AuthDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(false)
  const [mode, setMode] = useState<AuthMode>('login')
  const [notice, setNotice] = useState<string | undefined>()
  const onClose = useRef<OpenOptions['onClose']>(undefined)

  const openAuth = useCallback((m: AuthMode = 'login', options: OpenOptions = {}) => {
    setMode(m)
    setNotice(options.notice)
    onClose.current = options.onClose
    setUsed(true)
    setOpen(true)
  }, [])
  const close = useCallback((signedIn: boolean) => {
    setOpen(false)
    const cb = onClose.current
    onClose.current = undefined
    cb?.(signedIn)
  }, [])
  const value = useMemo(() => ({ openAuth }), [openAuth])

  return (
    <Context.Provider value={value}>
      {children}
      {used && (
        <Suspense fallback={null}>
          <AuthModal
            open={open}
            onDismiss={() => close(false)}
            onSuccess={() => close(true)}
            mode={mode}
            onModeChange={setMode}
            notice={notice}
          />
        </Suspense>
      )}
    </Context.Provider>
  )
}
