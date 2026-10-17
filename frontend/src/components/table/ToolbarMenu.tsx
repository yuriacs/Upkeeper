import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronUp, type LucideIcon } from 'lucide-react'

export type MenuRow = {
  icon?: LucideIcon
  /** Texto curto no lugar do ícone ("d20") */
  text?: string
  label: string
  hotkey?: string
  onClick: () => void
  disabled?: boolean
  /** Não fecha ao clicar (ex.: rolar o dado de novo) */
  stay?: boolean
  tone?: 'default' | 'danger'
}

/**
 * Botão da barra da mesa que abre um menu por cima (como os do untap.in): um título e as linhas,
 * cada uma com o atalho de teclado à direita. `extra`: conteúdo livre no fim (ex.: um campo).
 */
export function ToolbarMenu({
  icon: Icon,
  label,
  rows,
  extra,
  disabled,
  active,
}: {
  icon: LucideIcon
  label: string
  rows: MenuRow[]
  extra?: (close: () => void) => ReactNode
  disabled?: boolean
  active?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', out)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', out)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const close = () => setOpen(false)
  return (
    <span ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-8 shrink-0 items-center gap-0.5 rounded-md border pr-1 pl-2 transition disabled:opacity-35 ${
          open || active
            ? 'border-gold bg-gold/15 text-gold'
            : 'border-line text-parchment/80 enabled:hover:border-parchment/40 enabled:hover:bg-parchment/10'
        }`}
      >
        <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
        <ChevronUp className={`h-3 w-3 opacity-60 transition ${open ? '' : 'rotate-180'}`} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute bottom-full left-0 z-50 mb-2 w-60 rounded-lg border border-line bg-surface py-1 text-sm shadow-2xl shadow-black/70"
        >
          <p className="border-b border-line px-3 pt-1 pb-1.5 text-xs font-semibold text-parchment/60">{label}</p>
          {rows.map((r) => {
            const RowIcon = r.icon
            return (
              <button
                key={r.label}
                type="button"
                role="menuitem"
                disabled={r.disabled}
                onClick={() => {
                  r.onClick()
                  if (!r.stay) close()
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition enabled:hover:bg-parchment/10 disabled:opacity-35 ${
                  r.tone === 'danger' ? 'enabled:hover:text-red-300' : 'enabled:hover:text-gold'
                }`}
              >
                <span className="grid w-5 shrink-0 place-items-center text-parchment/60">
                  {RowIcon ? <RowIcon className="h-4 w-4" aria-hidden /> : <span className="text-[0.7rem] font-semibold">{r.text}</span>}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                {r.hotkey && (
                  <kbd className="rounded border border-line px-1 text-[0.6rem] leading-4 text-parchment/50">{r.hotkey}</kbd>
                )}
              </button>
            )
          })}
          {extra?.(close)}
        </div>
      )}
    </span>
  )
}
