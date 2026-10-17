import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useT } from '../lib/i18n'
import { beginOAuth, oauthErrorText, PROVIDER_NAMES } from '../lib/oauth'
import type { SocialProvider } from '../lib/types'

/** Logos oficiais (marcas de cada serviço, só para identificar o botão) */
function ProviderLogo({ provider }: { provider: SocialProvider }) {
  if (provider === 'google')
    return (
      <svg viewBox="0 0 48 48" className="h-5 w-5 shrink-0" aria-hidden>
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
    )
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor" aria-hidden>
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.37-.44.86-.61 1.25a18.3 18.3 0 0 0-5.49 0 12.6 12.6 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.89 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.89.08.08 0 0 1-.01-.13l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1-.01.13c-.6.35-1.22.65-1.87.89a.08.08 0 0 0-.04.11c.36.7.77 1.36 1.22 1.99a.08.08 0 0 0 .08.03 19.8 19.8 0 0 0 6.01-3.03.08.08 0 0 0 .03-.06c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42s.96-2.42 2.16-2.42c1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42zm7.98 0c-1.18 0-2.16-1.09-2.16-2.42s.96-2.42 2.16-2.42c1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42z" />
    </svg>
  )
}

const STYLE: Record<SocialProvider, string> = {
  google: 'bg-white text-[#1f1f1f] hover:bg-white/90',
  discord: 'bg-[#5865F2] text-white hover:bg-[#4f5bdc]',
}

/**
 * Botões "Continuar com Google/Discord" (entrar) ou "Conectar" (página da conta). Só aparecem os
 * serviços configurados no servidor.
 */
export function SocialButtons({
  mode,
  next = '/',
  linked = [],
}: {
  mode: 'login' | 'connect'
  next?: string
  linked?: SocialProvider[]
}) {
  const t = useT()
  const providers = useQuery({ queryKey: ['oauth-providers'], queryFn: api.oauthProviders, staleTime: 3_600_000 })
  const [busy, setBusy] = useState<SocialProvider | null>(null)
  const [error, setError] = useState<string | null>(null)
  const list = providers.data?.providers ?? []
  if (!list.length) return null

  const go = async (provider: SocialProvider) => {
    setBusy(provider)
    setError(null)
    try {
      await beginOAuth(provider, mode, next)
    } catch (err) {
      setBusy(null)
      // O servidor manda o código do erro em "detail" (ex.: not_configured)
      setError(
        err instanceof ApiError && /^[a-z_]+$/.test(err.message)
          ? oauthErrorText(t, err.message)
          : t('Could not connect.'),
      )
    }
  }

  return (
    <div className="space-y-2">
      {list.map((provider) => {
        const name = PROVIDER_NAMES[provider]
        const done = mode === 'connect' && linked.includes(provider)
        return (
          <button
            key={provider}
            type="button"
            onClick={() => go(provider)}
            disabled={!!busy || done}
            className={`flex h-11 w-full items-center justify-center gap-3 rounded-lg px-4 text-sm font-semibold shadow-[0_6px_18px_-8px_rgb(0_0_0/0.8)] transition hover:-translate-y-px disabled:cursor-default disabled:hover:translate-y-0 ${
              done ? 'border border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : STYLE[provider]
            } ${busy && busy !== provider ? 'opacity-50' : ''}`}
          >
            {!done && <ProviderLogo provider={provider} />}
            {done
              ? t('{name} connected', { name })
              : busy === provider
                ? t('Opening {name}…', { name })
                : mode === 'connect'
                  ? t('Connect {name}', { name })
                  : t('Continue with {name}', { name })}
          </button>
        )
      })}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
