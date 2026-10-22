import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTitle } from '../hooks/useTitle'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { useAuthDialog } from '../components/auth/AuthDialog'
import { oauthErrorText, PROVIDER_NAMES, safeNext, takePending } from '../lib/oauth'
import type { SocialProvider } from '../lib/types'

/**
 * Volta do Google/Discord (/login/social/<serviço>?code&state): manda o code, o state e o nonce
 * guardado nesta aba para o servidor, que devolve o login (ou liga o serviço à conta).
 */
export default function OAuthCallbackPage() {
  const t = useT()
  const { openAuth } = useAuthDialog()
  useTitle(t('Sign in'))
  const { provider } = useParams<{ provider: SocialProvider }>()
  const { startSession, updateUser } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return // o StrictMode roda o efeito duas vezes; o code só vale uma
    ran.current = true
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    // Tira o code da barra de endereço (e do histórico)
    window.history.replaceState(null, '', window.location.pathname)
    const pending = takePending()
    // Tudo assíncrono: o erro (se houver) chega depois, nunca durante o efeito
    const run = async (): Promise<string | null> => {
      if (params.get('error')) return 'denied'
      if (!provider || !code || !state || !pending || pending.provider !== provider) return 'invalid_state'
      try {
        const res = await api.oauthComplete(provider, { code, state, nonce: pending.nonce })
        if ('token' in res) {
          await startSession(res)
          navigate(safeNext(pending.next, '/'), { replace: true })
        } else {
          updateUser(res.user)
          navigate(`/account?connected=${provider}`, { replace: true })
        }
        return null
      } catch (err) {
        return err instanceof ApiError && /^[a-z_]+$/.test(err.message) ? err.message : ''
      }
    }
    void run().then((code) => {
      if (code !== null) setError(code ? oauthErrorText(t, code) : t('Could not connect.'))
    })
  }, [provider, startSession, updateUser, navigate, t])

  const name = provider && provider in PROVIDER_NAMES ? PROVIDER_NAMES[provider] : ''
  return (
    <section className="mx-auto max-w-sm space-y-4 py-10 text-center">
      {error ? (
        <>
          <p className="text-red-300">{error}</p>
          <button type="button" onClick={() => openAuth('login')} className="inline-block text-gold underline">
            {t('Back to sign in')}
          </button>
        </>
      ) : (
        <p className="text-parchment/70">{t('Signing in with {name}…', { name })}</p>
      )}
    </section>
  )
}
