import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import DeckTile from '../components/DeckTile'
import Roulette from '../components/Roulette'
import WinnerPicker from '../components/WinnerPicker'
import { api } from '../lib/api'
import type { Draw } from '../lib/types'
import { useArts } from '../hooks/useArts'
import { useTitle } from '../hooks/useTitle'
import LoadError from '../components/LoadError'
import { useT } from '../lib/i18n'

type T = ReturnType<typeof useT>

const COLOR_RULE_LABELS: Record<string, string> = {
  distinct: 'Distinct colors',
  no_overlap: 'No shared colors',
}

function filterSummary(f: Draw['filters'], t: T): string[] {
  const out: string[] = []
  if (f.color_rule && COLOR_RULE_LABELS[f.color_rule]) out.push(t(COLOR_RULE_LABELS[f.color_rule]))
  if (f.same_edition) out.push(t('Same set'))
  if (f.no_repeat) out.push(t('No repeats'))
  if (f.max_bracket) out.push(t('Up to bracket {n}', { n: f.max_bracket }))
  if (f.bracket_balance) out.push(t('Balanced brackets'))
  if (f.year_from && f.year_to) out.push(`${f.year_from}–${f.year_to}`)
  else if (f.year_from) out.push(`${f.year_from}+`)
  else if (f.year_to) out.push(t('Up to {year}', { year: f.year_to }))
  if (f.editions?.length) out.push(t('Set: {sets}', { sets: f.editions.join(', ') }))
  if (f.deck_slugs?.length)
    out.push(
      t(f.deck_slugs.length === 1 ? 'From {n} chosen deck' : 'From {n} chosen decks', { n: f.deck_slugs.length }),
    )
  return out
}

function shareText(draw: Draw, url: string, t: T) {
  const lines = draw.entries.map((e) => {
    if (!e.deck) return `${e.player_name} → ${t('(deck removed)')}`
    const commander = e.deck.face_commander ? ` (${e.deck.face_commander.name})` : ''
    const owner = e.owner ? ` — ${t('owned by')} ${e.owner}` : ''
    return `${e.player_name} → ${e.deck.name}${commander}${owner}`
  })
  return `Choose at random — ${t('deal #{code}', { code: draw.code })}\n${lines.join('\n')}\n${url}`
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function DrawPage() {
  const { code = '' } = useParams()
  const t = useT()
  useTitle(t('Deal #{code}', { code }))
  const navigate = useNavigate()
  const location = useLocation()
  const shouldAnimate = !!(location.state as { animate?: boolean } | null)?.animate && !reducedMotion()

  const queryClient = useQueryClient()
  const draw = useQuery({ queryKey: ['draw', code], queryFn: () => api.getDraw(code), staleTime: Infinity })

  // Artes para a roleta: os decks do catálogo (uma única chamada, guardada em cache)
  const pool = useArts(shouldAnimate)
  const arts = pool.arts

  const [revealed, setRevealed] = useState<number>(shouldAnimate ? 0 : Infinity)
  const [copied, setCopied] = useState(false)

  // Pré-carrega as artes da roleta e as dos decks sorteados
  useEffect(() => {
    for (const src of arts.slice(0, 60)) new Image().src = src
  }, [arts])
  useEffect(() => {
    for (const e of draw.data?.entries ?? []) {
      if (e.deck?.face_commander?.image_art_crop) new Image().src = e.deck.face_commander.image_art_crop
    }
  }, [draw.data])

  const total = draw.data?.entries.length ?? 0
  useEffect(() => {
    // Terminou a revelação: limpa o estado para não animar de novo ao recarregar a página
    if (shouldAnimate && total > 0 && revealed >= total) navigate('.', { replace: true, state: null })
  }, [revealed, total, shouldAnimate, navigate])

  const reroll = useMutation({
    mutationFn: (d: Draw) =>
      api.draw(
        d.entries.map((e) => e.player_name),
        d.filters,
        d.mode,
      ),
    onSuccess: (next) => {
      setRevealed(reducedMotion() ? Infinity : 0)
      navigate(`/sorteio/${next.code}`, { state: { animate: true } })
    },
  })

  if (draw.isPending) return <p className="text-center text-parchment/60">{t('Loading deal…')}</p>
  if (draw.isError)
    return (
      <div className="space-y-4 py-10 text-center">
        <LoadError error={draw.error} onRetry={() => draw.refetch()} retrying={draw.isFetching} />
        <Link to="/" className="text-gold hover:underline">
          {t('Make a new deal')}
        </Link>
      </div>
    )

  const d = draw.data
  const url = `${window.location.origin}/sorteio/${d.code}`
  const summary = filterSummary(d.filters, t)
  const allRevealed = revealed >= d.entries.length
  const waitingArts = shouldAnimate && revealed === 0 && pool.isPending

  const share = async () => {
    const text = shareText(d, url, t)
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Choose at random', text })
        return
      } catch {
        /* cancelado: cai na cópia */
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      window.prompt(t('Copy the deal link:'), url)
    }
  }

  const cols =
    d.entries.length === 2
      ? 'max-w-2xl sm:grid-cols-2'
      : d.entries.length === 3
        ? 'max-w-4xl sm:grid-cols-3'
        : 'sm:grid-cols-2 lg:grid-cols-4'

  return (
    <section className="space-y-8">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl text-gold sm:text-4xl">
          {allRevealed ? t('The table is set') : t('Shuffling…')}
        </h1>
        <p className="text-sm text-parchment/50">
          {d.mode === 'pool' ? t('Deck pool') : 'Precons'} · <span className="font-mono text-parchment/70">#{d.code}</span>{' '}
          · {t(d.pool_size === 1 ? 'from {n} deck' : 'from {n} decks', { n: d.pool_size })}
          {summary.length > 0 && ` · ${summary.join(' · ')}`}
        </p>
      </div>

      <div className={`mx-auto grid gap-6 ${cols}`}>
        {d.entries.map((entry, i) => (
          <div key={`${d.code}-${entry.position}`} className="space-y-2">
            <p className="truncate text-center font-display text-xl text-parchment">{entry.player_name}</p>
            {i < revealed ? (
              <div className={`space-y-1.5 ${shouldAnimate ? 'flip-in' : ''}`}>
                {entry.deck ? (
                  <DeckTile deck={entry.deck} showOwned={false} />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-gold/20 bg-surface text-sm text-parchment/50">
                    {t('Deck removed by its owner')}
                  </div>
                )}
                {entry.owner && (
                  <p className="text-center text-xs text-parchment/50">
                    {t('owned by')} <span className="text-parchment/80">{entry.owner}</span>
                  </p>
                )}
              </div>
            ) : i === revealed && !waitingArts ? (
              <Roulette arts={arts} duration={1600 + (i === 0 ? 400 : 0)} onDone={() => setRevealed(i + 1)} />
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-gold/20 bg-surface">
                <span className="font-display text-4xl text-gold/40">?</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {allRevealed && (
        <div className="flip-in mx-auto flex max-w-xl flex-col gap-3 whitespace-nowrap sm:flex-row">
          <button
            onClick={share}
            className="flex-1 rounded-lg bg-gold px-5 py-3 font-semibold text-ink transition hover:brightness-110"
          >
            {copied ? t('Copied!') : t('Share')}
          </button>
          {d.mode !== 'pool' && (
            <button
              onClick={() => reroll.mutate(d)}
              disabled={reroll.isPending}
              className="flex-1 rounded-lg border border-gold/50 px-5 py-3 text-gold transition hover:bg-gold/10 disabled:opacity-50"
            >
              {reroll.isPending ? t('Dealing…') : t('Deal again')}
            </button>
          )}
          <Link
            to="/"
            className="flex-1 rounded-lg border border-parchment/20 px-5 py-3 text-center text-parchment/70 transition hover:border-parchment/40"
          >
            {t('Change the table')}
          </Link>
        </div>
      )}
      {allRevealed && (
        <WinnerPicker draw={d} onSaved={(next) => queryClient.setQueryData(['draw', d.code], next)} />
      )}
      {allRevealed && (
        <p className="text-center text-xs text-parchment/40">
          {t('Enjoying it?')}{' '}
          <Link to="/apoie" className="text-gold/70 hover:text-gold hover:underline">
            {t('Support the project')} ☕
          </Link>
        </p>
      )}
      {reroll.isError && <p className="text-center text-sm text-red-400">{reroll.error.message}</p>}
    </section>
  )
}
