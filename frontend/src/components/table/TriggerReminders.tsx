/*
 * Lembretes de gatilho (backend: tables/card_actions.py, triggers). A mesa não tem fases: quando o
 * turno começa aparecem os de manutenção (e, no turno dos outros, também os de combate e da etapa
 * final que vão acontecer); no seu turno, o botão Combate mostra os de combate e Passar a vez
 * mostra os da etapa final antes de passar. Só lembra: o jogador faz o que a carta pede.
 */
import type { ReactNode } from 'react'
import { useT } from '../../lib/i18n'
import { smallImage } from '../../lib/cardImage'
import type { FieldCard, TablePlayer } from '../../hooks/useTableSocket'

export type TriggerWhen = 'upkeep' | 'combat' | 'end'
export type Trigger = { w: TriggerWhen; who: 'you' | 'each' | 'opp'; text: string }
export type Reminder = { card: FieldCard; when: TriggerWhen; text: string }

/**
 * Gatilhos das cartas que você controla no campo para esse momento do turno: os "your" só no seu
 * turno, os "each opponent's" só no turno dos outros. Comandante parado na zona dele não conta.
 */
export function dueTriggers(players: TablePlayer[], you: number, myTurn: boolean, when: TriggerWhen[]): Reminder[] {
  const out: Reminder[] = []
  for (const p of players)
    for (const card of p.battlefield) {
      if (!card.trig || card.face_down || card.slot != null || (card.controller ?? card.owner) !== you) continue
      for (const g of card.trig)
        if (when.includes(g.w) && (g.who === 'each' || (g.who === 'you') === myTurn))
          out.push({ card, when: g.w, text: g.text })
    }
  return out.sort((a, b) => when.indexOf(a.when) - when.indexOf(b.when))
}

/** Painel com os lembretes, separados por momento do turno; `footer` traz os botões (Passar a vez...) */
export function TriggerPanel({
  title,
  items,
  onHover,
  onClose,
  footer,
}: {
  title: string
  items: Reminder[]
  onHover: (card: FieldCard | null) => void
  onClose: () => void
  footer?: ReactNode
}) {
  const t = useT()
  const heading: Record<TriggerWhen, string> = {
    upkeep: t('Upkeep'),
    combat: t('Beginning of combat'),
    end: t('End step'),
  }
  const groups = (['upkeep', 'combat', 'end'] as const)
    .map((w) => [w, items.filter((r) => r.when === w)] as const)
    .filter(([, list]) => list.length)
  return (
    <div
      role="dialog"
      aria-label={title}
      className="fixed top-24 right-4 z-40 flex max-h-[70dvh] w-[min(22rem,calc(100vw-2rem))] animate-[flip-in_0.3s_ease-out] flex-col rounded-xl border border-gold/50 bg-ink/95 shadow-2xl shadow-black"
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <p className="font-semibold text-gold">{title}</p>
        <button
          onClick={onClose}
          className="ml-auto rounded-md px-1.5 text-parchment/60 hover:text-gold"
          aria-label={t('Close')}
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 space-y-3 overflow-y-auto p-3">
        {groups.map(([w, list]) => (
          <section key={w}>
            {groups.length > 1 && (
              <p className="mb-1 text-[0.65rem] font-semibold tracking-wide text-parchment/50 uppercase">{heading[w]}</p>
            )}
            <ul className="space-y-1.5">
              {list.map((r, i) => (
                <li
                  key={`${r.card.id}-${i}`}
                  onMouseEnter={() => onHover(r.card)}
                  onMouseLeave={() => onHover(null)}
                  className="flex gap-2 rounded-md p-1 hover:bg-parchment/[0.06]"
                >
                  <img
                    src={smallImage(r.card.image)}
                    alt=""
                    className={`w-10 shrink-0 self-start rounded-[6%] ${r.card.tapped ? 'opacity-60' : ''}`}
                  />
                  <span className="min-w-0 text-xs">
                    <span className="block font-semibold text-parchment">{r.card.name}</span>
                    <span className="block leading-snug text-parchment/65">{r.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line px-3 py-2">
        {footer ?? (
          <button
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1 text-sm hover:border-parchment/40"
          >
            {t('OK')}
          </button>
        )}
      </div>
    </div>
  )
}
