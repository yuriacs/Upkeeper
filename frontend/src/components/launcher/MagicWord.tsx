import { useEffect, useState, type CSSProperties } from 'react'

/** Número "aleatório" estável (mesma troca → mesmas faíscas), para o render continuar puro */
const rand = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

const SPARKS = 14

/**
 * Palavra do título que troca como magia: as letras da atual acendem, desfocam e se desfazem
 * em faíscas douradas, uma a uma; as da próxima se materializam no lugar. Só CSS.
 * Com "menos movimento" ligado no sistema, fica parada na primeira palavra.
 */
export default function MagicWord({ words, interval = 2800 }: { words: string[]; interval?: number }) {
  const [{ index, previous, tick }, setState] = useState<{ index: number; previous: number | null; tick: number }>({
    index: 0,
    previous: null,
    tick: 0,
  })

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => {
      setState(({ index: i, tick: n }) => ({ index: (i + 1) % words.length, previous: i, tick: n + 1 }))
    }, interval)
    return () => window.clearInterval(id)
  }, [words.length, interval])

  const letters = (word: string, kind: 'in' | 'out') =>
    Array.from(word).map((ch, i) => (
      <span
        key={i}
        className={`magic-letter ${kind === 'in' ? (previous === null ? '' : 'magic-in') : 'magic-out'}`}
        style={
          {
            animationDelay: `${kind === 'in' ? 260 + i * 45 : i * 35}ms`,
            '--drift': `${(rand(tick * 31 + i) - 0.5) * 0.5}em`,
          } as CSSProperties
        }
      >
        {ch === ' ' ? ' ' : ch}
      </span>
    ))

  return (
    <span className="relative inline-grid align-baseline">
      {/* Leitores de tela leem só a primeira palavra, sem a troca */}
      <span className="sr-only">{words[0]}</span>
      {previous !== null && (
        <span key={`out-${tick}`} aria-hidden className="col-start-1 row-start-1 whitespace-nowrap">
          {letters(words[previous], 'out')}
        </span>
      )}
      <span key={`in-${tick}`} aria-hidden className="col-start-1 row-start-1 whitespace-nowrap">
        {letters(words[index], 'in')}
      </span>
      {previous !== null && (
        <span key={`sparks-${tick}`} aria-hidden className="pointer-events-none absolute inset-0">
          {Array.from({ length: SPARKS }, (_, i) => (
            <span
              key={i}
              className="magic-spark"
              style={
                {
                  left: `${rand(tick * 7 + i) * 100}%`,
                  top: `${30 + rand(tick * 13 + i) * 50}%`,
                  '--dx': `${(rand(tick * 17 + i) - 0.5) * 60}px`,
                  '--dy': `${-20 - rand(tick * 19 + i) * 50}px`,
                  '--size': `${2 + rand(tick * 23 + i) * 3}px`,
                  animationDelay: `${rand(tick * 29 + i) * 450}ms`,
                } as CSSProperties
              }
            />
          ))}
        </span>
      )}
    </span>
  )
}
