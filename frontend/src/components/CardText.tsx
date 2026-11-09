import { ManaCost, ManaText } from './Mana'
import { useOracle, type OracleFace } from '../lib/oracleText'
import { useT } from '../lib/i18n'

/**
 * Nome original e texto oficial (Oracle, com as erratas) da carta, embaixo da carta ampliada:
 * a arte personalizada pode mudar o nome e o texto impressos, este quadro não. Carta de duas faces
 * mostra a face à mostra (`back` = o verso) e o nome da outra; dividir/aventura mostra as duas.
 */
export function CardText({ name, back = false, className = '' }: { name: string; back?: boolean; className?: string }) {
  const t = useT()
  const oracle = useOracle(name)
  const faces = oracle?.faces ?? []
  const shown: OracleFace[] = oracle?.dfc ? [faces[back ? 1 : 0] ?? faces[0]] : faces
  const other = oracle?.dfc ? faces[back ? 0 : 1] : undefined
  return (
    <div className={`space-y-2 rounded-lg bg-ink/95 px-3 py-2 text-[0.8rem] leading-snug text-parchment shadow-xl ring-1 ring-line ${className}`}>
      {shown.length === 0 ? (
        // Ainda carregando (ou carta que o Scryfall não conhece, como uma ficha feita no site): só o nome
        <p className="font-semibold">{name.split(' // ')[back ? 1 : 0] ?? name}</p>
      ) : (
        shown.map((f) => (
          <div key={f.name} className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold">{f.name}</span>
              <ManaCost cost={f.manaCost} className="mt-0.5 shrink-0" />
            </div>
            {f.typeLine && <p className="text-[0.7rem] text-parchment/60">{f.typeLine}</p>}
            <ManaText text={f.text} />
            {f.stats && <p className="text-right font-semibold tabular-nums">{f.stats}</p>}
          </div>
        ))
      )}
      {other && (
        <p className="border-t border-line pt-1 text-[0.7rem] text-parchment/50">
          {back ? t('Front: {name}', { name: other.name }) : t('Back: {name}', { name: other.name })}
        </p>
      )}
    </div>
  )
}
