import { Gem, Medal } from 'lucide-react'
import { useT } from '../lib/i18n'
import { SITE_NAME } from '../lib/site'

/** Selo de apoiador ao lado do nome (perfil, ranking, mesa). Só enfeite. */
export default function SupporterBadge({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  const t = useT()
  return (
    <span title={t('Supports {site}', { site: SITE_NAME })} className="inline-flex shrink-0 align-middle text-gold">
      <Gem className={className} aria-label={t('Supporter')} />
    </span>
  )
}

/** Selo de Fundador: quem apoiou no começo do site (ou somou R$ 100). Não vence. */
export function FounderBadge({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  const t = useT()
  return (
    <span title={t('{site} founder', { site: SITE_NAME })} className="inline-flex shrink-0 align-middle text-amber-300">
      <Medal className={className} aria-label={t('Founder')} />
    </span>
  )
}
