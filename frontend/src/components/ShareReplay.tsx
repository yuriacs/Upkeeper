import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Check, Copy, Link2, Link2Off } from 'lucide-react'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import type { Replay } from '../lib/replay'

/**
 * Link público da partida (Rever): qualquer jogador liga, e quem tem o link vê o rever sem conta.
 * Aparece o nome de quem ligou e o de quem autorizou aparecer nos posts do Upkeeper; os outros
 * jogadores ficam como "Jogador N". Qualquer jogador desliga, e o link para de abrir.
 */
export default function ShareReplay({ id, share }: { id: number; share: string | null }) {
  const t = useT()
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const toggle = useMutation({
    mutationFn: (on: boolean) => api.shareReplay(id, on),
    onSuccess: ({ share: key }) =>
      queryClient.setQueryData<Replay>(['replay', String(id)], (old) => (old ? { ...old, share: key } : old)),
  })
  const url = share ? `${window.location.origin}/replay/shared/${share}` : ''
  const copy = async () => {
    await navigator.clipboard?.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  if (!share)
    return (
      <button
        type="button"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate(true)}
        title={t(
          'Anyone with the link can watch this replay, no account needed. Your name shows; other players show only if they allowed their name in Upkeeper posts.',
        )}
        className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-parchment/80 hover:border-gold/60 hover:text-gold disabled:opacity-60"
      >
        <Link2 className="h-3.5 w-3.5" aria-hidden />
        {t('Share link')}
      </button>
    )
  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={t('Public link')}
          className="min-w-0 flex-1 rounded-md border border-line bg-ink px-2 py-1 text-xs text-parchment/80"
        />
        <button
          type="button"
          onClick={copy}
          aria-label={t('Copy link')}
          title={t('Copy link')}
          className="rounded-md border border-line px-2 hover:border-gold/60 hover:text-gold"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        </button>
        <button
          type="button"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(false)}
          aria-label={t('Turn off link')}
          title={t('Turn off link')}
          className="rounded-md border border-line px-2 hover:border-red-400/60 hover:text-red-400 disabled:opacity-60"
        >
          <Link2Off className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <p className="text-[0.68rem] leading-snug text-parchment/45">
        {t(
          'Anyone with the link can watch this replay, no account needed. Your name shows; other players show only if they allowed their name in Upkeeper posts.',
        )}
      </p>
    </div>
  )
}
