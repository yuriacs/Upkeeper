import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useT } from '../lib/i18n'
import { beginOAuth, oauthErrorText, PROVIDER_NAMES } from '../lib/oauth'
import type { SocialProvider } from '../lib/types'

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
            className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition disabled:cursor-default ${
              done ? 'border border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : STYLE[provider]
            } ${busy && busy !== provider ? 'opacity-50' : ''}`}
          >
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
