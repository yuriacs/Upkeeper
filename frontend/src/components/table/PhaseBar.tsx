import { TURN_PHASES, type TurnPhase } from '../../hooks/useTableSocket'
import { useI18n } from '../../lib/i18n'

/** Nome curto e nome inteiro de cada fase (fora do t(): "End" e "Draw" já têm outra tradução no site) */
const NAMES: Record<TurnPhase, { en: [string, string]; pt: [string, string] }> = {
  upkeep: { en: ['Upkeep', 'Upkeep'], pt: ['Manut.', 'Manutenção'] },
  draw: { en: ['Draw', 'Draw step'], pt: ['Compra', 'Etapa de compra'] },
  main1: { en: ['Main 1', 'Main phase 1'], pt: ['Princ. 1', 'Fase principal 1'] },
  combat: { en: ['Combat', 'Combat phase'], pt: ['Combate', 'Fase de combate'] },
  main2: { en: ['Main 2', 'Main phase 2'], pt: ['Princ. 2', 'Fase principal 2'] },
  end: { en: ['End', 'End step'], pt: ['Final', 'Etapa final'] },
}

/*
 * Fases do turno: manutenção, compra, principal 1, combate, principal 2 e final. Todos veem em qual
 * fase o jogador ativo está (vem do servidor, turn.phase); só ele clica para mudar. É só marcação:
 * a mesa não aplica regra nenhuma. Combate e final abrem os lembretes de gatilho (TablePage).
 */
export function PhaseBar({
  phase,
  canChange,
  onPick,
  counts,
}: {
  phase: TurnPhase
  canChange: boolean
  onPick: (phase: TurnPhase) => void
  /** Lembretes de gatilho por fase (só no seu turno): número pequeno no botão */
  counts?: Partial<Record<TurnPhase, number>>
}) {
  const { t, lang } = useI18n()
  const name = (p: TurnPhase) => NAMES[p][lang === 'pt' ? 'pt' : 'en']
  const current = TURN_PHASES.indexOf(phase)
  return (
    <div role="group" aria-label={t('Turn phases')} className="mt-1.5 flex gap-0.5">
      {TURN_PHASES.map((p, i) => {
        const active = p === phase
        const n = counts?.[p] ?? 0
        return (
          <button
            key={p}
            type="button"
            disabled={!canChange || active}
            onClick={() => onPick(p)}
            title={canChange ? name(p)[1] : `${name(p)[1]} · ${t('only the active player changes the phase')}`}
            aria-pressed={active}
            className={`relative min-w-0 rounded px-1 py-0.5 text-[0.65rem] font-semibold transition ${active ? 'flex-[1.6]' : 'flex-1'} ${
              active
                ? 'bg-gold text-ink'
                : i < current
                  ? 'bg-parchment/[0.06] text-parchment/35'
                  : 'bg-parchment/[0.06] text-parchment/70'
            } ${canChange && !active ? 'hover:bg-gold/20 hover:text-gold' : ''} disabled:cursor-default`}
          >
            <span className="block truncate">{name(p)[0]}</span>
            {n > 0 && (
              <span className="absolute -top-1 -right-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-amber-400 px-0.5 text-[0.55rem] text-ink">
                {n}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
