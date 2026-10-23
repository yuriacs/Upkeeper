import { useQuery } from '@tanstack/react-query'
import { UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import LoadError from '../components/LoadError'
import { FounderBadge } from '../components/SupporterBadge'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { SITE_NAME } from '../lib/site'

/** Créditos: os Fundadores, quem apoiou o site no começo (ou somou R$ 100). Selo que não vence. */
export default function CreditsPage() {
  const t = useT()
  useTitle(t('Credits'))
  const list = useQuery({ queryKey: ['supporters-credits'], queryFn: api.supportersCredits, staleTime: 60_000 })
  const founders = list.data?.founders ?? []
  return (
    <section className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-3 text-center">
        <FounderBadge className="mx-auto h-12 w-12" />
        <h1 className="font-display text-3xl text-parchment sm:text-4xl">{t('{site} founders', { site: SITE_NAME })}</h1>
        <p className="mx-auto max-w-xl text-balance text-parchment/75">
          {t('The people who believed in the site from the start and help keep it online. Thank you!')}
        </p>
      </div>
      {list.isError ? (
        <LoadError error={list.error} onRetry={() => list.refetch()} retrying={list.isFetching} />
      ) : list.isPending ? (
        <p className="text-center text-sm text-parchment/50">{t('Loading…')}</p>
      ) : founders.length === 0 ? (
        <p className="text-center text-sm text-parchment/50">{t('No founders yet. Be the first!')}</p>
      ) : (
        <ul className="flex flex-wrap justify-center gap-2">
          {founders.map((f) => (
            <li key={f.username}>
              <Link
                to={`/u/${encodeURIComponent(f.username)}`}
                className="flex items-center gap-2 rounded-full border border-amber-300/40 bg-surface/60 py-1 pr-3 pl-1 text-sm text-amber-200 hover:border-amber-300"
              >
                {f.avatar ? (
                  <img src={f.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-ink">
                    <UserRound className="h-4 w-4 text-parchment/40" aria-hidden />
                  </span>
                )}
                {f.username}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-center text-sm">
        <Link to="/support" className="text-gold underline hover:brightness-110">
          {t('Support {site}', { site: SITE_NAME })}
        </Link>
      </p>
    </section>
  )
}
