import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AvatarCard from '../components/AvatarCard'
import SupporterCard from '../components/SupporterCard'
import PrivateProfileCard, { vaultErrorText } from '../components/PrivateProfileCard'
import { SocialButtons } from '../components/SocialButtons'
import { useTitle } from '../hooks/useTitle'
import { passwordProof } from '../lib/account'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n, useT } from '../lib/i18n'
import { PROVIDER_NAMES } from '../lib/oauth'
import type { SocialProvider } from '../lib/types'
import { useVault } from '../lib/useVault'

const USERNAME_RE = /^[\w.-]{3,30}$/

/** Trocar o nome de usuário (o nick que todos veem e que serve para entrar) */
function UsernameCard() {
  const t = useT()
  const { locale } = useI18n()
  const { user, updateUser } = useAuth()
  const [name, setName] = useState(user?.username ?? '')
  const [saved, setSaved] = useState(false)
  const save = useMutation({
    mutationFn: () => api.setUsername(name.trim()),
    onSuccess: (u) => {
      updateUser(u)
      setName(u.username)
      setSaved(true)
    },
  })
  if (!user) return null
  const next = user.username_next_change ? new Date(user.username_next_change) : null
  const caseOnly = name.trim().toLowerCase() === user.username.toLowerCase()
  const locked = !!next && !caseOnly
  const valid = USERNAME_RE.test(name.trim())
  const changed = name.trim() !== user.username
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (valid && changed && !locked) save.mutate()
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-line bg-surface/60 p-4">
      <div>
        <label htmlFor="username" className="font-semibold">
          {t('Username')}
        </label>
        <p className="text-sm text-parchment/60">
          {t('The name everyone sees at the tables and in rankings. You also sign in with it.')}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          id="username"
          value={name}
          onChange={(e) => {
            setName(e.target.value.slice(0, 30))
            setSaved(false)
            save.reset()
          }}
          autoComplete="username"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-2 focus:border-gold focus:outline-none"
        />
        <button
          disabled={!valid || !changed || locked || save.isPending}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
        >
          {save.isPending ? t('Saving…') : t('Save')}
        </button>
      </div>
      {!valid && name.trim() && (
        <p className="text-sm text-amber-300">{t('Use 3 to 30 letters, numbers, dots, hyphens or underscores.')}</p>
      )}
      {save.isError && <p className="text-sm text-red-400">{save.error.message}</p>}
      {saved && <p className="text-sm text-emerald-300">{t('Username changed. Use the new one to sign in.')}</p>}
      <p className="text-xs text-parchment/45">
        {next
          ? t('You can change it again on {date} (only capitalization changes are allowed before that).', {
              date: next.toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
            })
          : t('You can change it once a week. Past games keep the name you had when they were played.')}
      </p>
    </form>
  )
}

/** Autorizar o nome de usuário nos posts do Upkeeper nas redes (desligado por padrão) */
function SocialOptInCard() {
  const t = useT()
  const { user, updateUser } = useAuth()
  const save = useMutation({ mutationFn: (on: boolean) => api.setSocialOptIn(on), onSuccess: updateUser })
  if (!user) return null
  const on = save.isPending ? !!save.variables : !!user.social_opt_in
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface/60 p-4">
      <input
        type="checkbox"
        checked={on}
        disabled={save.isPending}
        onChange={(e) => save.mutate(e.target.checked)}
        className="mt-1 h-4 w-4 accent-[#ecb93f]"
      />
      <span>
        <span className="block font-semibold">{t('Show my name in Upkeeper’s social media posts')}</span>
        <span className="block text-sm text-parchment/60">
          {t('Weekly rankings and highlights on Instagram and X can mention your username. Off by default; you can turn it off at any time.')}
        </span>
        {save.isError && <span className="block text-sm text-red-400">{save.error.message}</span>}
      </span>
    </label>
  )
}

export default function AccountPage() {
  const t = useT()
  useTitle(t('My account'))
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [password, setPassword] = useState('')
  // Volta de "Conectar Google/Discord" (/account?connected=google)
  const [params] = useSearchParams()
  const connected = params.get('connected') as SocialProvider | null
  const providers = useQuery({ queryKey: ['oauth-providers'], queryFn: api.oauthProviders, staleTime: 3_600_000 })

  const vault = useVault()
  const exportData = useMutation({
    // Com o cofre aberto, o arquivo leva também o perfil privado legível (montado aqui no navegador)
    mutationFn: () => api.exportAccount(`upkeeper-${user?.username}.json`, vault.data ?? undefined),
  })
  const [confirmReset, setConfirmReset] = useState(false)
  const resetHistory = useMutation({
    mutationFn: api.resetMyHistory,
    onSuccess: () => setConfirmReset(false),
  })
  const remove = useMutation({
    // Conta sem senha (criada pelo Google/Discord) confirma digitando o nome de usuário
    mutationFn: async () =>
      api.deleteAccount(user!.has_password === false ? { confirm: password } : await passwordProof(user!, password)),
    onSuccess: async () => {
      await logout().catch(() => undefined)
      navigate('/', { replace: true })
    },
  })

  if (!user) return null

  return (
    <section className="mx-auto max-w-xl space-y-8">
      <div className="space-y-1">
        <h1 className="font-display text-3xl text-parchment">{t('My account')}</h1>
        <p className="text-parchment/70">
          <strong className="text-parchment">{user.username}</strong>
          {vault.data?.email && <> · {vault.data.email}</>}
        </p>
      </div>

      <AvatarCard />

      <SupporterCard />

      <UsernameCard />

      <SocialOptInCard />

      <PrivateProfileCard vault={vault} />

      {!!providers.data?.providers.length && (
        <div className="space-y-3 rounded-lg border border-line bg-surface/60 p-4">
          <div>
            <p className="font-semibold">{t('Sign-in options')}</p>
            <p className="text-sm text-parchment/60">
              {t('Connect Google or Discord to sign in with one click.')}
              {user.has_password === false &&
                ' ' + t('Your account has no password: sign in with the connected service.')}
            </p>
            {connected && connected in PROVIDER_NAMES && (
              <p className="mt-1 text-sm text-emerald-300">
                {t('{name} connected', { name: PROVIDER_NAMES[connected] })}
              </p>
            )}
          </div>
          <SocialButtons mode="connect" linked={user.social ?? []} />
        </div>
      )}

      <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface/60">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold">{t('My deck pool')}</p>
            <p className="text-sm text-parchment/60">{t('Precons you own and imported decks.')}</p>
          </div>
          <Link
            to="/my-pool"
            className="rounded-lg border border-parchment/25 px-4 py-2 text-sm text-gold hover:bg-parchment/5"
          >
            Abrir
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold">{t('My history')}</p>
            <p className="text-sm text-parchment/60">
              {t('Decks you were dealt, who you played against and your wins.')}
            </p>
          </div>
          <Link
            to="/history"
            className="rounded-lg border border-parchment/25 px-4 py-2 text-sm text-gold hover:bg-parchment/5"
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
              className="rounded-lg border border-parchment/25 px-4 py-2 text-sm text-gold hover:bg-parchment/5"
            >
              {t('Reset')}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold">{t('Download my data')}</p>
            <p className="text-sm text-parchment/60">
              {t('Everything we store about you, in a JSON file.')}
              {vault.status === 'locked' && ' ' + t('Unlock your private profile to include it readable.')}
            </p>
          </div>
          <button
            onClick={() => exportData.mutate()}
            disabled={exportData.isPending}
            className="rounded-lg border border-parchment/25 px-4 py-2 text-sm text-gold hover:bg-parchment/5 disabled:opacity-50"
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

      <div className="space-y-3 rounded-lg border border-red-400/25 bg-red-400/5 p-4">
        <p className="font-semibold text-red-300">{t('Delete account')}</p>
        <p className="text-sm text-parchment/70">
          {t(
            'Permanently erases your private profile, password, imported decks and marked precons. In past deals, your name becomes "(deleted account)". This can’t be undone.',
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
              <span className="text-parchment/70">
                {user.has_password === false
                  ? t('Type your username ({name}) to confirm', { name: user.username })
                  : t('Enter your password to confirm')}
              </span>
              <input
                type={user.has_password === false ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={user.has_password === false ? 'off' : 'current-password'}
                required
                autoFocus
                className="w-full rounded-lg border border-red-400/30 bg-ink px-4 py-2.5 focus:border-red-400 focus:outline-none"
              />
            </label>
            {remove.isError && <p className="text-sm text-red-400">{vaultErrorText(t, remove.error)}</p>}
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
        <Link to="/privacy" className="underline hover:text-gold">
          {t('Privacy policy')}
        </Link>
      </p>
    </section>
  )
}
