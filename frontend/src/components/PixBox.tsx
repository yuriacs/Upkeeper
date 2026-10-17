import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n'
import { PIX_CITY, PIX_KEY, PIX_NAME, pixPayload } from '../lib/pix'

const AMOUNTS = [5, 10, 20, 50]

/** Doação por Pix: valores sugeridos, QR Code para escanear e o código "copia e cola". */
export function PixBox() {
  const t = useT()
  const [amount, setAmount] = useState<number | null>(10)
  const [svg, setSvg] = useState('')
  const [copied, setCopied] = useState(false)
  const payload = pixPayload({ key: PIX_KEY, name: PIX_NAME, city: PIX_CITY }, amount)

  useEffect(() => {
    let alive = true
    QRCode.toString(payload, {
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
  }, [payload])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      /* sem permissão: o código continua visível para copiar à mão */
    }
  }

  const chip = (on: boolean) =>
    `rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
      on ? 'border-gold bg-gold text-ink' : 'border-line text-parchment/80 hover:border-gold/60 hover:text-gold'
    }`

  return (
    <div className="space-y-5 rounded-xl border border-gold/30 bg-surface/60 p-5 text-left sm:p-6">
      <div className="space-y-1 text-center">
        <p className="font-display text-2xl text-parchment">{t('Donate with Pix')}</p>
        <p className="text-sm text-parchment/60">
          {t('Choose an amount, or pick "Other" and type it in your bank app.')}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label={t('Amount')}>
        {AMOUNTS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={amount === value}
            onClick={() => setAmount(value)}
            className={chip(amount === value)}
          >
            R$ {value}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={amount === null}
          onClick={() => setAmount(null)}
          className={chip(amount === null)}
        >
          {t('Other')}
        </button>
      </div>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        {svg && (
          <div
            className="size-44 shrink-0 overflow-hidden rounded-lg border-4 border-white [&>svg]:size-full"
            role="img"
            aria-label={t('Pix QR code')}
            // SVG gerado localmente pela biblioteca a partir do código Pix
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
        <div className="w-full min-w-0 space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-parchment/75">
            <li>{t('Open your bank app and go to Pix.')}</li>
            <li>{t('Scan the QR code, or use "Pix copia e cola" with the code below.')}</li>
            <li>{t('Check the name shown by the bank and confirm.')}</li>
          </ol>
          <button
            type="button"
            onClick={copy}
            className="w-full rounded-lg btn-ember px-4 py-3 font-display text-lg font-bold text-ink transition hover:brightness-110"
          >
            {copied ? t('Code copied!') : t('Copy Pix code')}
          </button>
          <p className="max-h-16 overflow-y-auto rounded-md bg-ink px-3 py-2 font-mono text-[0.65rem] break-all text-parchment/50 select-all">
            {payload}
          </p>
          <p className="text-xs text-parchment/45">
            {t('Pix key')}: <span className="text-parchment/70 select-all">{PIX_KEY}</span>
          </p>
        </div>
      </div>
    </div>
  )
}
