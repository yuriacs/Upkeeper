import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dices } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import DeckTile from '../components/DeckTile'
import MyDeckPanel from '../components/MyDeckPanel'
import RoomQr from '../components/RoomQr'
import Roulette from '../components/Roulette'
import Trophy from '../components/Trophy'
import PlayNowLink from '../components/table/PlayNowLink'
import WinnerPicker from '../components/WinnerPicker'
import BracketRule from '../components/BracketRule'
import { RuleRow, RulesCard, Segmented, Switch } from '../components/RuleControls'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { getRoomToken, setRoomToken } from '../lib/roomTokens'
import type { ColorRule, DrawFilters, Room } from '../lib/types'
import { useArts } from '../hooks/useArts'
import { useTitle } from '../hooks/useTitle'
import LoadError from '../components/LoadError'
import { useT } from '../lib/i18n'

// Linha do tempo da revelação, igual em todos os navegadores (relativa a reveal_at do servidor)
const FIRST_STOP_MS = 2500
const STEP_MS = 1800

const COLOR_RULES: { value: ColorRule; label: string; hint: string }[] = [
  { value: 'any', label: 'Any mix', hint: 'Any mix of colors at the table.' },
  { value: 'distinct', label: 'Distinct', hint: 'No two players share a color identity.' },
  { value: 'no_overlap', label: 'No shared colors', hint: 'No color appears in more than one deck at the table.' },
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
  const t = useT()
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
      <div className="mx-auto max-w-sm space-y-3 rounded-lg border border-line bg-surface/60 p-5 text-center">
        <p className="text-parchment/80">{t("This room uses the players' deck pool. Sign in to join.")}</p>
        <Link
          to="/entrar"
          state={{ next: `/sala/${room.code}` }}
          className="inline-block rounded-md bg-gold font-display text-xl tracking-wide px-5 py-2.5 text-ink hover:brightness-110"
        >
          {t('Sign in or create account')}
        </Link>
      </div>
    )

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        join.mutate()
      }}
      className="mx-auto max-w-sm space-y-3 rounded-lg border border-line bg-surface/60 p-5"
    >
      <label className="block space-y-1 text-sm">
        <span className="text-parchment/70">{t('Your name at the table')}</span>
        <input
          value={isPool ? (user?.username ?? '') : name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPool}
          required
          maxLength={40}
          autoFocus
          className="w-full rounded-lg border border-line bg-ink px-4 py-2.5 focus:border-gold focus:outline-none disabled:opacity-70"
        />
      </label>
      <button
        type="submit"
        disabled={join.isPending || full}
        className="w-full rounded-md bg-gold font-display text-xl tracking-wide px-5 py-3 text-ink transition hover:brightness-110 disabled:opacity-50"
      >
        {full ? t('Room is full') : join.isPending ? t('Joining…') : t('Join the room')}
      </button>
      {join.isError && <p className="text-sm text-red-400">{join.error.message}</p>}
    </form>
  )
}

export default function RoomPage() {
  const { code = '' } = useParams()
  const t = useT()
  useTitle(t('Room {code}', { code: code.toUpperCase() }))
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

  // Resortear: troca só o seu deck, uma vez por sorteio (clique de novo para confirmar)
  const [confirmReroll, setConfirmReroll] = useState(false)
  const reroll = useMutation({
    mutationFn: () => api.rerollRoom(code, token!),
    onSuccess: (data) => {
      setRoom(data)
      setConfirmReroll(false)
    },
    onError: () => setConfirmReroll(false),
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
  const { arts } = useArts()

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

  if (room.isPending) return <p className="text-center text-parchment/60">{t('Opening the room…')}</p>
  // Só troca a sala por erro se ela nunca carregou; uma atualização que falha no meio do jogo
  // mantém a última versão na tela e mostra um aviso (a próxima atualização tenta de novo).
  if (!r)
    return (
      <div className="space-y-4 py-10 text-center">
        {room.error instanceof ApiError && room.error.status === 404 ? (
          <p className="text-red-400">{t('Room not found.')}</p>
        ) : (
          room.error && <LoadError error={room.error} onRetry={() => room.refetch()} retrying={room.isFetching} />
        )}
        <Link to="/" className="text-gold hover:underline">
          {t('Back to home')}
        </Link>
      </div>
    )

  const url = `${window.location.origin}/sala/${r.code}`
  const share = async () => {
    const text = t('Join room {code} on Upkeeper so we can deal our decks: {url}', {
      code: r.code.toUpperCase(),
      url,
    })
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Upkeeper', text, url })
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
      window.prompt(t('Copy the room link:'), url)
    }
  }

  const mySeat = r.you !== null ? r.draw_seats.indexOf(r.you) : -1
  const myEntry = mySeat >= 0 ? r.draw?.entries[mySeat] : undefined
  const canDraw = r.players.length >= 2 && r.players.length <= 4
  const filters = r.filters
  const colorHint = COLOR_RULES.find((c) => c.value === (filters.color_rule ?? 'any'))?.hint
  const setFilters = (patch: Partial<DrawFilters>) =>
    hostAction.mutate((t) => api.updateRoom(code, t, { filters: { ...filters, ...patch } }))

  const cols =
    total === 2
      ? 'max-w-2xl grid-cols-2'
      : total === 3
        ? 'max-w-4xl grid-cols-2 sm:grid-cols-3'
        : 'grid-cols-2 lg:grid-cols-4'

  return (
    <section className="space-y-8">
      {room.isError && (
        <p
          role="status"
          className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-2 text-center text-sm text-amber-300"
        >
          {t('Connection is unstable — trying to refresh the room…')}
        </p>
      )}
      <div className="space-y-3 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-parchment/40">{t('Room')}</p>
        <h1 className="font-display text-4xl tracking-widest text-parchment">{r.code.toUpperCase()}</h1>
        <p className="text-sm text-parchment/50">
          {r.mode === 'pool' ? t("Players' deck pool") : t('Official precons')}
          {r.round > 0 && ` · ${t('round {n}', { n: r.round })}`}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            onClick={share}
            className="rounded-lg border border-parchment/25 px-4 py-2 text-sm text-gold transition hover:bg-parchment/5"
          >
            {copied ? t('Link copied!') : t('Invite players')}
          </button>
          <button
            onClick={() => setShowQr((v) => !v)}
            aria-expanded={showQr}
            className="rounded-lg border border-parchment/25 px-4 py-2 text-sm text-gold transition hover:bg-parchment/5"
          >
            {showQr ? t('Hide QR code') : t('Show QR code')}
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
                {!started ? t('Get ready…') : allRevealed ? t('The table is set') : t('Shuffling…')}
              </h2>
              {myEntry?.deck && mySeat < revealed && (
                <MyDeckPanel key={`${r.round}-${myEntry.deck.slug}`} deck={myEntry.deck} />
              )}
              <div className={`mx-auto grid gap-3 sm:gap-6 ${cols}`}>
                {r.draw.entries.map((entry, i) => {
                  const mine = i === mySeat
                  return (
                    <div key={`${r.round}-${i}-${entry.deck?.slug ?? ''}`} className="space-y-2">
                      <p
                        className={`truncate text-center font-display text-xl ${mine ? 'text-parchment' : 'text-parchment'}`}
                      >
                        {entry.player_name}
                        {mine && <span className="ml-2 align-middle text-xs font-sans text-gold/80">{t('(you)')}</span>}
                      </p>
                      {i < revealed ? (
                        <div
                          className={`flip-in space-y-1.5 ${mine ? 'rounded-lg ring-2 ring-gold ring-offset-4 ring-offset-ink' : ''}`}
                        >
                          {entry.deck ? (
                            <DeckTile deck={entry.deck} showOwned={false} />
                          ) : (
                            <div className="flex aspect-[3/4] items-center justify-center rounded-lg border border-dashed border-line bg-surface text-sm text-parchment/50">
                              {t('Deck removed by its owner')}
                            </div>
                          )}
                          {entry.owner && (
                            <p className="text-center text-xs text-parchment/50">
                              {t('owned by')} <span className="text-parchment/80">{entry.owner}</span>
                            </p>
                          )}
                          {entry.rerolled_from && (
                            <p className="text-center text-xs text-parchment/45" title={entry.rerolled_from}>
                              {t('Re-dealt (was {deck})', { deck: entry.rerolled_from })}
                            </p>
                          )}
                          {mine && allRevealed && !entry.rerolled_from && r.draw!.winner_position === null && (
                            <div className="pt-1 text-center">
                              <button
                                onClick={() => (confirmReroll ? reroll.mutate() : setConfirmReroll(true))}
                                onBlur={() => setConfirmReroll(false)}
                                disabled={reroll.isPending}
                                className={`inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold shadow-lg transition disabled:opacity-50 ${
                                  confirmReroll
                                    ? 'animate-pulse border-gold bg-gold text-ink shadow-gold/30'
                                    : 'border-gold bg-gold/15 text-gold shadow-black/40 hover:bg-gold hover:text-ink'
                                }`}
                              >
                                <Dices className="h-4 w-4" aria-hidden />
                                {reroll.isPending
                                  ? t('Re-dealing…')
                                  : confirmReroll
                                    ? t('Click again to re-deal (only once)')
                                    : t('Re-deal my deck')}
                              </button>
                              {reroll.isError && (
                                <p role="alert" className="mt-1 text-xs text-red-400">
                                  {reroll.error instanceof Error ? reroll.error.message : t('Could not re-deal.')}
                                </p>
                              )}
                            </div>
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
                        <div className="flex aspect-[3/4] items-center justify-center rounded-lg border border-dashed border-line bg-surface">
                          <span className="font-display text-4xl text-parchment/40">?</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {r.draw && allRevealed && <PlayNowLink code={r.draw.code} />}
              {r.draw && allRevealed && (
                <WinnerPicker
                  draw={r.draw}
                  roomToken={token}
                  onSaved={() => queryClient.invalidateQueries({ queryKey: ['room', code] })}
                />
              )}
              {r.draw && allRevealed && (
                <p className="text-center text-xs text-parchment/40">
                  {t('Result saved at')}{' '}
                  <Link to={`/sorteio/${r.draw.code}`} className="text-gold/70 hover:underline">
                    /sorteio/{r.draw.code}
                  </Link>
                </p>
              )}
            </div>
          )}

          <div className="mx-auto max-w-xl space-y-5">
            <div className="space-y-2">
              <h2 className="text-sm text-parchment/60">{t('Players ({n}/4)', { n: r.players.length })}</h2>
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface/60">
                {r.players.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex-1 truncate">
                      {p.name}
                      {p.id === r.you && <span className="ml-2 text-xs text-gold/80">{t('you')}</span>}
                    </span>
                    {p.id === r.host_id && <span className="text-xs text-gold">{t('host')}</span>}
                    {isHost && p.id !== r.you && (
                      <button
                        onClick={() => hostAction.mutate((t) => api.kickFromRoom(code, t, p.id))}
                        className="text-xs text-parchment/40 hover:text-red-400"
                        aria-label={t('Remove {name}', { name: p.name })}
                      >
                        {t('remove')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {!!scoreboard.data?.players.length && (
              <div className="space-y-2">
                <h2 className="text-sm text-parchment/60">{t('Room scoreboard')}</h2>
                <table className="w-full overflow-hidden rounded-lg border border-line bg-surface/60 text-sm">
                  <thead className="text-left text-xs text-parchment/45">
                    <tr className="border-b border-line">
                      <th className="px-4 py-2 font-normal">{t('Player')}</th>
                      <th className="px-2 py-2 text-right font-normal">{t('Wins')}</th>
                      <th className="px-2 py-2 text-right font-normal">{t('Games')}</th>
                      <th className="px-4 py-2 text-right font-normal">{t('Win rate')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
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
                  <span>{t('Deal rules')}</span>
                  {!isHost && <span className="text-xs text-parchment/40">{t('set by the host')}</span>}
                </span>
              }
            >
              <RuleRow
                label="Decks"
                hint={
                  r.mode === 'pool'
                    ? t("Pools every player's decks; nobody gets their own deck. Everyone needs an account.")
                    : t('Every official Commander precon.')
                }
              >
                <Segmented
                  label={t('Mode')}
                  disabled={!isHost}
                  value={r.mode}
                  onChange={(mode) => hostAction.mutate((t) => api.updateRoom(code, t, { mode }))}
                  options={[
                    { value: 'precon', label: t('Official precons') },
                    { value: 'pool', label: t('Deck pool') },
                  ]}
                />
              </RuleRow>
              <RuleRow label={t('Colors')} hint={colorHint && t(colorHint)}>
                <Segmented
                  label={t('Colors')}
                  disabled={!isHost}
                  value={filters.color_rule ?? 'any'}
                  onChange={(color_rule) => setFilters({ color_rule })}
                  options={COLOR_RULES.map((c) => ({ value: c.value, label: t(c.label) }))}
                />
              </RuleRow>
              {r.mode === 'precon' && (
                <>
                  <RuleRow label={t('Era')}>
                    <Segmented
                      label={t('Era')}
                      disabled={!isHost}
                      value={filters.year_from ?? 0}
                      onChange={(y) => setFilters({ year_from: y || undefined })}
                      options={[
                        { value: 0, label: t('Any') },
                        { value: 2020, label: '2020+' },
                        { value: 2024, label: '2024+' },
                      ]}
                    />
                  </RuleRow>
                  <RuleRow label={t('Set')}>
                    <Switch
                      label={t('All decks from the same set')}
                      disabled={!isHost}
                      checked={!!filters.same_edition}
                      onChange={(same_edition) => setFilters({ same_edition })}
                    />
                  </RuleRow>
                </>
              )}
              <BracketRule
                disabled={!isHost}
                maxBracket={filters.max_bracket ?? 0}
                balance={!!filters.bracket_balance}
                onChange={(p) =>
                  setFilters({
                    ...(p.maxBracket !== undefined && { max_bracket: p.maxBracket || null }),
                    ...(p.balance !== undefined && { bracket_balance: p.balance }),
                  })
                }
              />
              <RuleRow
                label={t('Repeats')}
                hint={t(
                  "Nobody gets a deck they've already played. With an account, all your deals count; without one, only this room's.",
                )}
              >
                <Switch
                  label={t('No repeats')}
                  disabled={!isHost}
                  checked={!!filters.no_repeat}
                  onChange={(no_repeat) => setFilters({ no_repeat })}
                />
                {isHost && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {confirmReset ? (
                      <>
                        <span className="text-parchment/70">{t('Forget the decks already dealt in this room?')}</span>
                        <button
                          onClick={() => resetHistory.mutate()}
                          disabled={resetHistory.isPending}
                          className="rounded border border-red-400/50 px-2 py-1 text-red-300 hover:border-red-400 disabled:opacity-50"
                        >
                          {resetHistory.isPending ? t('Resetting…') : t('Yes, reset')}
                        </button>
                        <button onClick={() => setConfirmReset(false)} className="px-2 py-1 text-parchment/50">
                          {t('Cancel')}
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
                        {t('Reset room history')}
                      </button>
                    )}
                    {resetDone !== null && !confirmReset && (
                      <span className="text-gold/80" role="status">
                        {resetDone ? t('History reset.') : t('History was already empty.')}
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
                  className="w-full rounded-lg bg-gold px-6 py-4 font-display text-lg font-bold text-ink shadow-lg transition hover:brightness-110 disabled:opacity-50"
                >
                  {hostAction.isPending ? t('Dealing…') : r.draw ? t('Deal again') : t('Deal decks')}
                </button>
                {!canDraw && (
                  <p className="text-center text-xs text-parchment/50">{t('Waiting for at least 2 players.')}</p>
                )}
                {hostAction.isError && <p className="text-center text-sm text-red-400">{hostAction.error.message}</p>}
              </div>
            ) : (
              <p className="text-center text-sm text-parchment/50">
                {r.draw ? t('The host can deal again at any time.') : t('Waiting for the host to deal…')}
              </p>
            )}

            <button
              onClick={async () => {
                if (token) await api.leaveRoom(code, token).catch(() => undefined)
                setRoomToken(code, null)
                navigate('/sortear')
              }}
              className="w-full text-center text-sm text-parchment/40 hover:text-red-400"
            >
              {t('Leave the room')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
