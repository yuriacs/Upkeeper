import { useState, type ReactNode } from 'react'
import { useArts } from '../hooks/useArts'
import { useT } from '../lib/i18n'

/**
 * Topo da página inicial: a arte de um comandante (sorteada a cada visita) ocupando a largura
 * toda, escurecida embaixo para o título ficar legível. Fica atrás do cabeçalho transparente.
 */
export default function Hero({ children }: { children: ReactNode }) {
  const t = useT()
  const { items } = useArts()
  const [seed] = useState(() => Math.random())
  const pick = items.length ? items[Math.floor(seed * items.length)] : null

  return (
    <section className="relative isolate flex min-h-[26rem] flex-col justify-end overflow-hidden pt-24 sm:min-h-[30rem]">
      {pick && (
        <img
          src={pick.art}
          alt=""
          className="absolute inset-0 -z-20 h-full w-full object-cover object-[center_30%] animate-[fade-in_0.8s_ease-out]"
        />
      )}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-ink/70 via-ink/20 via-40% to-ink" />
      <div className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6 sm:pb-10">{children}</div>
      {pick && (
        <p className="absolute right-4 bottom-3 hidden text-xs text-parchment/50 sm:block sm:right-6">
          {t('Art: {name}', { name: pick.commander })}
        </p>
      )}
    </section>
  )
}
