import { Flag } from 'lucide-react'
import { useState } from 'react'
import { useT } from '../lib/i18n'
import { reportImage } from '../lib/moderation'

/** Botão "Denunciar imagem" (foto de perfil ou arte de outro jogador); depois mostra o resultado. */
export default function ReportImageButton({ url, className = '' }: { url: string; className?: string }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  if (result) return <p className={`text-xs text-parchment/60 ${className}`}>{result}</p>
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        setResult(await reportImage(url, t))
        setBusy(false)
      }}
      className={`inline-flex items-center gap-1.5 text-xs text-parchment/50 hover:text-red-300 disabled:opacity-50 ${className}`}
    >
      <Flag className="h-3.5 w-3.5" aria-hidden />
      {t('Report image')}
    </button>
  )
}
