// Símbolos de mana com a fonte Mana (https://mana.andrewgioia.com/)

import { COLOR_NAMES } from '../lib/colors'
import { useT } from '../lib/i18n'

/** "{2}{W/U}{G/P}" → ["2", "wu", "gp"] */
function parseSymbols(cost: string): string[] {
  return [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].toLowerCase().replace('/', ''))
}

function Symbol({ code, title }: { code: string; title?: string }) {
  const cls = code === 't' ? 'tap' : code === 'q' ? 'untap' : code === '∞' ? 'infinity' : code
  return <i className={`ms ms-${cls} ms-cost ms-shadow`} title={title ?? `{${code.toUpperCase()}}`} aria-hidden />
}

export function ManaCost({ cost, className = '' }: { cost: string; className?: string }) {
  if (!cost) return null
  // Cartas de duas faces: "{1}{G} // {3}{G}{G}" — mostramos só a frente
  const front = cost.split('//')[0]
  const symbols = parseSymbols(front)
  return (
    <span className={`inline-flex items-center gap-0.5 text-[0.85em] ${className}`} aria-label={front}>
      {symbols.map((s, i) => (
        <Symbol key={i} code={s} />
      ))}
    </span>
  )
}

export function ColorIdentity({ colors, className = '' }: { colors: string; className?: string }) {
  const t = useT()
  const list = colors ? colors.split('') : ['C']
  const label = list.map((c) => (COLOR_NAMES[c] ? t(COLOR_NAMES[c]) : c)).join(', ')
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} title={label} aria-label={label}>
      {list.map((c) => (
        <i key={c} className={`ms ms-${c.toLowerCase()} ms-cost ms-shadow`} aria-hidden />
      ))}
    </span>
  )
}

/**
 * Texto de regras com os símbolos desenhados ("{T}: Add {B}." → ícones) e o lembrete entre
 * parênteses em itálico, uma linha por parágrafo (texto Oracle do Scryfall)
 */
export function ManaText({ text, className = '' }: { text: string; className?: string }) {
  if (!text) return null
  const symbols = (part: string, key: string) =>
    part.split(/(\{[^}]+\})/).map((bit, i) =>
      /^\{[^}]+\}$/.test(bit) ? <Symbol key={`${key}-${i}`} code={bit.slice(1, -1).toLowerCase().replace('/', '')} /> : bit,
    )
  return (
    <div className={`space-y-1 ${className}`}>
      {text.split('\n').map((line, n) => (
        <p key={n}>
          {line.split(/(\([^)]*\))/).map((part, i) =>
            part.startsWith('(') ? (
              <i key={i} className="opacity-70">
                {symbols(part, `${n}-${i}`)}
              </i>
            ) : (
              symbols(part, `${n}-${i}`)
            ),
          )}
        </p>
      ))}
    </div>
  )
}
