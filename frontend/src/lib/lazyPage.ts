import { lazy, type ComponentType } from 'react'

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
