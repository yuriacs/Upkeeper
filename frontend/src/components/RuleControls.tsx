import type { ReactNode } from 'react'

/** Linha de regra: rótulo à esquerda (em cima no celular), controle à direita, dica embaixo. */
export function RuleRow({
  label,
  hint,
  children,
  stacked = false,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  stacked?: boolean
}) {
  return (
    <div className={`grid gap-2 px-4 py-3.5 ${stacked ? '' : 'sm:grid-cols-[7.5rem_1fr] sm:items-start sm:gap-4'}`}>
      <p className={`text-xs font-semibold uppercase tracking-wider text-gold/70 ${stacked ? '' : 'sm:pt-2'}`}>
        {label}
      </p>
      <div className="space-y-1.5">
        {children}
        {hint && <p className="text-xs text-parchment/45">{hint}</p>}
      </div>
    </div>
  )
}

export function RulesCard({ children, title }: { children: ReactNode; title?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gold/15 bg-surface/60">
      {title && <div className="border-b border-gold/10 px-4 py-2.5 text-sm text-parchment/70">{title}</div>}
      <div className="divide-y divide-gold/10">{children}</div>
    </div>
  )
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex w-full rounded-lg border border-gold/20 bg-ink/60 p-0.5 text-sm sm:w-auto"
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            type="button"
            key={String(o.value)}
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-md px-3 py-1.5 text-center leading-tight transition sm:flex-none sm:whitespace-nowrap ${
              active ? 'bg-gold/20 text-gold' : 'text-parchment/65 enabled:hover:text-parchment'
            } disabled:cursor-default ${disabled && !active ? 'opacity-50' : ''}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 py-1 text-left text-sm disabled:cursor-default"
    >
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${
          checked ? 'bg-gold' : 'bg-parchment/15'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink shadow transition-all ${checked ? 'left-[1.125rem]' : 'left-0.5'}`}
        />
      </span>
      <span className={checked ? 'text-parchment' : 'text-parchment/70'}>{label}</span>
    </button>
  )
}
