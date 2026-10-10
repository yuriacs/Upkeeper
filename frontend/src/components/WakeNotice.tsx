import { useIsFetching, useIsMutating } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n'

const DELAY_MS = 4000

/**
 * O servidor gratuito dorme depois de um tempo parado e leva até ~1 minuto para acordar.
 * Se alguma requisição demorar mais que alguns segundos, avisa em vez de parecer travado.
 */
export default function WakeNotice() {
  const t = useT()
  const busy = useIsFetching() + useIsMutating() > 0
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (!busy) return
    const timer = setTimeout(() => setSlow(true), DELAY_MS)
    return () => {
      clearTimeout(timer)
      setSlow(false)
    }
  }, [busy])

  if (!busy || !slow) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-full border border-gold/30 bg-surface/95 px-5 py-2.5 text-sm text-parchment shadow-lg shadow-black/40 backdrop-blur"
    >
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-gold" aria-hidden />
      {t('Waking up the server, this can take up to a minute')} ☕
    </div>
  )
}
