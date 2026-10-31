import { useI18n } from '../../lib/i18n'

/** Curva de mana em barras (sem terrenos), de 0 a 7+ */
export function Curve({ values }: { values: number[] }) {
  const { t } = useI18n()
  const max = Math.max(1, ...values)
  return (
    <div className="ml-auto flex h-10 items-end gap-1" role="img" aria-label={t('Mana curve')}>
      {values.map((v, i) => (
        <div key={i} className="flex w-4 flex-col items-center gap-0.5" title={`${i === 7 ? '7+' : i}: ${v}`}>
          <div className="w-full rounded-t bg-gold/70" style={{ height: `${(v / max) * 26}px` }} />
          <span className="text-[0.55rem] leading-none text-parchment/40">{i === 7 ? '7+' : i}</span>
        </div>
      ))}
    </div>
  )
}
