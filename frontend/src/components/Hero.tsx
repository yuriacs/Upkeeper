import { useState, type ReactNode } from 'react'
import { useArts } from '../hooks/useArts'
import { useT } from '../lib/i18n'

// A arte vem do Scryfall com ~626 px de largura: em vez de esticá-la na tela toda (fica
// borrada), ela ocupa só a direita, perto do tamanho original, e se dissolve no preto.
const FADE =
  'linear-gradient(to right, transparent, #000 35%, #000 82%, transparent), linear-gradient(to bottom, #000 55%, transparent)'
const FADE_STYLE = {
  maskImage: FADE,
  maskComposite: 'intersect',
  WebkitMaskImage: FADE,
  WebkitMaskComposite: 'source-in',
} as const
const FADE_MOBILE = 'linear-gradient(to bottom, #000 45%, transparent)'

/**
 * Topo da página inicial: a arte de um comandante (sorteada a cada visita) e o título.
 * Fica atrás do cabeçalho transparente.
 */
export default function Hero({ children }: { children: ReactNode }) {
  const t = useT()
  const { items } = useArts()
  const [seed] = useState(() => Math.random())
  const pick = items.length ? items[Math.floor(seed * items.length)] : null

  return (
    <section className="relative isolate overflow-hidden">
      {pick && (
        <>
          {/* Celular: arte no topo, em largura quase natural */}
          <img
            src={pick.art}
            alt=""
            className="absolute inset-x-0 top-0 -z-10 h-[22rem] w-full object-cover object-[center_30%] opacity-80 animate-[fade-in_0.8s_ease-out] sm:hidden"
            style={{ maskImage: FADE_MOBILE, WebkitMaskImage: FADE_MOBILE }}
          />
        </>
      )}
      <div className="relative mx-auto flex min-h-[26rem] w-full max-w-6xl flex-col justify-end px-4 pt-28 pb-8 sm:min-h-[30rem] sm:px-6 sm:pb-10">
        {/* Computador: arte à direita do conteúdo, sem esticar além de ~1,2x */}
        {pick && (
          <img
            src={pick.art}
            alt=""
            className="absolute top-0 right-0 -z-10 hidden h-full w-[min(68%,780px)] object-cover object-[center_30%] animate-[fade-in_0.8s_ease-out] sm:block"
            style={FADE_STYLE}
          />
        )}
        <div className="relative">{children}</div>
      </div>
      {pick && (
        <p className="absolute right-4 bottom-3 hidden text-xs text-parchment/45 sm:block sm:right-6">
          {t('Art: {name}', { name: pick.commander })}
        </p>
      )}
    </section>
  )
}
