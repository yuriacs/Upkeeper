import { useState, type FormEvent } from 'react'
import { useTitle } from '../hooks/useTitle'
import { api, ApiError } from '../lib/api'
import { useT } from '../lib/i18n'
import { useAuthDialog } from '../components/auth/AuthDialog'

const inputClass =
  'w-full rounded-lg border border-line bg-ink px-4 py-2.5 placeholder:text-parchment/30 focus:border-gold focus:outline-none'

export default function ForgotPasswordPage() {
  const t = useT()
  const { openAuth } = useAuthDialog()
  useTitle(t('Forgot your password?'))
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.forgotPassword(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Could not connect.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto max-w-sm space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl text-parchment">{t('Forgot your password?')}</h1>
        <p className="text-sm text-parchment/60">
          {t('Type the email of your account and we’ll send a link to choose a new password.')}
        </p>
      </div>
      {sent ? (
        <div className="space-y-3 rounded-lg border border-line bg-surface/60 p-4 text-sm text-parchment/80">
          <p>{t('If there is an account with this email, the link is on its way. It works for 1 hour.')}</p>
          <p className="text-parchment/60">{t('Didn’t get it? Check your spam folder, or try again in 2 minutes.')}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-1 text-sm">
            <span className="text-parchment/70">{t('Email')}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              autoFocus
              className={inputClass}
            />
          </label>
          <p className="text-xs text-parchment/50">
            {t('We don’t keep your email in readable form: it’s used to send this message and then discarded.')}
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md btn-ember px-6 py-3 font-display text-xl tracking-wide text-ink transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? t('Please wait…') : t('Send link')}
          </button>
        </form>
      )}
      <p className="text-center text-sm">
        <button type="button" onClick={() => openAuth('login')} className="text-parchment/60 underline hover:text-gold">
          {t('Back to sign in')}
        </button>
      </p>
    </section>
  )
}
