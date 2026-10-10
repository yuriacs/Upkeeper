import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import DeckRow, { WinRate } from '../components/DeckRow'
import Trophy from '../components/Trophy'
import { useTitle } from '../hooks/useTitle'
import { api } from '../lib/api'
import type { DeckRanking } from '../lib/types'

function Board({ title, hint, children, empty }: { title: string; hint: string; children: ReactNode; empty: boolean }) {
  return (
    <section className="space-y-3 rounded-xl border border-gold/15 bg-surface/60 p-4">
      <div>
        <h2 className="font-display text-xl text-gold">{title}</h2>
        <p className="text-xs text-parchment/50">{hint}</p>
      </div>
      {empty ? <p className="py-4 text-center text-sm text-parchment/40">Ainda não tem partidas suficientes.</p> : children}
    </section>
  )
}

function DeckList({ rows, show }: { rows: DeckRanking[]; show: 'wins' | 'rate' }) {
  return (
    <ol className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.deck.slug} className="flex items-center gap-3">
          <span className="w-5 shrink-0 text-right text-sm tabular-nums text-parchment/40">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <DeckRow deck={r.deck}>
              {show === 'wins' ? (
                <p className="w-24 shrink-0 text-right text-sm tabular-nums">
                  <span className="font-semibold text-gold">{r.wins}</span>{' '}
                  <span className="text-xs text-parchment/45">
                    {r.wins === 1 ? 'vitória' : 'vitórias'}
                  </span>
                </p>
              ) : (
                <WinRate rate={r.win_rate} games={r.games} wins={r.wins} />
              )}
            </DeckRow>
          </div>
        </li>
      ))}
    </ol>
  )
}

export default function RankingPage() {
  useTitle('Ranking')
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats })

  if (stats.isPending) return <p className="text-center text-parchment/60">Contando as vitórias…</p>
  if (stats.isError) return <p className="text-center text-red-400">{stats.error.message}</p>
  const s = stats.data
  const min = `Mínimo de ${s.min_games} partidas.`

  return (
    <div className="space-y-8">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl text-gold sm:text-4xl">Ranking</h1>
        <p className="mx-auto max-w-xl text-parchment/70">
          Depois de cada partida, alguém da mesa marca quem ganhou. Aqui entra tudo o que foi marcado:{' '}
          <strong className="text-parchment">{s.games}</strong> {s.games === 1 ? 'partida' : 'partidas'} até agora.
        </p>
      </div>

      {s.games === 0 ? (
        <div className="mx-auto max-w-md space-y-4 rounded-xl border border-gold/15 bg-surface/60 p-6 text-center">
          <Trophy className="mx-auto size-10 text-gold/60" />
          <p className="text-parchment/70">
            Nenhum resultado ainda. Sorteie os decks, joguem e, no fim, marque o vencedor na página do sorteio ou na
            sala.
          </p>
          <Link to="/" className="inline-block rounded-lg bg-gold px-5 py-2.5 font-semibold text-ink hover:brightness-110">
            Sortear agora
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Board title="Mais vitórias" hint="Precons que mais ganharam partidas." empty={!s.most_wins.length}>
            <DeckList rows={s.most_wins} show="wins" />
          </Board>
          <Board title="Melhor taxa de vitória" hint={`Quem ganha mais do que joga. ${min}`} empty={!s.best_rate.length}>
            <DeckList rows={s.best_rate} show="rate" />
          </Board>
          <Board
            title="Mais azarados"
            hint={`Abaixo da média de vitórias da mesa. ${min}`}
            empty={!s.unlucky.length}
          >
            <DeckList rows={s.unlucky} show="rate" />
          </Board>
          <Board title="Jogadores" hint={`Só jogadores com conta. ${min}`} empty={!s.players.length}>
            <ol className="space-y-3">
              {s.players.map((p, i) => (
                <li key={p.username} className="flex items-center gap-3">
                  <span className="w-5 shrink-0 text-right text-sm tabular-nums text-parchment/40">{i + 1}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-medium">
                    {i === 0 && <Trophy className="size-4 shrink-0 text-gold" />}
                    {p.username}
                  </span>
                  <WinRate rate={p.win_rate} games={p.games} wins={p.wins} />
                </li>
              ))}
            </ol>
          </Board>
        </div>
      )}
    </div>
  )
}
