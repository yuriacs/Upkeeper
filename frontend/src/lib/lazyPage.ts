import { createElement, lazy, Suspense, type ComponentType } from 'react'

const RELOADED = 'choose-at-random:chunk-reload'

/**
 * Página carregada só quando alguém abre. Se o arquivo dela sumiu (publicamos uma versão
 * nova com o site aberto), recarrega uma vez para pegar a versão atual em vez de travar.
 */
export function lazyPage<T extends ComponentType>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load()
      .then((mod) => {
        try {
          sessionStorage.removeItem(RELOADED)
        } catch {
          /* armazenamento bloqueado */
        }
        return mod
      })
      .catch((err) => {
        let already = true
        try {
          already = sessionStorage.getItem(RELOADED) === '1'
          if (!already) sessionStorage.setItem(RELOADED, '1')
        } catch {
          /* sem sessionStorage: não arrisca ficar recarregando */
        }
        if (!already) {
          window.location.reload()
          return new Promise<{ default: T }>(() => {})
        }
        throw err
      }),
  )
}

/**
 * Parte de uma página (uma janela, por exemplo) baixada só quando aparece pela primeira vez, com
 * o mesmo cuidado de lazyPage. Enquanto baixa, não mostra nada.
 */
export function lazyPart<P extends object>(load: () => Promise<ComponentType<P>>) {
  const Lazy = lazyPage(() => load().then((component) => ({ default: component as unknown as ComponentType })))
  return function LazyPart(props: P) {
    return createElement(Suspense, { fallback: null }, createElement(Lazy as unknown as ComponentType<P>, props))
  }
}
