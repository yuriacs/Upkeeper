import { useTitle } from '../hooks/useTitle'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'

type Mode = 'login' | 'register'

const inputClass =
  'w-full rounded-lg border border-gold/20 bg-ink px-4 py-2.5 placeholder:text-parchment/30 focus:border-gold focus:outline-none'

export default function LoginPage() {
  useTitle('Entrar')
  const { user, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const next = (location.state as { next?: string } | null)?.next ?? '/minha-pool'

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
      if (mode === 'login') await login(loginValue, password)
      else await register(username, email, password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'Não foi possível conectar.'))
    } finally {
      setBusy(false)
    }
  }

  const fieldError = (name: string) =>
    error?.fields[name]?.length ? <p className="text-xs text-red-400">{error.fields[name].join(' ')}</p> : null

  return (
    <section className="mx-auto max-w-sm space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl text-gold">{mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>
        <p className="text-sm text-parchment/60">
          Com uma conta você monta sua deckpool e participa de sorteios com os decks do grupo.
        </p>
      </div>

      <div className="flex rounded-lg border border-gold/20 p-0.5 text-sm" role="tablist">
        {(['login', 'register'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m)
              setError(null)
            }}
            className={`flex-1 rounded-md py-2 ${mode === m ? 'bg-gold/20 text-gold' : 'text-parchment/60 hover:text-parchment'}`}
          >
            {m === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === 'login' ? (
          <label className="block space-y-1 text-sm">
            <span className="text-parchment/70">Usuário ou e-mail</span>
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
              <span className="text-parchment/70">Nome de usuário</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                minLength={3}
                maxLength={30}
                pattern="[\w.\-]+"
                title="Letras, números, ponto, hífen ou sublinhado"
                className={inputClass}
              />
              <span className="text-xs text-parchment/40">É como seus amigos vão te adicionar na mesa.</span>
              {fieldError('username')}
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-parchment/70">E-mail</span>
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
          <span className="text-parchment/70">Senha</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 8 : undefined}
            className={inputClass}
          />
          {mode === 'register' && <span className="text-xs text-parchment/40">Mínimo de 8 caracteres.</span>}
          {fieldError('password')}
        </label>

        {error && !Object.keys(error.fields).some((k) => ['username', 'email', 'password'].includes(k)) && (
          <p className="text-sm text-red-400">{error.message}</p>
        )}

        {mode === 'register' && (
          <p className="text-xs text-parchment/50">
            Ao criar a conta, você concorda com a{' '}
            <Link to="/privacidade" className="text-gold/80 underline hover:text-gold">
              política de privacidade
            </Link>
            .
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-gold px-6 py-3 font-semibold text-ink transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>
      </form>
    </section>
  )
}
