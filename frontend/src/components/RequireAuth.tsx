import { LockKeyhole } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { useAuthDialog } from './auth/AuthDialog'

/**
 * No lugar de uma página que pede login: o modal de entrar abre por cima e, ao entrar, a página
 * aparece. Fechar sem entrar volta para a página anterior (o aviso só aparece por um instante).
 */
export function AuthGate({ message }: { message?: string }) {
  const t = useT()
  const { openAuth } = useAuthDialog()
  const navigate = useNavigate()
  // Abre o login por cima; ao entrar, a página aparece no lugar. Fechar sem entrar volta para
  // onde a pessoa estava (ou para o início, se ela chegou direto por um link)
  useEffect(() => {
    openAuth('login', {
      onClose: (signedIn) => {
        if (signedIn) return
        if (window.history.state?.idx > 0) navigate(-1)
        else navigate('/', { replace: true })
      },
    })
  }, [openAuth, navigate])
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full border border-gold/40 bg-gold/10 text-gold">
        <LockKeyhole className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="font-epic text-2xl font-semibold text-parchment">{t('Sign in to continue')}</h1>
      <p className="text-sm text-parchment/60">
        {message ?? t('With an account you can build your deck pool and join deals using the group’s decks.')}
      </p>
      <button
        type="button"
        onClick={() => openAuth('login')}
        className="btn-ember mt-2 rounded-md px-6 py-2.5 font-display text-xl tracking-wide transition hover:brightness-110"
      >
        {t('Sign in or create account')}
      </button>
    </section>
  )
}

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const t = useT()
  if (!ready) return <p className="text-center text-parchment/60">{t('Loading…')}</p>
  if (!user) return <AuthGate />
  return <>{children}</>
}
