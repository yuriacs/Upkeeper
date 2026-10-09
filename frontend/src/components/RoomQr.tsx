import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

/** QR code do link da sala, para quem está na mesma mesa entrar apontando a câmera. */
export default function RoomQr({ url }: { url: string }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    let alive = true
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0d0b10', light: '#ffffff' } })
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
        className="size-48 overflow-hidden rounded-xl border-4 border-gold/40 [&>svg]:size-full"
        role="img"
        aria-label="QR code com o link da sala"
        // SVG gerado localmente pela biblioteca a partir da URL da sala
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="text-center text-xs text-parchment/50">Aponte a câmera do celular para entrar</figcaption>
    </figure>
  )
}
