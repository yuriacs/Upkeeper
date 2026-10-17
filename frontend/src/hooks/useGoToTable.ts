import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthDialog } from '@/components/auth/AuthDialog'
import { useAuth } from '@/lib/auth'

/**
 * Vai para uma mesa. A mesa pede conta: sem login, abre o modal de entrar por cima da página
 * atual e só segue para a mesa depois que a pessoa entra (fechar o modal deixa onde está).
 */
export function useGoToTable() {
  const { user } = useAuth()
  const { openAuth } = useAuthDialog()
  const navigate = useNavigate()
  return useCallback(
    (path: string) => {
      if (user) navigate(path)
      else openAuth('login', { onClose: (signedIn) => signedIn && navigate(path) })
    },
    [user, navigate, openAuth],
  )
}
