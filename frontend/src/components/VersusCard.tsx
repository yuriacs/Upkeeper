import { useQuery } from '@tanstack/react-query'
import { Swords } from 'lucide-react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'

/** Confronto direto no perfil de outro jogador: as partidas que vocês dois jogaram juntos */
export default function VersusCard({ username }: { username: string }) {
  const { t, locale } = useI18n()
  const versus = useQuery({ queryKey: ['versus', username.toLowerCase()], queryFn: () => api.versus(username) })
  const v = versus.data
  if (!v || v.games === 0) return null
  const others = v.games - v.my_wins - v.their_wins
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 font-display text-2xl text-parchment">
        <Swords className="h-5 w-5 text-gold" aria-hidden />
        {t('You × {name}', { name: username })}
      </h2>
      <div className="grid grid-cols-3 gap-3 sm:max-w-lg">
        {(
          [
            [t('Your wins'), v.my_wins],
            [t('Wins by {name}', { name: username }), v.their_wins],
            [t('Someone else won'), others],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-surface/60 p-3">
            <p className="font-display text-3xl text-parchment tabular-nums">{value}</p>
            <p className="text-xs text-parchment/55">{label}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-parchment/50">{t('{n} games together', { n: v.games })}</p>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface/60 text-sm">
        {v.recent.map((g, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
            <span className="w-20 shrink-0 text-xs text-parchment/45 tabular-nums">
              {new Date(g.date).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
            </span>
            <span
              className={`w-24 shrink-0 text-xs font-semibold ${
                g.winner === 'me' ? 'text-emerald-300' : g.winner === 'them' ? 'text-red-300' : 'text-parchment/50'
              }`}
            >
              {g.winner === 'me' ? t('You won') : g.winner === 'them' ? t('{name} won', { name: username }) : t('Someone else won')}
            </span>
            <span className="min-w-0 flex-1 truncate text-parchment/70">
              {g.my_deck ?? '—'} <span className="text-parchment/35">×</span> {g.their_deck ?? '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
