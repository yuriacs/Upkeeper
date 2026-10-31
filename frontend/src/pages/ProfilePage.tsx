import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import DeckTile from '../components/DeckTile'
import ReportImageButton from '../components/ReportImageButton'
import SupporterBadge, { FounderBadge } from '../components/SupporterBadge'
import { titleLabel } from '../lib/titles'
import { SITE_NAME } from '../lib/site'
import { useTitle } from '../hooks/useTitle'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtPlayed, monthLabel } from '../lib/duration'
import { useI18n } from '../lib/i18n'
import { isUploadedImage } from '../lib/moderation'
import { ACHIEVEMENTS } from '../lib/achievements'
import VersusCard from '../components/VersusCard'
import Trophy from '../components/Trophy'

/**
 * Perfil público de um jogador: partidas e vitórias, comandantes mais jogados, conquistas e os
 * decks que ele montou. Só o que já é público no site (nada do perfil privado).
 */
export default function ProfilePage() {
  const { username = '' } = useParams()
  const { t, locale } = useI18n()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: ['profile', username.toLowerCase()], queryFn: () => api.profile(username) })
  useTitle(profile.data?.username ?? username)
  const friends = useQuery({ queryKey: ['friends'], queryFn: api.friends, enabled: !!user })
  const add = useMutation({
    mutationFn: () => api.addFriend(username),
    onSuccess: (data) => queryClient.setQueryData(['friends'], data),
  })

  if (profile.isPending) return <p className="text-center text-parchment/60">{t('Loading…')}</p>
  if (profile.isError)
    return (
      <p className="text-center text-parchment/60">
        {profile.error instanceof ApiError && profile.error.status === 404 ? t('No player with that username.') : profile.error.message}
      </p>
    )
  const p = profile.data
  const mine = user?.username.toLowerCase() === p.username.toLowerCase()
  const lower = p.username.toLowerCase()
  const relation = friends.data
    ? friends.data.friends.some((f) => f.username.toLowerCase() === lower)
      ? 'friend'
      : friends.data.outgoing.some((f) => f.username.toLowerCase() === lower)
        ? 'sent'
        : friends.data.incoming.some((f) => f.username.toLowerCase() === lower)
          ? 'incoming'
          : 'none'
    : null
  const joined = new Date(`${p.joined}T12:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const tiles: [string, string | number][] = [
    [t('Games'), p.stats.games],
    [t('Wins'), p.stats.wins],
    [t('Win rate'), p.stats.games ? `${Math.round(p.stats.win_rate * 100)}%` : '—'],
    [t('Decks built'), p.stats.decks],
    [t('Commanders played'), p.stats.commanders],
    [t('Hours played'), fmtPlayed(p.stats.seconds_played ?? 0)],
  ]
  // Rating estilo Elo (Ranking): só depois de partidas suficientes
  if (p.ratings?.tables != null) tiles.push([t('Rating (tables)'), p.ratings.tables])
  if (p.ratings?.draws != null) tiles.push([t('Rating (deals)'), p.ratings.draws])
  const earned = p.achievements.filter((a) => a.earned).length

  return (
    <section className="space-y-10">
      <header className="flex flex-wrap items-end gap-4">
        {p.avatar && (
          <div className="flex shrink-0 flex-col items-center gap-1.5">
            <span className={`rounded-full ${p.frame ? 'founder-frame' : ''}`}>
              <img src={p.avatar} alt="" className="h-24 w-24 rounded-full object-cover ring-2 ring-gold/60" />
            </span>
            {user && !mine && isUploadedImage(p.avatar) && <ReportImageButton url={p.avatar} className="max-w-40 text-center" />}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.3em] text-gold uppercase">{t('Player')}</p>
          <h1 className={`font-display flex items-center gap-3 truncate text-5xl ${p.supporter ? 'text-gold' : 'text-parchment'}`}>
            <span className="truncate">{p.username}</span>
            {p.supporter && <SupporterBadge className="h-7 w-7" />}
            {p.founder && <FounderBadge className="h-7 w-7" />}
          </h1>
          {p.title && <p className="font-display text-lg text-amber-200/90 italic">{t(titleLabel(p.title))}</p>}
          <p className="text-sm text-parchment/55">
            {t('Member since {date}', { date: joined })}
            {p.supporter && <> · <span className="text-gold/80">{t('Supports {site}', { site: SITE_NAME })}</span></>}
            {p.founder && (
              <>
                {' · '}
                <Link to="/credits" className="text-amber-300/90 hover:underline">
                  {t('{site} founder', { site: SITE_NAME })}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {mine && (
            <Link to="/account" className="rounded-lg border border-parchment/25 px-4 py-2 text-sm text-gold hover:bg-parchment/5">
              {t('My account')}
            </Link>
          )}
          {!mine && user && relation === 'none' && (
            <button
              onClick={() => add.mutate()}
              disabled={add.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink hover:brightness-110 disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" aria-hidden />
              {t('Add friend')}
            </button>
          )}
          {!mine && relation === 'friend' && <span className="rounded-lg border border-emerald-400/40 px-3 py-2 text-sm text-emerald-300">{t('Friends')}</span>}
          {!mine && relation === 'sent' && <span className="rounded-lg border border-line px-3 py-2 text-sm text-parchment/60">{t('Request sent')}</span>}
          {!mine && relation === 'incoming' && (
            <Link to="/friends" className="rounded-lg border border-gold/50 px-3 py-2 text-sm text-gold">
              {t('Wants to be your friend')}
            </Link>
          )}
        </div>
      </header>
      {add.isError && <p className="text-sm text-red-400">{add.error.message}</p>}

      {!!p.seasons?.length && (
        <ul className="flex flex-wrap gap-2">
          {p.seasons.map((m) => (
            <li
              key={m}
              className="flex items-center gap-1.5 rounded-full border border-gold/50 bg-gold/10 px-3 py-1 text-sm text-gold"
            >
              <Trophy className="size-4" />
              {t('Champion of {month}', { month: monthLabel(m, locale) })}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-surface/60 p-4">
            <p className="font-display text-3xl text-parchment tabular-nums">{value}</p>
            <p className="text-xs text-parchment/55">{label}</p>
          </div>
        ))}
      </div>

      {user && !mine && <VersusCard username={p.username} />}

      {p.commanders.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display text-2xl text-parchment">{t('Most played commanders')}</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {p.commanders.map((c) => (
              <li key={c.name} className="overflow-hidden rounded-lg border border-line bg-surface/60">
                <img src={c.image} alt="" loading="lazy" className="aspect-[4/3] w-full bg-ink object-cover" />
                <div className="p-2">
                  <p className="truncate text-sm font-semibold" title={c.name}>
                    {c.name}
                  </p>
                  <p className="text-xs text-parchment/55">
                    {t('Played {n} · Won {w}', { n: c.games, w: c.wins })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-display text-2xl text-parchment">
          {t('Achievements')} <span className="text-base text-parchment/45">{earned}/{p.achievements.length}</span>
        </h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {p.achievements.map((a) => {
            const info = ACHIEVEMENTS[a.key]
            if (!info) return null
            const Icon = info.icon
            return (
              <li
                key={a.key}
                className={`flex items-center gap-3 rounded-lg border p-3 ${
                  a.earned ? 'border-gold/50 bg-gold/10' : 'border-line bg-surface/40 opacity-60'
                }`}
              >
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
                    a.earned ? 'bg-gold text-ink' : 'bg-parchment/10 text-parchment/50'
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`font-semibold ${a.earned ? 'text-parchment' : 'text-parchment/70'}`}>{info.name(t)}</p>
                  <p className="text-xs text-parchment/55">{info.how(t, a.goal)}</p>
                  {a.earned_at && (
                    <p className="mt-0.5 text-[0.7rem] text-gold/80">
                      {t('Earned on {date}', {
                        date: new Date(a.earned_at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
                      })}
                    </p>
                  )}
                  {!a.earned && a.goal > 1 && (
                    <div className="mt-1 h-1 rounded-full bg-parchment/10" title={`${a.progress}/${a.goal}`}>
                      <div className="h-full rounded-full bg-gold/60" style={{ width: `${(a.progress / a.goal) * 100}%` }} />
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-2xl text-parchment">{t('Decks')}</h2>
        {p.decks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-parchment/50">
            {mine ? t('You have not built a deck yet.') : t('No decks yet.')}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {p.decks.map((d, i) => (
              <li key={d.slug}>
                <DeckTile deck={d} index={i} showOwned={false} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
