import { useState, type FormEvent, type ReactNode } from 'react'
import { ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import type { useVault } from '../lib/useVault'
import { VaultError } from '../lib/vault'

type T = ReturnType<typeof useT>
type Vault = ReturnType<typeof useVault>

const inputClass =
  'w-full rounded-lg border border-line bg-ink px-4 py-2.5 placeholder:text-parchment/30 focus:border-gold focus:outline-none'
const buttonClass =
  'rounded-lg border border-parchment/25 px-4 py-2 text-sm text-gold hover:bg-parchment/5 disabled:opacity-50'

/** Mensagem para erros do cofre (senha errada, código errado, navegador sem suporte). */
// eslint-disable-next-line react-refresh/only-export-components -- usado também pela página de redefinir senha
export function vaultErrorText(t: T, err: unknown): string {
  if (err instanceof VaultError) {
    return {
      wrong_secret: t('Wrong password.'),
      wrong_recovery: t('This recovery code doesn’t match.'),
      unsupported: t('Your browser can’t do the encryption. Update it or use another one.'),
      corrupt: t('Could not read your private profile. Open it again with your password.'),
    }[err.code]
  }
  if (err instanceof ApiError) return err.message
  return t('Something went wrong. Try again.')
}

/** Formulário de uma linha: senha (ou código) + botão. */
function SecretForm({
  label,
  button,
  busyLabel,
  type = 'password',
  autoComplete = 'current-password',
  onSubmit,
  extra,
  minLength,
}: {
  label: string
  button: string
  busyLabel: string
  type?: string
  autoComplete?: string
  onSubmit: (value: string) => Promise<void>
  extra?: ReactNode
  minLength?: number
}) {
  const t = useT()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(value)
      setValue('')
    } catch (err) {
      setError(vaultErrorText(t, err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block space-y-1 text-sm">
        <span className="text-parchment/70">{label}</span>
        <input
          type={type}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          className={inputClass}
        />
      </label>
      {extra}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={busy || !value} className={buttonClass}>
        {busy ? busyLabel : button}
      </button>
    </form>
  )
}

/** Conta só Google/Discord criando o cofre: senha do cofre + confirmação. */
function NewVaultPassword({ onSubmit }: { onSubmit: (secret: string) => Promise<void> }) {
  const t = useT()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (a !== b) return setError(t('The passwords don’t match.'))
    setBusy(true)
    setError(null)
    try {
      await onSubmit(a)
    } catch (err) {
      setError(vaultErrorText(t, err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block space-y-1 text-sm">
        <span className="text-parchment/70">{t('New vault password')}</span>
        <input
          type="password"
          value={a}
          onChange={(e) => setA(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
          className={inputClass}
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-parchment/70">{t('Repeat the vault password')}</span>
        <input
          type="password"
          value={b}
          onChange={(e) => setB(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
          className={inputClass}
        />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={busy} className={buttonClass}>
        {busy ? t('Encrypting…') : t('Create private profile')}
      </button>
    </form>
  )
}

function EmailRow({ vault }: { vault: Vault }) {
  const t = useT()
  const { user } = useAuth()
  const email = vault.data?.email
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await vault.setEmail(value)
      setEditing(false)
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.email?.join(' ') ?? err.message) : vaultErrorText(t, err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-parchment/50">{t('Email')}</p>
          <p className="truncate text-parchment">
            {email ?? (
              <span className="text-parchment/50">
                {user?.has_email ? t('Saved, but not in your private profile yet') : t('No email')}
              </span>
            )}
          </p>
        </div>
        {!editing && (
          <button
            onClick={() => {
              setValue(email ?? '')
              setEditing(true)
            }}
            className={buttonClass}
          >
            {email ? t('Change') : t('Add')}
          </button>
        )}
      </div>
      {editing && (
        <form onSubmit={submit} className="space-y-2">
          <input
            type="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="email"
            required
            autoFocus
            className={inputClass}
          />
          <p className="text-xs text-parchment/50">
            {t('Used to sign in and to reset your password. The site only keeps a fingerprint of it.')}
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={buttonClass}>
              {busy ? t('Saving…') : t('Save')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-parchment/20 px-4 py-2 text-sm text-parchment/70"
            >
              {t('Cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

/**
 * Perfil privado: dados pessoais cifrados no navegador (lib/vault.ts). O servidor e o dono do
 * site só veem texto cifrado.
 */
export default function PrivateProfileCard({ vault }: { vault: Vault }) {
  const t = useT()
  const { logout } = useAuth()
  const [useRecovery, setUseRecovery] = useState(false)
  const [rotating, setRotating] = useState(false)
  const secretLabel = vault.secretKind === 'password' ? t('Your password') : t('Your vault password')

  let body: ReactNode
  switch (vault.status) {
    case 'loading':
      body = <p className="text-sm text-parchment/50">{t('Loading…')}</p>
      break
    case 'error':
      body = (
        <div className="space-y-2">
          <p className="text-sm text-red-400">{t('Could not load your private profile.')}</p>
          <button onClick={() => void vault.refetch()} className={buttonClass}>
            {t('Try again')}
          </button>
        </div>
      )
      break
    case 'relogin':
      body = (
        <div className="space-y-2">
          <p className="text-sm text-parchment/70">
            {t('Sign out and sign in again to turn on your private profile.')}
          </p>
          <button onClick={() => void logout()} className={buttonClass}>
            {t('Sign out')}
          </button>
        </div>
      )
      break
    case 'none':
      body =
        vault.secretKind === 'password' ? (
          <SecretForm
            label={t('Enter your password to create it')}
            button={t('Create private profile')}
            busyLabel={t('Encrypting…')}
            onSubmit={vault.seal}
          />
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-parchment/70">
              {t(
                'Your account signs in with Google/Discord and has no password, so the private profile gets its own password. It never leaves your browser.',
              )}
            </p>
            <NewVaultPassword onSubmit={vault.seal} />
          </div>
        )
      break
    case 'locked':
      body = useRecovery ? (
        <div className="space-y-2">
          <SecretForm
            label={t('Recovery code')}
            button={t('Unlock')}
            busyLabel={t('Unlocking…')}
            type="text"
            autoComplete="off"
            onSubmit={vault.unlockWithRecovery}
          />
          <button onClick={() => setUseRecovery(false)} className="text-xs text-parchment/60 underline">
            {t('Use my password')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-parchment/70">{t('Locked on this device.')}</p>
          <SecretForm label={secretLabel} button={t('Unlock')} busyLabel={t('Unlocking…')} onSubmit={vault.unlock} />
          <button onClick={() => setUseRecovery(true)} className="text-xs text-parchment/60 underline">
            {t('Use my recovery code')}
          </button>
        </div>
      )
      break
    case 'open':
      body = (
        <div className="space-y-4">
          <EmailRow vault={vault} />
          {rotating ? (
            <div className="space-y-2 border-t border-line pt-3">
              <p className="text-sm text-parchment/70">
                {t('The old recovery code stops working.')}
              </p>
              <SecretForm
                label={secretLabel}
                button={t('Create new code')}
                busyLabel={t('Encrypting…')}
                onSubmit={async (secret) => {
                  await vault.seal(secret)
                  setRotating(false)
                }}
              />
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <button onClick={() => setRotating(true)} className={buttonClass}>
                {t('New recovery code')}
              </button>
              <button
                onClick={() => void vault.lock()}
                className="rounded-lg border border-parchment/20 px-4 py-2 text-sm text-parchment/70 hover:border-parchment/40"
              >
                {t('Lock on this device')}
              </button>
            </div>
          )}
        </div>
      )
      break
  }

  return (
    <div className="space-y-3 rounded-lg border border-gold/25 bg-surface/60 p-4">
      <div>
        <p className="font-semibold">🔒 {t('Private profile')}</p>
        <p className="text-sm text-parchment/60">
          {t(
            'Encrypted in your browser. The site stores only scrambled data: nobody here can read it, not even the site owner.',
          )}
        </p>
      </div>
      {body}
    </div>
  )
}
