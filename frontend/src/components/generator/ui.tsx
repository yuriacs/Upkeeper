/* Peças comuns do gerador de decks: título do passo, escolhas em cartão e texto dos avisos */
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { setBuilderHover, useBuilderHover } from '../../lib/builderHover'
import type { Note } from '../../lib/generator'
import { useI18n } from '../../lib/i18n'
import { money } from '../../lib/money'

export function StepHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <header className="space-y-1.5">
      <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">{kicker}</p>
      <h2 className="font-display text-3xl text-parchment sm:text-4xl">{title}</h2>
      {children && <p className="max-w-2xl text-sm text-parchment/60">{children}</p>}
    </header>
  )
}

/** Escolha em cartão (caminhos, brackets, orçamentos) */
export function Choice({
  on,
  onClick,
  children,
  className = '',
  disabled = false,
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`rounded-xl border p-4 text-left transition disabled:opacity-40 ${
        on ? 'border-gold bg-gold/10 shadow-[0_0_24px_rgb(236_185_63/0.15)]' : 'border-line bg-surface/60 hover:border-parchment/30'
      } ${className}`}
    >
      {children}
    </button>
  )
}

/** Aviso do gerador: texto em inglês traduzido; preços ({cost}, {budget}) e números no formato de quem lê */
export function NoteText({ note }: { note: Note }) {
  const { t, locale } = useI18n()
  const vars = Object.fromEntries(
    Object.entries(note.vars ?? {}).map(([k, v]) => [
      k,
      typeof v === 'number' ? ((k === 'cost' || k === 'budget' ? money(v, 'USD', locale, k === 'budget') : null) ?? v.toLocaleString(locale)) : v,
    ]),
  )
  return <>{t(note.text, vars)}</>
}

/** Carta sob o mouse, ampliada no canto (como no deckbuilder), por cima da coluna da esquerda */
export function HoverPreview() {
  const hover = useBuilderHover()
  useEffect(() => () => setBuilderHover(null), [])
  if (!hover?.image) return null
  return (
    <img
      src={hover.image}
      alt=""
      aria-hidden
      className="pointer-events-none fixed top-20 left-4 z-30 hidden w-64 rounded-[4.5%] shadow-2xl shadow-black lg:block"
    />
  )
}
