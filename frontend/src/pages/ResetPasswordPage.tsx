import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { vaultErrorText } from '../components/PrivateProfileCard'
import { RecoveryCodeBox } from '../components/RecoveryCodeDialog'
import { useTitle } from '../hooks/useTitle'
import { resetPassword } from '../lib/account'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'

const inputClass =
  'w-full rounded-lg border border-line bg-ink px-4 py-2.5 placeholder:text-parchment/30 focus:border-gold focus:outline-none'

/** O link do e-mail traz uid e token depois do "#" (essa parte não vai para servidor nenhum). */
function linkParams() {
  const params = new URLSearchParams(window.location.hash.slice(1))
  return { uid: params.get('u') ?? '', token: params.get('t') ?? '' }
}

export default function ResetPasswordPage() {
  const t = useT()
  useTitle(t('Choose a new password'))
  const navigate = useNavigate()
  const [{ uid, token }] = useState(linkParams)
  const check = useQuery({
    queryKey: ['reset-check', uid, token],
    queryFn: () => api.resetCheck(uid, token),
    enabled: !!uid && !!token,
    retry: false,
    staleTime: Infinity,
  })
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newCode, setNewCode] = useState<string | null>(null)

  const done = () =>
    navigate('/entrar', { replace: true, state: { notice: t('Password changed. Sign in with the new one.') } })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!check.data) return
    if (password.length < 8) return setError(t('At least 8 characters.'))
    if (/^\d+$/.test(password)) return setError(t('Use letters too, not only numbers.'))
    if (password !== repeat) return setError(t('The passwords don’t match.'))
    setBusy(true)
    setError(null)
    try {
      const res = await resetPassword(uid, token, password, check.data.vault, code.trim() || undefined)
      if (res.recoveryCode) setNewCode(res.recoveryCode)
      else done()
    } catch (err) {
      setError(vaultErrorText(t, err))
    } finally {
      setBusy(false)
    }
  }

  if (newCode) {
    return (
      <section className="mx-auto max-w-md space-y-4">
        <p className="text-center text-sm text-emerald-300">{t('Password changed.')}</p>
        <RecoveryCodeBox code={newCode} onDone={done} />
      </section>
    )
  }

  if (!uid || !token || check.isError) {
    return (
      <section className="mx-auto max-w-sm space-y-4 text-center">
        <h1 className="font-display text-3xl text-parchment">{t('Choose a new password')}</h1>
        <p className="text-sm text-red-400">{t('This link is invalid or has expired. Ask for a new one.')}</p>
        <Link to="/esqueci-a-senha" className="text-gold underline">
          {t('Ask for a new link')}
        </Link>
      </section>
    )
  }

  if (!check.data) return <p className="text-center text-parchment/50">{t('Loading…')}</p>

  const hasVault = check.data.vault.exists
  return (
    <section className="mx-auto max-w-sm space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl text-parchment">{t('Choose a new password')}</h1>
        <p className="text-sm text-parchment/60">
          {t('Account: {name}', { name: check.data.username })}
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <input type="text" value={check.data.username} autoComplete="username" readOnly hidden />
        <label className="block space-y-1 text-sm">
          <span className="text-parchment/70">{t('New password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
            autoFocus
            className={inputClass}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-parchment/70">{t('Repeat the new password')}</span>
          <input
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
            className={inputClass}
          />
        </label>
        {hasVault && (
          <div className="space-y-2 rounded-lg border border-gold/25 bg-surface/60 p-3">
            <label className="block space-y-1 text-sm">
              <span className="text-parchment/70">🔒 {t('Recovery code (optional)')}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-…"
                className={`${inputClass} font-mono`}
              />
            </label>
            <p className="text-xs text-parchment/60">
              {code.trim()
                ? t('Your private profile will be kept and locked with the new password.')
                : t(
                    'Without the code, your private profile (like your email copy) starts empty. Your decks, history and sign-in email are not affected.',
                  )}
            </p>
          </div>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-gold px-6 py-3 font-display text-xl tracking-wide text-ink transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? t('Encrypting…') : t('Save new password')}
        </button>
      </form>
    </section>
  )
}
