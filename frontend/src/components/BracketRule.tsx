import { useT } from '../lib/i18n'
import { RuleRow, Segmented, Switch } from './RuleControls'

/** Regra de sorteio por bracket: teto (só até X) e mesa equilibrada (no máximo 1 de diferença). */
export default function BracketRule({
  maxBracket,
  balance,
  onChange,
  disabled,
  stacked,
}: {
  maxBracket: number
  balance: boolean
  onChange: (patch: { maxBracket?: number; balance?: boolean }) => void
  disabled?: boolean
  stacked?: boolean
}) {
  const t = useT()
  return (
    <RuleRow
      stacked={stacked}
      label="Bracket"
      hint={t(
        'Balanced table: at most 1 bracket and 1.5 power level points apart between decks. Estimated from the cards; decks not analyzed yet fit any option.',
      )}
    >
      <div className="space-y-2">
        <Segmented
          label={t('Max bracket')}
          disabled={disabled}
          value={maxBracket}
          onChange={(v) => onChange({ maxBracket: v })}
          options={[
            { value: 0, label: t('Any') },
            { value: 2, label: t('Up to {n}', { n: 2 }) },
            { value: 3, label: t('Up to {n}', { n: 3 }) },
          ]}
        />
        <Switch
          label={t('Balanced table (decks of similar strength)')}
          disabled={disabled}
          checked={balance}
          onChange={(v) => onChange({ balance: v })}
        />
      </div>
    </RuleRow>
  )
}
