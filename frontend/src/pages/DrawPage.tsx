import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import DeckTile from '../components/DeckTile'
import Roulette from '../components/Roulette'
import WinnerPicker from '../components/WinnerPicker'
import { api } from '../lib/api'
import type { Draw } from '../lib/types'
import { useTitle } from '../hooks/useTitle'

const COLOR_RULE_LABELS: Record<string, string> = {
  distinct: 'Cores diferentes',
  no_overlap: 'Sem cores em comum',
}

function filterSummary(f: Draw['filters']): string[] {
  const out: string[] = []
  if (f.color_rule && COLOR_RULE_LABELS[f.color_rule]) out.push(COLOR_RULE_LABELS[f.color_rule])
  if (f.same_edition) out.push('Mesma coleção')
  if (f.no_repeat) out.push('Sem repetir deck')
  if (f.year_from && f.year_to) out.push(`${f.year_from}–${f.year_to}`)
  else if (f.year_from) out.push(`${f.year_from}+`)
  else if (f.year_to) out.push(`Até ${f.year_to}`)
  if (f.editions?.length) out.push(`Coleção: ${f.editions.join(', ')}`)
  if (f.deck_slugs?.length) out.push(`Entre ${f.deck_slugs.length} decks escolhidos`)
  return out
}

function shareText(draw: Draw, url: string) {
  const lines = draw.entries.map((e) => {
    if (!e.deck) return `${e.player_name} → (deck removido)`
    const commander = e.deck.face_commander ? ` (${e.deck.face_commander.name})` : ''
    const owner = e.owner ? ` — deck de ${e.owner}` : ''
    return `${e.player_name} → ${e.deck.name}${commander}${owner}`
  })
  return `Choose at random — sorteio #${draw.code}\n${lines.join('\n')}\n${url}`
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function DrawPage() {
  const { code = '' } = useParams()
  useTitle(`Sorteio #${code}`)
  const navigate = useNavigate()
  const location = useLocation()
  const shouldAnimate = !!(location.state as { animate?: boolean } | null)?.animate && !reducedMotion()

  const queryClient = useQueryClient()
  const draw = useQuery({ queryKey: ['draw', code], queryFn: () => api.getDraw(code), staleTime: Infinity })

  // Artes para a roleta: os decks do catálogo (uma única chamada, guardada em cache)
  const pool = useQuery({
    queryKey: ['roulette-pool'],
    queryFn: () => api.decks({}, 1, 200),
    staleTime: Infinity,
    enabled: shouldAnimate,
  })
  const arts = useMemo(
    () => (pool.data?.results ?? []).map((d) => d.face_commander?.image_art_crop).filter(Boolean) as string[],
    [pool.data],
  )

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

  if (draw.isPending) return <p className="text-center text-parchment/60">Carregando sorteio…</p>
  if (draw.isError)
    return (
      <div className="space-y-4 py-10 text-center">
        <p className="text-red-400">{draw.error.message}</p>
        <Link to="/" className="text-gold hover:underline">
          Fazer um novo sorteio
        </Link>
      </div>
    )

  const d = draw.data
  const url = `${window.location.origin}/sorteio/${d.code}`
  const summary = filterSummary(d.filters)
  const allRevealed = revealed >= d.entries.length
  const waitingArts = shouldAnimate && revealed === 0 && pool.isPending

  const share = async () => {
    const text = shareText(d, url)
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
      window.prompt('Copie o link do sorteio:', url)
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
          {allRevealed ? 'A mesa está pronta' : 'Embaralhando…'}
        </h1>
        <p className="text-sm text-parchment/50">
          {d.mode === 'pool' ? 'Deckpool' : 'Precons'} · <span className="font-mono text-parchment/70">#{d.code}</span>{' '}
          · entre {d.pool_size} decks
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
                    Deck removido pelo dono
                  </div>
                )}
                {entry.owner && (
                  <p className="text-center text-xs text-parchment/50">
                    deck de <span className="text-parchment/80">{entry.owner}</span>
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
            {copied ? 'Copiado!' : 'Compartilhar'}
          </button>
          {d.mode !== 'pool' && (
            <button
              onClick={() => reroll.mutate(d)}
              disabled={reroll.isPending}
              className="flex-1 rounded-lg border border-gold/50 px-5 py-3 text-gold transition hover:bg-gold/10 disabled:opacity-50"
            >
              {reroll.isPending ? 'Sorteando…' : 'Sortear de novo'}
            </button>
          )}
          <Link
            to="/"
            className="flex-1 rounded-lg border border-parchment/20 px-5 py-3 text-center text-parchment/70 transition hover:border-parchment/40"
          >
            Mudar a mesa
          </Link>
        </div>
      )}
      {allRevealed && (
        <WinnerPicker draw={d} onSaved={(next) => queryClient.setQueryData(['draw', d.code], next)} />
      )}
      {allRevealed && (
        <p className="text-center text-xs text-parchment/40">
          Curtiu?{' '}
          <Link to="/apoie" className="text-gold/70 hover:text-gold hover:underline">
            Apoie o projeto ☕
          </Link>
        </p>
      )}
      {reroll.isError && <p className="text-center text-sm text-red-400">{reroll.error.message}</p>}
    </section>
  )
}
