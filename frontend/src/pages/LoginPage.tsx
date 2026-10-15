import { useTitle } from '../hooks/useTitle'
import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { SocialButtons } from '../components/SocialButtons'
import { vaultErrorText } from '../components/PrivateProfileCard'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { VaultError } from '../lib/vault'

type Mode = 'login' | 'register'

const inputClass =
  'w-full rounded-lg border border-line bg-ink px-4 py-2.5 placeholder:text-parchment/30 focus:border-gold focus:outline-none'

/** "ou" entre os botões do Google/Discord e o formulário (só aparece se houver botões) */
function SocialDivider() {
  const t = useT()
  return (
    <div className="flex items-center gap-3 text-xs text-parchment/40 [&:only-child]:hidden">
      <span className="h-px flex-1 bg-line" />
      {t('or with username and password')}
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

export default function LoginPage() {
  const t = useT()
  useTitle(t('Sign in'))
  const { user, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { next?: string; notice?: string } | null
  const next = state?.next ?? '/minha-pool'
  const providers = useQuery({ queryKey: ['oauth-providers'], queryFn: api.oauthProviders, staleTime: 3_600_000 })

  const [mode, setMode] = useState<Mode>('login')
  const [loginValue, setLoginValue] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={next} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'register') {
        // O servidor não vê a senha (só a chave derivada dela): a conferência é aqui
        const weak =
          password.length < 8
            ? t('At least 8 characters.')
            : /^\d+$/.test(password)
              ? t('Use letters too, not only numbers.')
              : [username, email, email.split('@')[0]].some((v) => v && password.toLowerCase().includes(v.toLowerCase()))
                ? t('The password can’t contain your username or email.')
                : null
        if (weak) {
          setError(new ApiError(400, weak, [], { password: [weak] }))
          return
        }
      }
      if (mode === 'login') await login(loginValue, password)
      else await register(username, email, password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new ApiError(0, err instanceof VaultError ? vaultErrorText(t, err) : t('Could not connect.')),
      )
    } finally {
      setBusy(false)
    }
  }

  const fieldError = (name: string) =>
    error?.fields[name]?.length ? <p className="text-xs text-red-400">{error.fields[name].join(' ')}</p> : null

  return (
    <section className="mx-auto max-w-sm space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl text-parchment">
          {mode === 'login' ? t('Sign in') : t('Create account')}
        </h1>
        <p className="text-sm text-parchment/60">
          {t('With an account you can build your deck pool and join deals using the group’s decks.')}
        </p>
      </div>

      {state?.notice && (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
          {state.notice}
        </p>
      )}

      <div className="flex rounded-lg border border-line p-0.5 text-sm" role="tablist">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m)
              setError(null)
            }}
            className={`flex-1 rounded-md py-2 ${mode === m ? 'bg-parchment/10 text-gold' : 'text-parchment/60 hover:text-parchment'}`}
          >
            {m === 'login' ? t('Sign in') : t('Create account')}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <SocialButtons mode="login" next={next} />
        <SocialDivider />
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === 'login' ? (
          <label className="block space-y-1 text-sm">
            <span className="text-parchment/70">{t('Username or email')}</span>
            <input
              value={loginValue}
              onChange={(e) => setLoginValue(e.target.value)}
              autoComplete="username"
              required
              className={inputClass}
            />
          </label>
        ) : (
          <>
            <label className="block space-y-1 text-sm">
              <span className="text-parchment/70">{t('Username')}</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                minLength={3}
                maxLength={30}
                pattern="[\w.\-]+"
                title={t('Letters, numbers, dot, hyphen or underscore')}
                className={inputClass}
              />
              <span className="text-xs text-parchment/40">
                {t('This is how your friends will add you to the table.')}
              </span>
              {fieldError('username')}
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-parchment/70">{t('Email')}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className={inputClass}
              />
              {fieldError('email')}
            </label>
          </>
        )}
        <label className="block space-y-1 text-sm">
          <span className="text-parchment/70">{t('Password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 8 : undefined}
            className={inputClass}
          />
          {mode === 'register' && (
            <span className="text-xs text-parchment/40">
              {t('At least 8 characters.')} {t('Your password never leaves your browser: it also locks your private profile.')}
            </span>
          )}
          {fieldError('password')}
        </label>
        {mode === 'login' && providers.data?.password_reset && (
          <p className="-mt-2 text-right text-xs">
            <Link to="/esqueci-a-senha" className="text-parchment/60 underline hover:text-gold">
              {t('Forgot your password?')}
            </Link>
          </p>
        )}

        {error && !Object.keys(error.fields).some((k) => ['username', 'email', 'password'].includes(k)) && (
          <p className="text-sm text-red-400">{error.message}</p>
        )}

        {mode === 'register' && (
          <p className="text-xs text-parchment/50">
            {t('By creating an account, you agree to the')}{' '}
            <Link to="/privacidade" className="text-gold/80 underline hover:text-gold">
              {t('privacy policy')}
            </Link>
            .
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-gold font-display text-xl tracking-wide px-6 py-3 text-ink transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? t('Encrypting…') : mode === 'login' ? t('Sign in') : t('Create account')}
        </button>
      </form>
    </section>
  )
}
