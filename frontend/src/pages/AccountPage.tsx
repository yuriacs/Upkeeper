import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'

export default function AccountPage() {
  const t = useT()
  useTitle(t('My account'))
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [password, setPassword] = useState('')

  const exportData = useMutation({
    mutationFn: () => api.exportAccount(`choose-at-random-${user?.username}.json`),
  })
  const [confirmReset, setConfirmReset] = useState(false)
  const resetHistory = useMutation({
    mutationFn: api.resetMyHistory,
    onSuccess: () => setConfirmReset(false),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteAccount(password),
    onSuccess: async () => {
      await logout().catch(() => undefined)
      navigate('/', { replace: true })
    },
  })

  if (!user) return null

  return (
    <section className="mx-auto max-w-xl space-y-8">
      <div className="space-y-1">
        <h1 className="font-display text-3xl text-gold">{t('My account')}</h1>
        <p className="text-parchment/70">
          <strong className="text-parchment">{user.username}</strong> · {user.email}
        </p>
      </div>

      <div className="divide-y divide-gold/10 overflow-hidden rounded-xl border border-gold/15 bg-surface/60">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold">{t('My deck pool')}</p>
            <p className="text-sm text-parchment/60">{t('Precons you own and imported decks.')}</p>
          </div>
          <Link
            to="/minha-pool"
            className="rounded-lg border border-gold/40 px-4 py-2 text-sm text-gold hover:bg-gold/10"
          >
            Abrir
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold">{t('My history')}</p>
            <p className="text-sm text-parchment/60">{t('Decks you were dealt, who you played against and your wins.')}</p>
          </div>
          <Link
            to="/meus-sorteios"
            className="rounded-lg border border-gold/40 px-4 py-2 text-sm text-gold hover:bg-gold/10"
          >
            Abrir
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('Reset deal history')}</p>
            <p className="text-sm text-parchment/60">
              {resetHistory.isSuccess
                ? resetHistory.data.cleared
                  ? t('Done! "No repeats" now considers every deck again.')
                  : t('Your history was already empty.')
                : t('The "No repeats" filter forgets what you’ve already played. Past deals stay saved.')}
            </p>
            {resetHistory.isError && <p className="text-sm text-red-400">{resetHistory.error.message}</p>}
          </div>
          {confirmReset ? (
            <div className="flex gap-2">
              <button
                onClick={() => resetHistory.mutate()}
                disabled={resetHistory.isPending}
                className="rounded-lg border border-red-400/50 px-4 py-2 text-sm text-red-300 hover:border-red-400 disabled:opacity-50"
              >
                {resetHistory.isPending ? t('Resetting…') : t('Confirm')}
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="rounded-lg border border-parchment/20 px-4 py-2 text-sm text-parchment/70"
              >
                {t('Cancel')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                resetHistory.reset()
                setConfirmReset(true)
              }}
              className="rounded-lg border border-gold/40 px-4 py-2 text-sm text-gold hover:bg-gold/10"
            >
              {t('Reset')}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold">{t('Download my data')}</p>
            <p className="text-sm text-parchment/60">{t('Everything we store about you, in a JSON file.')}</p>
          </div>
          <button
            onClick={() => exportData.mutate()}
            disabled={exportData.isPending}
            className="rounded-lg border border-gold/40 px-4 py-2 text-sm text-gold hover:bg-gold/10 disabled:opacity-50"
          >
            {exportData.isPending ? t('Preparing…') : t('Download')}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold">{t('Sign out')}</p>
            <p className="text-sm text-parchment/60">{t('Ends the session in this browser.')}</p>
          </div>
          <button
            onClick={() => logout().then(() => navigate('/'))}
            className="rounded-lg border border-parchment/20 px-4 py-2 text-sm text-parchment/80 hover:border-parchment/40"
          >
            {t('Sign out')}
          </button>
        </div>
      </div>
      {exportData.isError && <p className="text-sm text-red-400">{exportData.error.message}</p>}

      <div className="space-y-3 rounded-xl border border-red-400/25 bg-red-400/5 p-4">
        <p className="font-semibold text-red-300">{t('Delete account')}</p>
        <p className="text-sm text-parchment/70">
          {t(
            'Permanently erases your email, password, imported decks and marked precons. In past deals, your name becomes "(deleted account)". This can’t be undone.',
          )}
        </p>
        {confirming ? (
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              remove.mutate()
            }}
          >
            <label className="block space-y-1 text-sm">
              <span className="text-parchment/70">{t('Enter your password to confirm')}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                autoFocus
                className="w-full rounded-lg border border-red-400/30 bg-ink px-4 py-2.5 focus:border-red-400 focus:outline-none"
              />
            </label>
            {remove.isError && <p className="text-sm text-red-400">{remove.error.message}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={remove.isPending || !password}
                className="rounded-lg bg-red-500/80 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {remove.isPending ? t('Deleting…') : t('Delete my account')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false)
                  setPassword('')
                }}
                className="rounded-lg border border-parchment/20 px-4 py-2 text-sm text-parchment/70"
              >
                {t('Cancel')}
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-red-400/40 px-4 py-2 text-sm text-red-300 hover:border-red-400/70"
          >
            {t('I want to delete my account')}
          </button>
        )}
      </div>

      <p className="text-center text-xs text-parchment/40">
        <Link to="/privacidade" className="underline hover:text-gold">
          {t('Privacy policy')}
        </Link>
      </p>
    </section>
  )
}
