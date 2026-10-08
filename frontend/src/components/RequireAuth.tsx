import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <p className="text-center text-parchment/60">Carregando…</p>
  if (!user) return <Navigate to="/entrar" replace state={{ next: location.pathname }} />
  return <>{children}</>
}
