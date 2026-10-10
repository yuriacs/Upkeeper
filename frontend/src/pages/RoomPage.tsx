import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import DeckTile from '../components/DeckTile'
import MyDeckPanel from '../components/MyDeckPanel'
import RoomQr from '../components/RoomQr'
import Roulette from '../components/Roulette'
import Trophy from '../components/Trophy'
import WinnerPicker from '../components/WinnerPicker'
import { RuleRow, RulesCard, Segmented, Switch } from '../components/RuleControls'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { getRoomToken, setRoomToken } from '../lib/roomTokens'
import type { ColorRule, DrawFilters, Room } from '../lib/types'
import { useTitle } from '../hooks/useTitle'

// Linha do tempo da revelação, igual em todos os navegadores (relativa a reveal_at do servidor)
const FIRST_STOP_MS = 2500
const STEP_MS = 1800

const COLOR_RULES: { value: ColorRule; label: string; hint: string }[] = [
  { value: 'any', label: 'Livres', hint: 'Qualquer combinação de cores na mesa.' },
  { value: 'distinct', label: 'Diferentes', hint: 'Ninguém com a mesma identidade de cor.' },
  { value: 'no_overlap', label: 'Sem cores em comum', hint: 'Nenhuma cor se repete entre os decks da mesa.' },
]

function useServerClock(room: Room | undefined, fetchedAt: number) {
  // Diferença entre o relógio do servidor e o deste aparelho
  const offset = useRef(0)
  useEffect(() => {
    if (room?.server_time && fetchedAt) offset.current = Date.parse(room.server_time) - fetchedAt
  }, [room?.server_time, fetchedAt])
  return () => Date.now() + offset.current
}

function JoinForm({ room, onJoined }: { room: Room; onJoined: (r: Room) => void }) {
  const { user } = useAuth()
  const [name, setName] = useState(user?.username ?? '')
  const join = useMutation({
    mutationFn: () => api.joinRoom(room.code, name.trim()),
    onSuccess: onJoined,
  })
  const isPool = room.mode === 'pool'
  const full = room.players.length >= 4

  if (isPool && !user)
    return (
      <div className="mx-auto max-w-sm space-y-3 rounded-xl border border-gold/20 bg-surface/60 p-5 text-center">
        <p className="text-parchment/80">Esta sala usa a deckpool dos jogadores. Entre na sua conta para participar.</p>
        <Link
          to="/entrar"
          state={{ next: `/sala/${room.code}` }}
          className="inline-block rounded-lg bg-gold px-5 py-2.5 font-semibold text-ink hover:brightness-110"
        >
          Entrar ou criar conta
        </Link>
      </div>
    )

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        join.mutate()
      }}
      className="mx-auto max-w-sm space-y-3 rounded-xl border border-gold/20 bg-surface/60 p-5"
    >
      <label className="block space-y-1 text-sm">
        <span className="text-parchment/70">Seu nome na mesa</span>
        <input
          value={isPool ? (user?.username ?? '') : name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPool}
          required
          maxLength={40}
          autoFocus
          className="w-full rounded-lg border border-gold/20 bg-ink px-4 py-2.5 focus:border-gold focus:outline-none disabled:opacity-70"
        />
      </label>
      <button
        type="submit"
        disabled={join.isPending || full}
        className="w-full rounded-lg bg-gold px-5 py-3 font-semibold text-ink transition hover:brightness-110 disabled:opacity-50"
      >
        {full ? 'Sala cheia' : join.isPending ? 'Entrando…' : 'Entrar na sala'}
      </button>
      {join.isError && <p className="text-sm text-red-400">{join.error.message}</p>}
    </form>
  )
}

export default function RoomPage() {
  const { code = '' } = useParams()
  useTitle(`Sala ${code.toUpperCase()}`)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [token, setToken] = useState(() => getRoomToken(code))
  const [fetchedAt, setFetchedAt] = useState(0)
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetDone, setResetDone] = useState<number | null>(null)

  const room = useQuery({
    queryKey: ['room', code, token],
    queryFn: async () => {
      const start = Date.now()
      const data = await api.getRoom(code, token)
      setFetchedAt((start + Date.now()) / 2)
      return data
    },
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 3,
  })
  const r = room.data
  const serverNow = useServerClock(r, fetchedAt)

  // Token salvo, mas o jogador foi removido da sala
  useEffect(() => {
    if (r && token && r.you === null) {
      setRoomToken(code, null)
      setToken(null)
    }
  }, [r, token, code])

  const setRoom = (data: Room) => {
    if (data.token) {
      setRoomToken(code, data.token)
      setToken(data.token)
    }
    queryClient.setQueryData(['room', code, data.token ?? token], data)
  }

  const isHost = !!r && r.you !== null && r.you === r.host_id

  const hostAction = useMutation({
    mutationFn: (fn: (t: string) => Promise<Room>) => fn(token!),
    onSuccess: setRoom,
  })

  const resetHistory = useMutation({
    mutationFn: () => api.resetRoomHistory(code, token!),
    onSuccess: (data) => {
      setRoom(data)
      setConfirmReset(false)
      setResetDone(data.cleared)
    },
  })

  const scoreKey = [r?.draw?.code, r?.draw?.winner_position, r?.round]
  const scoreboard = useQuery({
    queryKey: ['scoreboard', code, ...scoreKey],
    queryFn: () => api.roomScoreboard(code),
    enabled: !!r,
    placeholderData: (prev) => prev,
  })

  // Artes para a roleta
  const pool = useQuery({ queryKey: ['roulette-pool'], queryFn: () => api.decks({}, 1, 200), staleTime: Infinity })
  const arts = useMemo(
    () => (pool.data?.results ?? []).map((d) => d.face_commander?.image_art_crop).filter(Boolean) as string[],
    [pool.data],
  )

  // Relógio da revelação: quantos decks já apareceram para todos
  const revealAt = r?.reveal_at ? Date.parse(r.reveal_at) : 0
  const total = r?.draw?.entries.length ?? 0
  const stopAt = (i: number) => revealAt + FIRST_STOP_MS + i * STEP_MS
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    if (!revealAt || now > stopAt(total - 1)) return
    const t = setInterval(() => setNow(serverNow()), 100)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- o intervalo para sozinho no fim da revelação
  }, [revealAt, total, now > stopAt(total - 1)])
  const revealed = revealAt ? Array.from({ length: total }, (_, i) => now >= stopAt(i)).filter(Boolean).length : 0
  const started = revealAt > 0 && now >= revealAt
  const allRevealed = total > 0 && revealed >= total

  if (room.isPending) return <p className="text-center text-parchment/60">Abrindo a sala…</p>
  if (room.isError || !r)
    return (
      <div className="space-y-4 py-10 text-center">
        <p className="text-red-400">
          {room.error instanceof ApiError && room.error.status === 404 ? 'Sala não encontrada.' : room.error?.message}
        </p>
        <Link to="/" className="text-gold hover:underline">
          Voltar ao início
        </Link>
      </div>
    )

  const url = `${window.location.origin}/sala/${r.code}`
  const share = async () => {
    const text = `Entra na sala ${r.code.toUpperCase()} do Choose at random para sortearmos os decks: ${url}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Choose at random', text, url })
        return
      } catch {
        /* cancelado */
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copie o link da sala:', url)
    }
  }

  const mySeat = r.you !== null ? r.draw_seats.indexOf(r.you) : -1
  const myEntry = mySeat >= 0 ? r.draw?.entries[mySeat] : undefined
  const canDraw = r.players.length >= 2 && r.players.length <= 4
  const filters = r.filters
  const setFilters = (patch: Partial<DrawFilters>) =>
    hostAction.mutate((t) => api.updateRoom(code, t, { filters: { ...filters, ...patch } }))

  const cols =
    total === 2
      ? 'max-w-2xl sm:grid-cols-2'
      : total === 3
        ? 'max-w-4xl sm:grid-cols-3'
        : 'sm:grid-cols-2 lg:grid-cols-4'

  return (
    <section className="space-y-8">
      <div className="space-y-3 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-parchment/40">Sala</p>
        <h1 className="font-display text-4xl tracking-widest text-gold">{r.code.toUpperCase()}</h1>
        <p className="text-sm text-parchment/50">
          {r.mode === 'pool' ? 'Deckpool dos jogadores' : 'Precons oficiais'}
          {r.round > 0 && ` · rodada ${r.round}`}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            onClick={share}
            className="rounded-lg border border-gold/40 px-4 py-2 text-sm text-gold transition hover:bg-gold/10"
          >
            {copied ? 'Link copiado!' : 'Convidar jogadores'}
          </button>
          <button
            onClick={() => setShowQr((v) => !v)}
            aria-expanded={showQr}
            className="rounded-lg border border-gold/40 px-4 py-2 text-sm text-gold transition hover:bg-gold/10"
          >
            {showQr ? 'Esconder QR code' : 'Mostrar QR code'}
          </button>
        </div>
        {showQr && <RoomQr url={url} />}
      </div>

      {r.you === null ? (
        <JoinForm room={r} onJoined={setRoom} />
      ) : (
        <>
          {r.draw && (
            <div className="space-y-6">
              <h2 className="text-center font-display text-2xl text-parchment">
                {!started ? 'Prepare-se…' : allRevealed ? 'A mesa está pronta' : 'Embaralhando…'}
              </h2>
              {myEntry?.deck && mySeat < revealed && (
                <MyDeckPanel key={`${r.round}-${myEntry.deck.slug}`} deck={myEntry.deck} />
              )}
              <div className={`mx-auto grid gap-6 ${cols}`}>
                {r.draw.entries.map((entry, i) => {
                  const mine = i === mySeat
                  return (
                    <div key={`${r.round}-${i}`} className="space-y-2">
                      <p
                        className={`truncate text-center font-display text-xl ${mine ? 'text-gold' : 'text-parchment'}`}
                      >
                        {entry.player_name}
                        {mine && <span className="ml-2 align-middle text-xs font-sans text-gold/80">(você)</span>}
                      </p>
                      {i < revealed ? (
                        <div
                          className={`flip-in space-y-1.5 ${mine ? 'rounded-xl ring-2 ring-gold ring-offset-4 ring-offset-ink' : ''}`}
                        >
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
                      ) : started && i === revealed ? (
                        <Roulette
                          key={`${r.round}-${i}-spin`}
                          arts={arts}
                          duration={Math.max(stopAt(i) - now, 200)}
                          onDone={() => setNow(serverNow())}
                        />
                      ) : (
                        <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-gold/20 bg-surface">
                          <span className="font-display text-4xl text-gold/40">?</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {r.draw && allRevealed && (
                <WinnerPicker
                  draw={r.draw}
                  roomToken={token}
                  onSaved={() => queryClient.invalidateQueries({ queryKey: ['room', code] })}
                />
              )}
              {r.draw && allRevealed && (
                <p className="text-center text-xs text-parchment/40">
                  Resultado salvo em{' '}
                  <Link to={`/sorteio/${r.draw.code}`} className="text-gold/70 hover:underline">
                    /sorteio/{r.draw.code}
                  </Link>
                </p>
              )}
            </div>
          )}

          <div className="mx-auto max-w-xl space-y-5">
            <div className="space-y-2">
              <h2 className="text-sm text-parchment/60">Jogadores ({r.players.length}/4)</h2>
              <ul className="divide-y divide-gold/10 rounded-xl border border-gold/15 bg-surface/60">
                {r.players.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex-1 truncate">
                      {p.name}
                      {p.id === r.you && <span className="ml-2 text-xs text-gold/80">você</span>}
                    </span>
                    {p.id === r.host_id && <span className="text-xs text-gold">anfitrião</span>}
                    {isHost && p.id !== r.you && (
                      <button
                        onClick={() => hostAction.mutate((t) => api.kickFromRoom(code, t, p.id))}
                        className="text-xs text-parchment/40 hover:text-red-400"
                        aria-label={`Remover ${p.name}`}
                      >
                        remover
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {!!scoreboard.data?.players.length && (
              <div className="space-y-2">
                <h2 className="text-sm text-parchment/60">Placar da sala</h2>
                <table className="w-full overflow-hidden rounded-xl border border-gold/15 bg-surface/60 text-sm">
                  <thead className="text-left text-xs text-parchment/45">
                    <tr className="border-b border-gold/10">
                      <th className="px-4 py-2 font-normal">Jogador</th>
                      <th className="px-2 py-2 text-right font-normal">Vitórias</th>
                      <th className="px-2 py-2 text-right font-normal">Partidas</th>
                      <th className="px-4 py-2 text-right font-normal">Taxa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gold/10">
                    {scoreboard.data.players.map((p, i) => (
                      <tr key={p.name}>
                        <td className="max-w-0 truncate px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            {i === 0 && p.wins > 0 && <Trophy className="size-4 shrink-0 text-gold" />}
                            {p.name}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-gold">{p.wins}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-parchment/70">{p.games}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-parchment/70">
                          {Math.round(p.win_rate * 100)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <RulesCard
              title={
                <span className="flex items-center justify-between gap-2">
                  <span>Regras do sorteio</span>
                  {!isHost && <span className="text-xs text-parchment/40">definidas pelo anfitrião</span>}
                </span>
              }
            >
              <RuleRow
                label="Decks"
                hint={
                  r.mode === 'pool'
                    ? 'Junta os decks de cada jogador; ninguém recebe um deck que é seu. Todos precisam de conta.'
                    : 'Todos os precons oficiais de Commander.'
                }
              >
                <Segmented
                  label="Modo"
                  disabled={!isHost}
                  value={r.mode}
                  onChange={(mode) => hostAction.mutate((t) => api.updateRoom(code, t, { mode }))}
                  options={[
                    { value: 'precon', label: 'Precons oficiais' },
                    { value: 'pool', label: 'Deckpool' },
                  ]}
                />
              </RuleRow>
              <RuleRow label="Cores" hint={COLOR_RULES.find((c) => c.value === (filters.color_rule ?? 'any'))?.hint}>
                <Segmented
                  label="Cores"
                  disabled={!isHost}
                  value={filters.color_rule ?? 'any'}
                  onChange={(color_rule) => setFilters({ color_rule })}
                  options={COLOR_RULES.map((c) => ({ value: c.value, label: c.label }))}
                />
              </RuleRow>
              {r.mode === 'precon' && (
                <>
                  <RuleRow label="Época">
                    <Segmented
                      label="Época"
                      disabled={!isHost}
                      value={filters.year_from ?? 0}
                      onChange={(y) => setFilters({ year_from: y || undefined })}
                      options={[
                        { value: 0, label: 'Qualquer' },
                        { value: 2020, label: '2020+' },
                        { value: 2024, label: '2024+' },
                      ]}
                    />
                  </RuleRow>
                  <RuleRow label="Coleção">
                    <Switch
                      label="Todos os decks da mesma coleção"
                      disabled={!isHost}
                      checked={!!filters.same_edition}
                      onChange={(same_edition) => setFilters({ same_edition })}
                    />
                  </RuleRow>
                </>
              )}
              <RuleRow
                label="Repetição"
                hint="Ninguém recebe um deck que já jogou. Com conta, vale o histórico de todos os sorteios; sem conta, o desta sala."
              >
                <Switch
                  label="Não repetir deck"
                  disabled={!isHost}
                  checked={!!filters.no_repeat}
                  onChange={(no_repeat) => setFilters({ no_repeat })}
                />
                {isHost && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {confirmReset ? (
                      <>
                        <span className="text-parchment/70">Esquecer os decks já sorteados nesta sala?</span>
                        <button
                          onClick={() => resetHistory.mutate()}
                          disabled={resetHistory.isPending}
                          className="rounded border border-red-400/50 px-2 py-1 text-red-300 hover:border-red-400 disabled:opacity-50"
                        >
                          {resetHistory.isPending ? 'Zerando…' : 'Sim, zerar'}
                        </button>
                        <button onClick={() => setConfirmReset(false)} className="px-2 py-1 text-parchment/50">
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          setResetDone(null)
                          setConfirmReset(true)
                        }}
                        className="text-parchment/50 underline-offset-2 hover:text-gold hover:underline"
                      >
                        Zerar histórico da sala
                      </button>
                    )}
                    {resetDone !== null && !confirmReset && (
                      <span className="text-gold/80" role="status">
                        {resetDone ? 'Histórico zerado.' : 'O histórico já estava vazio.'}
                      </span>
                    )}
                    {resetHistory.isError && <span className="text-red-400">{resetHistory.error.message}</span>}
                  </div>
                )}
              </RuleRow>
            </RulesCard>

            {isHost ? (
              <div className="space-y-2">
                <button
                  onClick={() => hostAction.mutate((t) => api.drawRoom(code, t))}
                  disabled={!canDraw || hostAction.isPending || (!!r.draw && !allRevealed)}
                  className="w-full rounded-lg bg-gold px-6 py-4 font-display text-lg font-bold text-ink shadow-lg shadow-gold/20 transition hover:brightness-110 disabled:opacity-50"
                >
                  {hostAction.isPending ? 'Sorteando…' : r.draw ? 'Sortear de novo' : 'Sortear decks'}
                </button>
                {!canDraw && <p className="text-center text-xs text-parchment/50">Esperando pelo menos 2 jogadores.</p>}
                {hostAction.isError && <p className="text-center text-sm text-red-400">{hostAction.error.message}</p>}
              </div>
            ) : (
              <p className="text-center text-sm text-parchment/50">
                {r.draw ? 'O anfitrião pode sortear de novo a qualquer momento.' : 'Esperando o anfitrião sortear…'}
              </p>
            )}

            <button
              onClick={async () => {
                if (token) await api.leaveRoom(code, token).catch(() => undefined)
                setRoomToken(code, null)
                navigate('/')
              }}
              className="w-full text-center text-sm text-parchment/40 hover:text-red-400"
            >
              Sair da sala
            </button>
          </div>
        </>
      )}
    </section>
  )
}
