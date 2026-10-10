import { isTransient } from '../lib/api'

/** Mensagem de erro de carregamento com botão para tentar de novo (sem precisar de F5). */
export default function LoadError({
  error,
  onRetry,
  retrying,
}: {
  error: Error
  onRetry: () => void
  retrying?: boolean
}) {
  return (
    <div className="space-y-3 py-8 text-center" role="alert">
      <p className="text-red-400">{error.message}</p>
      {isTransient(error) && (
        <button
          onClick={onRetry}
          disabled={retrying}
          className="rounded-lg border border-gold/40 px-4 py-2 text-sm text-gold hover:bg-gold/10 disabled:opacity-50"
        >
          {retrying ? 'Tentando…' : 'Tentar de novo'}
        </button>
      )}
    </div>
  )
}
