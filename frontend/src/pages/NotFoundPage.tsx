import { useTitle } from '../hooks/useTitle'
import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  useTitle('Página não encontrada')
  return (
    <div className="space-y-4 py-16 text-center">
      <h1 className="font-display text-3xl text-gold">Página não encontrada</h1>
      <Link to="/" className="text-parchment/70 hover:text-gold">
        Voltar ao sorteador
      </Link>
    </div>
  )
}
