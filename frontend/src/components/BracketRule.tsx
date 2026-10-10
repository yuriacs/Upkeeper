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
  return (
    <RuleRow
      stacked={stacked}
      label="Bracket"
      hint="Mesa equilibrada: no máximo 1 bracket e 1,5 ponto de nível de poder de diferença entre os decks. Estimativas pelas cartas; decks ainda sem análise entram em qualquer opção."
    >
      <div className="space-y-2">
        <Segmented
          label="Bracket máximo"
          disabled={disabled}
          value={maxBracket}
          onChange={(v) => onChange({ maxBracket: v })}
          options={[
            { value: 0, label: 'Qualquer' },
            { value: 2, label: 'Até 2' },
            { value: 3, label: 'Até 3' },
          ]}
        />
        <Switch
          label="Mesa equilibrada (decks de força parecida)"
          disabled={disabled}
          checked={balance}
          onChange={(v) => onChange({ balance: v })}
        />
      </div>
    </RuleRow>
  )
}
