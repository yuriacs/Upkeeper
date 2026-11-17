/*
 * Peças da mesa do tutorial (/tutorial): carta, pilhas, jogador, reserva de mana e barra de fases.
 * Visual da mesa do site, mas simplificado: aqui só existe o que a aula usa.
 */
import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { Heart, Shield, Swords } from 'lucide-react'
import { cardImage } from '../../lib/cardImage'
import { def, type L, type ManaColor } from '../../lib/tutorial/cards'
import { PHASES, stats, type FieldCard, type Phase, type Side } from '../../lib/tutorial/state'
import { LogoMark } from '../Logo'

export type Lang = 'en' | 'pt'

/** Texto do roteiro: **destaque**, *itálico* e {G} (símbolo de mana) */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\{[^}]+\})/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**')) return <strong key={i} className="font-semibold text-gold">{part.slice(2, -2)}</strong>
        if (part.startsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>
        if (/^\{[^}]+\}$/.test(part)) return <ManaSymbol key={i} code={part.slice(1, -1)} />
        return <Fragment key={i}>{part}</Fragment>
      })}
    </>
  )
}

export function ManaSymbol({ code }: { code: string }) {
  const c = code.toLowerCase()
  return <i className={`ms ms-${c === 't' ? 'tap' : c} ms-cost ms-shadow mx-px text-[0.9em]`} aria-label={`{${code}}`} />
}

/** Largura da carta: a variável --cw, definida na página conforme o tamanho da tela */
const W = 'var(--cw)'
const H = 'calc(var(--cw) * 1.396)'

export function CardImg({ id, lang, className = '' }: { id: string; lang: Lang; className?: string }) {
  const d = def(id)
  return (
    <img
      src={cardImage(d.img[lang], 110)}
      alt={d.name[lang]}
      draggable={false}
      className={`block h-full w-full rounded-[5%] object-cover shadow-md shadow-black/60 select-none ${className}`}
    />
  )
}

/** Brilho do que dá para clicar agora (dourado, pulsando) ou do que a fala comenta */
const glowClass = (glow: 'target' | 'spot' | null) =>
  glow === 'target'
    ? 'tut-target rounded-[6%]'
    : glow === 'spot'
      ? 'rounded-[6%] ring-2 ring-sky-300/80 ring-offset-2 ring-offset-transparent'
      : ''

/** Carta do campo: vira de lado quando está virada; mostra força/resistência e o que está fazendo */
export function FieldCardView({
  card,
  lang,
  glow,
  onClick,
  onHover,
}: {
  card: FieldCard
  lang: Lang
  glow: 'target' | 'spot' | null
  onClick: () => void
  onHover: (id: string | null) => void
}) {
  const d = def(card.id)
  const st = d.kind === 'creature' ? stats(card) : null
  return (
    <div
      className="relative grid shrink-0 place-items-center transition-[width] duration-300 animate-[tut-enter_0.45s_ease-out]"
      style={{ width: card.tapped ? H : W, height: H }}
    >
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => onHover(card.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(card.id)}
        onBlur={() => onHover(null)}
        aria-label={`${d.name[lang]}${card.tapped ? (lang === 'pt' ? ' (virada)' : ' (tapped)') : ''}`}
        className={`relative transition-transform duration-300 ${glowClass(glow)} ${card.attacking ? '-translate-y-2' : ''}`}
        style={{ width: W, height: H, transform: card.tapped ? 'rotate(90deg)' : undefined }}
      >
        <CardImg id={card.id} lang={lang} />
      </button>
      {/* Selos ficam fora da carta girada, para continuarem de pé */}
      <span className="pointer-events-none absolute -top-2 left-1/2 flex -translate-x-1/2 gap-1">
        {card.sick && (
          <span
            title={lang === 'pt' ? 'Enjoo de invocação' : 'Summoning sickness'}
            className="rounded-full border border-sky-300/50 bg-ink/90 px-1.5 text-[0.6rem] font-bold text-sky-200"
          >
            zzz
          </span>
        )}
        {card.attacking && (
          <span className="grid h-5 w-5 place-items-center rounded-full border border-red-400/70 bg-red-950/90 text-red-200">
            <Swords className="h-3 w-3" aria-hidden />
          </span>
        )}
        {card.blocking && (
          <span className="grid h-5 w-5 place-items-center rounded-full border border-sky-400/70 bg-sky-950/90 text-sky-200">
            <Shield className="h-3 w-3" aria-hidden />
          </span>
        )}
      </span>
      {st && (
        <span
          className={`pointer-events-none absolute right-0 -bottom-1.5 rounded-md border px-1.5 text-xs font-bold tabular-nums shadow ${
            card.pump ? 'border-emerald-300/70 bg-emerald-950 text-emerald-200' : 'border-parchment/30 bg-ink/95 text-parchment'
          }`}
        >
          {st.p}/{st.t}
        </span>
      )}
      {card.damage > 0 && (
        <span className="pointer-events-none absolute -bottom-1.5 left-0 rounded-md border border-red-400/70 bg-red-950 px-1.5 text-xs font-bold text-red-200">
          −{card.damage}
        </span>
      )}
    </div>
  )
}

/** Carta na mão: um pouco maior, sobe ao passar o mouse */
export function HandCardView({
  id,
  lang,
  glow,
  onClick,
  onHover,
}: {
  id: string
  lang: Lang
  glow: 'target' | 'spot' | null
  onClick: () => void
  onHover: (id: string | null) => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(id)}
      onBlur={() => onHover(null)}
      aria-label={def(id).name[lang]}
      className={`relative shrink-0 transition-transform duration-200 animate-[tut-draw_0.4s_ease-out] hover:-translate-y-3 focus-visible:-translate-y-3 ${glowClass(glow)} ${
        glow === 'target' ? '-translate-y-2' : ''
      }`}
      style={{ width: 'calc(var(--cw) * 1.15)', height: 'calc(var(--cw) * 1.15 * 1.396)' }}
    >
      <CardImg id={id} lang={lang} />
    </button>
  )
}

/** Verso de carta, com a marca do Upkeeper */
export function CardBackView({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      style={{ width: W, height: H, ...style }}
      className={`grid shrink-0 place-items-center rounded-[6%] border border-gold/30 bg-[radial-gradient(circle_at_50%_40%,#3a2a12,#121014_70%)] shadow-md shadow-black/60 ${className}`}
    >
      <LogoMark className="h-1/3 w-1/3 opacity-70" />
    </div>
  )
}

/** Monte (grimório ou cemitério) com a quantidade embaixo */
export function Pile({
  label,
  count,
  children,
  glow,
  onClick,
}: {
  label: string
  count: number
  children: ReactNode
  glow?: 'target' | 'spot' | null
  onClick?: () => void
}) {
  const inner = (
    <>
      <span className={`relative block ${glowClass(glow ?? null)}`} style={{ width: W, height: H }}>
        {children}
      </span>
      <span className="mt-1 block text-center text-[0.65rem] leading-tight font-semibold tracking-wide text-parchment/60 uppercase">
        {label}
        <span className="ml-1 text-parchment/85 tabular-nums">{count}</span>
      </span>
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="shrink-0 transition hover:brightness-110" aria-label={`${label} (${count})`}>
      {inner}
    </button>
  ) : (
    <div className="shrink-0">{inner}</div>
  )
}

/** Monte vazio: só o contorno */
export function EmptySlot() {
  return <span className="block h-full w-full rounded-[6%] border border-dashed border-parchment/15" />
}

/** Foto, nome e vida do jogador. A vida pisca ao mudar */
export function PlayerBadge({
  name,
  life,
  upkeeper,
  hitKey,
  active,
}: {
  name: string
  life: number
  upkeeper?: boolean
  /** Muda quando o jogador perde vida (reinicia a animação) */
  hitKey?: number
  active: boolean
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition ${
        active ? 'border-gold/60 bg-gold/5 shadow-[0_0_24px_-8px_rgb(236_185_63/0.6)]' : 'border-line bg-ink/60'
      }`}
    >
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border ${
          upkeeper ? 'border-gold/70 bg-[radial-gradient(circle,#3a2a12,#09090b)]' : 'border-parchment/30 bg-surface'
        }`}
      >
        {upkeeper ? (
          <LogoMark className="h-7 w-7" />
        ) : (
          <span className="font-epic text-lg text-parchment">{name.slice(0, 1).toUpperCase()}</span>
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-parchment">{name}</span>
        <span
          key={hitKey}
          className={`flex items-center gap-1 text-xl leading-none font-bold tabular-nums ${
            hitKey ? 'animate-[tut-hit_0.9s_ease-out]' : ''
          } ${life <= 0 ? 'text-red-400' : 'text-parchment'}`}
        >
          <Heart className="h-4 w-4 fill-red-500/80 text-red-400" aria-hidden />
          {life}
        </span>
      </span>
    </div>
  )
}

/** Reserva de mana: um símbolo por mana em aberto */
export function ManaPool({ side, label, glow }: { side: Side; label: string; glow?: boolean }) {
  const list = (['G', 'R', 'B'] as ManaColor[]).flatMap((c) => Array.from({ length: side.mana[c] ?? 0 }, () => c))
  return (
    <div
      className={`flex min-h-9 items-center gap-2 rounded-lg border px-2.5 py-1 transition ${
        glow ? 'border-sky-300/70 bg-sky-400/5' : 'border-line bg-ink/60'
      }`}
    >
      <span className="text-[0.6rem] leading-tight font-semibold tracking-wider text-parchment/55 uppercase">{label}</span>
      <span className="flex min-w-6 items-center gap-0.5 text-lg">
        {list.length ? (
          list.map((c, i) => (
            <span key={`${c}-${i}`} className="animate-[tut-enter_0.3s_ease-out]">
              <ManaSymbol code={c} />
            </span>
          ))
        ) : (
          <span className="text-sm text-parchment/30">—</span>
        )}
      </span>
    </div>
  )
}

const PHASE_NAMES: Record<Phase, L> = {
  setup: { en: 'Opening hand', pt: 'Mão inicial' },
  untap: { en: 'Untap', pt: 'Desvirar' },
  upkeep: { en: 'Upkeep', pt: 'Manutenção' },
  draw: { en: 'Draw', pt: 'Compra' },
  main1: { en: 'Main', pt: 'Principal' },
  combat: { en: 'Combat', pt: 'Combate' },
  main2: { en: 'Main 2', pt: 'Principal 2' },
  end: { en: 'End', pt: 'Final' },
}

/** Barra das fases do turno, com a atual acesa */
export function PhaseBar({ phase, lang, label, glow }: { phase: Phase; lang: Lang; label: string; glow: boolean }) {
  // Desvirar e manutenção passam juntas na aula: as duas acendem na fala que explica as duas
  const now = phase === 'untap' && glow ? ['untap', 'upkeep'] : [phase]
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-[0.65rem] font-semibold tracking-[0.2em] text-parchment/55 uppercase">{label}</span>
      <ol
        className={`flex max-w-full items-center gap-1 overflow-x-auto rounded-full border px-1.5 py-1 transition ${
          glow ? 'border-sky-300/60 shadow-[0_0_20px_-6px_rgb(125_211_252/0.6)]' : 'border-line'
        } bg-ink/70`}
      >
        {PHASES.map((p) => {
          const on = now.includes(p)
          return (
            <li
              key={p}
              aria-current={on ? 'step' : undefined}
              className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold whitespace-nowrap transition sm:px-2.5 sm:text-xs ${
                on ? 'bg-gold text-ink' : 'text-parchment/45'
              }`}
            >
              {PHASE_NAMES[p][lang]}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
