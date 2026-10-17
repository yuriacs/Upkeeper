import { useEffect } from 'react'

/**
 * Revela ao rolar: todo elemento com a classe `reveal` aparece (sobe e desfoca para nítido)
 * quando entra na tela; `--i` no style escalona os vizinhos. Vale para o site inteiro e
 * acompanha elementos que surgem depois (listas que carregam, troca de página).
 * Sem JavaScript ou com "menos movimento", nada fica escondido.
 */
export function useScrollReveal() {
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return
    const root = document.documentElement
    root.classList.add('reveal-ready')

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-visible')
          io.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    const scan = () => document.querySelectorAll('.reveal:not(.is-visible)').forEach((el) => io.observe(el))
    scan()

    // Novos elementos (listas que chegam da API, outra página): observa no próximo quadro
    let frame = 0
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(scan)
    })
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      io.disconnect()
      mo.disconnect()
      cancelAnimationFrame(frame)
      root.classList.remove('reveal-ready')
    }
  }, [])
}
