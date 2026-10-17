import { useState } from 'react'
import { useT } from '../lib/i18n'
import { showRecoveryCode, useRecoveryCode } from '../lib/recoveryCode'

/** Código de recuperação recém-criado: aparece uma vez, por cima de qualquer página. */
export default function RecoveryCodeDialog() {
  const code = useRecoveryCode()
  if (!code) return null
  return <RecoveryCodeBox code={code} onDone={() => showRecoveryCode(null)} overlay />
}

export function RecoveryCodeBox({ code, onDone, overlay }: { code: string; onDone: () => void; overlay?: boolean }) {
  const t = useT()
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  const download = () => {
    const text = `Upkeeper — ${t('Recovery code')}\n\n${code}\n\n${t(
      'With this code you get your private profile back if you forget your password. Nobody else has it: not even the site.',
    )}\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'upkeeper-recovery-code.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const box = (
    <div
      role="dialog"
      aria-modal={overlay}
      aria-labelledby="recovery-title"
      className="w-full max-w-md space-y-4 rounded-xl border border-gold/40 bg-surface p-5 shadow-2xl"
    >
      <div className="space-y-1">
        <h2 id="recovery-title" className="font-display text-2xl text-parchment">
          {t('Save your recovery code')}
        </h2>
        <p className="text-sm text-parchment/70">
          {t(
            'Your private profile (like your email) is encrypted in your browser, and only your password opens it. If you forget your password, this code is the only way to get it back. Nobody else has it: not even the site.',
          )}
        </p>
      </div>
      <p className="select-all rounded-lg border border-line bg-ink px-3 py-3 text-center font-mono text-base tracking-wider text-gold sm:text-lg">
        {code}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => setCopied(true))
          }}
          className="rounded-lg border border-parchment/25 px-4 py-2 text-sm text-gold hover:bg-parchment/5"
        >
          {copied ? t('Copied!') : t('Copy')}
        </button>
        <button
          type="button"
          onClick={download}
          className="rounded-lg border border-parchment/25 px-4 py-2 text-sm text-gold hover:bg-parchment/5"
        >
          {t('Download .txt')}
        </button>
      </div>
      <label className="flex items-start gap-2 text-sm text-parchment/80">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1" />
        {t('I saved it somewhere safe (password manager, a note on paper…)')}
      </label>
      <button
        type="button"
        disabled={!saved}
        onClick={onDone}
        className="w-full rounded-md btn-ember px-6 py-2.5 font-display text-lg tracking-wide text-ink transition hover:brightness-110 disabled:opacity-40"
      >
        {t('Done')}
      </button>
    </div>
  )
  if (!overlay) return box
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">{box}</div>
}
