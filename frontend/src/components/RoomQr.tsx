import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n'

/** QR code do link da sala, para quem está na mesma mesa entrar apontando a câmera. */
export default function RoomQr({ url }: { url: string }) {
  const t = useT()
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let alive = true
    QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0d0b10', light: '#ffffff' },
    })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(''))
    return () => {
      alive = false
    }
  }, [url])

  if (!svg) return null
  return (
    <figure className="mx-auto w-fit space-y-2">
      <div
        className="size-48 overflow-hidden rounded-lg border-4 border-parchment/25 [&>svg]:size-full"
        role="img"
        aria-label={t('QR code with the room link')}
        // SVG gerado localmente pela biblioteca a partir da URL da sala
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="text-center text-xs text-parchment/50">
        {t('Point your phone camera here to join')}
      </figcaption>
    </figure>
  )
}
