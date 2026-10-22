import { useTitle } from '../hooks/useTitle'
import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import AuthForm, { type AuthMode } from '@/components/auth/AuthForm'
import { AuthHeading, AuthShowcase } from '@/components/auth/AuthModal'
import AuthArt from '@/components/auth/AuthArt'
import { LogoMark } from '@/components/Logo'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'

/**
 * Página /login (links diretos e páginas que pedem login): o mesmo visual do modal, com o
 * arte de um comandante ao lado do formulário.
 */
export default function LoginPage() {
  const t = useT()
  useTitle(t('Sign in'))
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { next?: string; notice?: string } | null
  const next = state?.next ?? '/my-pool'

  // "/login?signup" abre direto na aba de criar conta
  const wantsRegister = new URLSearchParams(location.search).has('signup')
  const [mode, setMode] = useState<AuthMode>(wantsRegister ? 'register' : 'login')
  const [lastSearch, setLastSearch] = useState(location.search)
  if (location.search !== lastSearch) {
    setLastSearch(location.search)
    setMode(wantsRegister ? 'register' : 'login')
  }

  if (user) return <Navigate to={next} replace />

  return (
    <section className="mx-auto grid max-w-[880px] overflow-hidden rounded-2xl border border-gold/15 bg-ink shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9)] md:grid-cols-[1fr_1.1fr]">
      <div className="hidden md:flex">
        <AuthShowcase />
      </div>
      <div className="relative isolate space-y-6 p-6 sm:p-8">
        <AuthArt className="opacity-40 md:hidden" credit={false} />
        <LogoMark className="h-10 w-10 md:hidden" />
        <AuthHeading mode={mode} />
        <AuthForm
          mode={mode}
          onModeChange={setMode}
          onSuccess={() => navigate(next, { replace: true })}
          next={next}
          notice={state?.notice}
        />
      </div>
    </section>
  )
}
