import { useTitle } from '../hooks/useTitle'
import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'

export default function NotFoundPage() {
  const t = useT()
  useTitle(t('Page not found'))
  return (
    <div className="space-y-4 py-16 text-center">
      <h1 className="font-display text-3xl text-parchment">{t('Page not found')}</h1>
      <Link to="/" className="text-parchment/70 hover:text-gold">
        {t('Back to the dealer')}
      </Link>
    </div>
  )
}
