import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import DeckRow, { WinRate } from '../components/DeckRow'
import Trophy from '../components/Trophy'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import type { MyDraw } from '../lib/types'

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gold/15 bg-surface/60 px-4 py-3">
      <p className="font-display text-2xl tabular-nums text-gold">{value}</p>
      <p className="text-xs text-parchment/55">{label}</p>
    </div>
  )
}

function ResultBadge({ result }: { result: MyDraw['result'] }) {
  if (result === 'won')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gold px-2.5 py-0.5 text-xs font-semibold text-ink">
        <Trophy className="size-3.5" /> Vitória
      </span>
    )
  if (result === 'lost')
    return <span className="rounded-full border border-parchment/20 px-2.5 py-0.5 text-xs text-parchment/60">Derrota</span>
  return <span className="rounded-full border border-dashed border-parchment/20 px-2.5 py-0.5 text-xs text-parchment/40">Sem resultado</span>
}

function DrawItem({ d }: { d: MyDraw }) {
  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-parchment/50">
        <span>
          {dateFmt.format(new Date(d.created_at))} · {d.mode === 'pool' ? 'Deckpool' : 'Precons'} ·{' '}
          <Link to={`/sorteio/${d.code}`} className="font-mono text-gold/70 hover:underline">
            #{d.code}
          </Link>
        </span>
        <ResultBadge result={d.result} />
      </div>
      {d.deck ? (
        <DeckRow deck={d.deck} />
      ) : (
        <p className="text-sm text-parchment/50">Deck removido pelo dono</p>
      )}
      {d.opponents.length > 0 && (
        <p className="text-sm text-parchment/60">
          <span className="text-parchment/40">contra </span>
          {d.opponents.map((o, i) => (
            <span key={o.position}>
              {i > 0 && <span className="text-parchment/30"> · </span>}
              <span className={o.player_name === d.winner ? 'text-gold' : ''}>
                {o.player_name}
              </span>
              {o.deck && <span className="text-parchment/40"> ({o.deck.name})</span>}
            </span>
          ))}
        </p>
      )}
    </li>
  )
}

export default function MyDrawsPage() {
  useTitle('Meus sorteios')
  const stats = useQuery({ queryKey: ['my-stats'], queryFn: api.myStats })
  const draws = useInfiniteQuery({
    queryKey: ['my-draws'],
    queryFn: ({ pageParam }) => api.myDraws(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.next ? all.length + 1 : undefined),
  })
  const items = draws.data?.pages.flatMap((p) => p.results) ?? []
  const s = stats.data

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-1">
        <h1 className="font-display text-3xl text-gold">Meus sorteios</h1>
        <p className="text-parchment/70">Os decks que você já recebeu, contra quem jogou e como terminou.</p>
      </div>

      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="sorteios" value={s.draws} />
          <Stat label="partidas com resultado" value={s.games} />
          <Stat label="vitórias" value={s.wins} />
          <Stat label="taxa de vitória" value={s.games ? `${Math.round(s.win_rate * 100)}%` : '—'} />
        </div>
      )}

      {s && (s.most_received.length > 0 || s.best_decks.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {s.most_received.length > 0 && (
            <section className="space-y-3 rounded-xl border border-gold/15 bg-surface/60 p-4">
              <h2 className="text-sm text-parchment/60">Os que mais caíram para você</h2>
              {s.most_received.map((r) => (
                <DeckRow key={r.deck.slug} deck={r.deck}>
                  <span className="shrink-0 text-sm tabular-nums text-parchment/60">{r.times}×</span>
                </DeckRow>
              ))}
            </section>
          )}
          {s.best_decks.length > 0 && (
            <section className="space-y-3 rounded-xl border border-gold/15 bg-surface/60 p-4">
              <h2 className="text-sm text-parchment/60">Seus melhores decks</h2>
              {s.best_decks.map((r) => (
                <DeckRow key={r.deck.slug} deck={r.deck}>
                  <WinRate rate={r.win_rate} games={r.games} wins={r.wins} />
                </DeckRow>
              ))}
            </section>
          )}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm text-parchment/60">Histórico</h2>
        {draws.isPending ? (
          <p className="text-parchment/50">Carregando…</p>
        ) : draws.isError ? (
          <p className="text-red-400">{draws.error.message}</p>
        ) : items.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-gold/15 bg-surface/60 p-6 text-center text-parchment/60">
            <p>Você ainda não estava em nenhum sorteio com a sua conta.</p>
            <p className="text-sm text-parchment/45">
              Os sorteios aparecem aqui quando você entra numa sala logado.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gold/10 overflow-hidden rounded-xl border border-gold/15 bg-surface/60">
            {items.map((d) => (
              <DrawItem key={`${d.code}-${d.position}`} d={d} />
            ))}
          </ul>
        )}
        {draws.hasNextPage && (
          <button
            onClick={() => draws.fetchNextPage()}
            disabled={draws.isFetchingNextPage}
            className="w-full rounded-lg border border-gold/30 py-2.5 text-sm text-gold hover:bg-gold/10 disabled:opacity-50"
          >
            {draws.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </button>
        )}
      </section>
    </div>
  )
}
