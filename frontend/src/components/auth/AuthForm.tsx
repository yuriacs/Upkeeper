import { useQuery } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Tabs, TabsContent, TabsContents, TabsList, TabsTrigger } from '@/components/animate-ui/components/radix/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SocialButtons } from '@/components/SocialButtons'
import { vaultErrorText } from '@/components/PrivateProfileCard'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useT } from '@/lib/i18n'
import { VaultError } from '@/lib/vault'

export type AuthMode = 'login' | 'register'

const inputClass =
  'h-11 rounded-lg border-parchment/15 bg-ink/60 px-3.5 text-[0.95rem] backdrop-blur placeholder:text-parchment/30 focus-visible:border-gold/70 focus-visible:ring-gold/15 focus-visible:outline-none md:text-[0.95rem]'

function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold tracking-[0.12em] text-parchment/60 uppercase">{label}</Label>
      {children}
      {hint && <p className="text-xs text-parchment/40">{hint}</p>}
      {error}
    </div>
  )
}

/** "ou" entre os botões do Google/Discord e o formulário (só aparece se houver botões) */
function SocialDivider() {
  const t = useT()
  return (
    <div className="flex items-center gap-3 text-xs text-parchment/40 [&:only-child]:hidden">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-parchment/15" />
      {t('or with username and password')}
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-parchment/15" />
    </div>
  )
}

/**
 * Entrar / criar conta: usado no modal do cabeçalho e na página /login. As abas e a altura
 * do formulário são animadas (Animate UI); os campos são do shadcn/ui.
 */
export default function AuthForm({
  mode,
  onModeChange,
  onSuccess,
  next = '/my-pool',
  notice,
}: {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onSuccess: () => void
  next?: string
  notice?: string
}) {
  const t = useT()
  const { login, register } = useAuth()
  const providers = useQuery({ queryKey: ['oauth-providers'], queryFn: api.oauthProviders, staleTime: 3_600_000 })
  const [loginValue, setLoginValue] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

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
      onSuccess()
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

  const passwordField = (
    <Field
      label={t('Password')}
      hint={
        mode === 'register' && (
          <>
            {t('At least 8 characters.')} {t('Your password never leaves your browser: it also locks your private profile.')}
          </>
        )
      }
      error={fieldError('password')}
    >
      {/* Olho: mostra ou esconde a senha */}
      <div className="relative">
        <Input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'register' ? 8 : undefined}
          className={`${inputClass} pr-11`}
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-label={showPassword ? t('Hide password') : t('Show password')}
          aria-pressed={showPassword}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center text-parchment/45 transition hover:text-gold"
        >
          {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </Field>
  )

  return (
    <Tabs
      value={mode}
      onValueChange={(value) => {
        onModeChange(value as AuthMode)
        setError(null)
      }}
      className="gap-5"
    >
      {/* Abas em pílula: trilho escuro e a opção ativa preenchida em dourado, que desliza */}
      <TabsList className="h-12 w-full rounded-full border border-parchment/10 bg-black/50 p-1.5 shadow-[inset_0_1px_3px_rgb(0_0_0/0.6)] backdrop-blur">
        {(['login', 'register'] as const).map((m) => (
          <TabsTrigger
            key={m}
            value={m}
            className="rounded-full text-[0.95rem] font-semibold text-parchment/70 transition-colors hover:text-parchment data-[state=active]:text-[#1a1204]"
          >
            {m === 'login' ? t('Sign in') : t('Create account')}
          </TabsTrigger>
        ))}
      </TabsList>

      {notice && (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </p>
      )}

      <div className="space-y-4">
        <SocialButtons mode="login" next={next} />
        <SocialDivider />
      </div>

      <form onSubmit={submit}>
        <TabsContents>
          <TabsContent value="login" className="space-y-4 p-px">
            {mode === 'login' && (
              <>
                <Field label={t('Username or email')}>
                  <Input
                    value={loginValue}
                    onChange={(e) => setLoginValue(e.target.value)}
                    autoComplete="username"
                    required
                    autoFocus
                    className={inputClass}
                  />
                </Field>
                {passwordField}
                {providers.data?.password_reset && (
                  <p className="-mt-2 text-right text-xs">
                    <Link to="/forgot-password" className="text-parchment/55 underline-offset-4 hover:text-gold hover:underline">
                      {t('Forgot your password?')}
                    </Link>
                  </p>
                )}
              </>
            )}
          </TabsContent>
          <TabsContent value="register" className="space-y-4 p-px">
            {mode === 'register' && (
              <>
                <Field
                  label={t('Username')}
                  hint={t('This is how your friends will add you to the table.')}
                  error={fieldError('username')}
                >
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                    autoFocus
                    minLength={3}
                    maxLength={30}
                    pattern="[\w.\-]+"
                    title={t('Letters, numbers, dot, hyphen or underscore')}
                    className={inputClass}
                  />
                </Field>
                <Field label={t('Email')} error={fieldError('email')}>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                    className={inputClass}
                  />
                </Field>
                {passwordField}
                <p className="text-xs text-parchment/50">
                  {t('By creating an account, you agree to the')}{' '}
                  <Link to="/privacy" className="text-gold/80 underline hover:text-gold">
                    {t('privacy policy')}
                  </Link>
                  .
                </p>
              </>
            )}
          </TabsContent>
        </TabsContents>

        {error && !Object.keys(error.fields).some((k) => ['username', 'email', 'password'].includes(k)) && (
          <p className="mt-4 text-sm text-red-400">{error.message}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="btn-ember mt-6 h-12 w-full rounded-lg font-display text-xl tracking-wide transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? t('Encrypting…') : mode === 'login' ? t('Sign in') : t('Create account')}
        </button>
      </form>
    </Tabs>
  )
}
