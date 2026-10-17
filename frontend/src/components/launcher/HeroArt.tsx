import { useState } from 'react'
import { useT } from '@/lib/i18n'
import { HOME_ART } from '@/lib/homeArt'

// Mesmo recorte da capa do Sorteio: a arte fica à direita e se dissolve no preto
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
 * Fundo da capa da página Jogar, no mesmo estilo do Sorteio: a arte de um comandante (sorteada
 * a cada visita) à direita, sumindo no preto, com o crédito no canto. No celular fica no topo.
 */
export default function HeroArt() {
  const t = useT()
  const [pick] = useState(() => HOME_ART[Math.floor(Math.random() * HOME_ART.length)])
  if (!pick) return null
  return (
    <>
      <img
        src={pick.art}
        alt=""
        aria-hidden
        fetchPriority="high"
        className="absolute inset-x-0 top-0 -z-10 h-[24rem] w-full object-cover object-[center_30%] opacity-70 animate-[fade-in_0.8s_ease-out] lg:hidden"
        style={{ maskImage: FADE_MOBILE, WebkitMaskImage: FADE_MOBILE }}
      />
      <img
        src={pick.art}
        alt=""
        aria-hidden
        fetchPriority="high"
        className="absolute top-0 right-0 -z-10 hidden h-[78%] w-[min(62%,980px)] object-cover object-[center_30%] animate-[fade-in_0.8s_ease-out] lg:block"
        style={FADE_STYLE}
      />
      <p className="absolute right-5 bottom-3 hidden text-xs text-parchment/45 sm:right-8 lg:right-16 lg:block">
        {t('Art: {name}', { name: pick.commander })}
      </p>
    </>
  )
}
