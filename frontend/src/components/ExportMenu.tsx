import { useEffect, useRef, useState } from 'react'
import { downloadText, EXPORT_FORMATS, exportDeck, type ExportFormat } from '../lib/exportDeck'
import type { DeckDetail } from '../lib/types'
import { useT } from '../lib/i18n'

export default function ExportMenu({ deck }: { deck: DeckDetail }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<ExportFormat | null>(null)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Fecha o menu ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!open && !format) return
    const onClick = (e: MouseEvent) => {
      if (open && menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setFormat(null)
      }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, format])

  const text = format ? exportDeck(deck, format) : ''
  const info = EXPORT_FORMATS.find((f) => f.value === format)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* sem permissão de clipboard: o texto continua selecionável na caixa */
    }
  }

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-parchment/80 transition hover:border-parchment/40 hover:text-gold"
        >
          {t('Export')}
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
            <path d="M5 7l5 6 5-6z" />
          </svg>
        </button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 z-40 mt-2 w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-2xl shadow-black"
          >
            {EXPORT_FORMATS.map((f) => (
              <button
                key={f.value}
                role="menuitem"
                onClick={() => {
                  setFormat(f.value)
                  setOpen(false)
                  setCopied(false)
                }}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-parchment/5 hover:text-gold"
              >
                {t(f.label)}
              </button>
            ))}
          </div>
        )}
      </div>

      {format && info && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('Export to {name}', { name: t(info.label) })}
          onClick={() => setFormat(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 rounded-lg border border-line bg-surface p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-xl text-parchment">
                  {t('Export to {name}', { name: t(info.label) })}
                </h3>
                <p className="mt-1 text-xs text-parchment/50">{t(info.hint)}</p>
              </div>
              <button
                onClick={() => setFormat(null)}
                aria-label={t('Close')}
                className="text-xl leading-none text-parchment/50 hover:text-parchment"
              >
                ×
              </button>
            </div>
            <textarea
              readOnly
              value={text}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-64 flex-1 resize-none rounded-lg border border-line bg-ink p-3 font-mono text-xs leading-relaxed text-parchment/90 focus:outline-none"
            />
            <div className="flex flex-wrap gap-2 whitespace-nowrap">
              <button
                onClick={copy}
                className="flex-1 rounded-md bg-gold font-display text-xl tracking-wide px-4 py-2.5 text-ink transition hover:brightness-110"
              >
                {copied ? t('Copied!') : t('Copy')}
              </button>
              <button
                onClick={() => downloadText(`${deck.slug}-${format}.txt`, text)}
                className="flex-1 rounded-lg border border-parchment/25 px-4 py-2.5 text-gold transition hover:bg-parchment/5"
              >
                {t('Download .txt')}
              </button>
              {info.importUrl && (
                <a
                  href={info.importUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 rounded-lg border border-parchment/20 px-4 py-2.5 text-center text-parchment/70 transition hover:border-parchment/40"
                >
                  {t('Open {name}', { name: t(info.label) })} ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
