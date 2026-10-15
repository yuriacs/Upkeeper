import { api } from './api'
import type { SocialProvider } from './types'

/*
 * Login com Google e Discord: o servidor monta a URL do serviço e um "nonce" que fica guardado
 * nesta aba até a volta (/entrar/social/<serviço>). Sem ele, um link de volta montado por outra
 * pessoa não entra na conta dela neste navegador.
 */
const KEY = 'upkeeper:oauth'

export type OAuthPending = { provider: SocialProvider; nonce: string; mode: 'login' | 'connect'; next: string }

export const PROVIDER_NAMES: Record<SocialProvider, string> = { google: 'Google', discord: 'Discord' }

export async function beginOAuth(provider: SocialProvider, mode: 'login' | 'connect', next: string) {
  const { url, nonce } = await api.oauthStart(provider, mode)
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ provider, nonce, mode, next } satisfies OAuthPending))
  } catch {
    /* sem sessionStorage a volta mostra o erro e a pessoa entra com senha */
  }
  window.location.assign(url)
}

export function takePending(): OAuthPending | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return raw ? (JSON.parse(raw) as OAuthPending) : null
  } catch {
    return null
  }
}

/** Caminho interno seguro para voltar depois do login (nada de "//outro-site") */
export const safeNext = (next: string | undefined | null, fallback: string) =>
  next && next.startsWith('/') && !next.startsWith('//') ? next : fallback

/** Texto do erro que o servidor manda (code) na volta do login social */
export function oauthErrorText(t: (s: string, v?: Record<string, string | number>) => string, code: string) {
  return (
    {
      denied: t('Sign-in was cancelled.'),
      invalid_state: t('This sign-in link expired or was opened in another tab. Try again.'),
      provider_error: t('Could not talk to the service. Try again in a moment.'),
      email_in_use: t(
        'There is already an account with this email. Sign in with your username and password, then connect it on the My account page.',
      ),
      already_linked: t('This account is already connected to another Upkeeper account.'),
      provider_taken: t('Your account is already connected to another account from this service.'),
      not_configured: t('This sign-in option is not available right now.'),
      inactive: t('This account is disabled.'),
      try_again: t('Something went wrong. Try again.'),
    }[code] ?? t('Something went wrong. Try again.')
  )
}
