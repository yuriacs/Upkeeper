import { Component, type ReactNode } from 'react'
import { translate, getLang } from '../lib/i18n'

/**
 * Se uma página quebrar, mostra um aviso com "recarregar" em vez de deixar a tela em branco.
 * Volta sozinho ao trocar de página (`resetKey` = endereço atual).
 */
export default class PageErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { error: Error | null; key: string }
> {
  state = { error: null as Error | null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { error: Error | null; key: string }) {
    // Trocou de página: tenta de novo
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error) {
    console.error('[página] erro ao mostrar a página:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    const t = (s: string) => translate(getLang(), s)
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-lg text-parchment/80">{t('Something went wrong showing this page.')}</p>
        <p className="mt-2 text-xs break-words text-parchment/40">{String(this.state.error.message).slice(0, 200)}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 rounded-md bg-gold px-5 py-2 font-semibold text-ink transition hover:brightness-110"
        >
          {t('Reload the page')}
        </button>
      </div>
    )
  }
}
