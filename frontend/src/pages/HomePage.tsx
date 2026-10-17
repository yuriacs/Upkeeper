import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Hero from '../components/Hero'
import LastDeal from '../components/LastDeal'
import { useArts } from '../hooks/useArts'
import BracketRule from '../components/BracketRule'
import { RuleRow, RulesCard, Segmented, Switch } from '../components/RuleControls'
import { useMyDecks } from '../hooks/useMyDecks'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { useAuthDialog } from '../components/auth/AuthDialog'
import { getLastDeal, setLastDeal } from '../lib/lastDeal'
import { setRoomToken } from '../lib/roomTokens'
import { loadSetup, saveSetup, setupToRequest, type TableSetup } from '../lib/setup'
import type { ColorRule, DrawMode } from '../lib/types'
import { useTitle } from '../hooks/useTitle'

const PLAYER_OPTIONS = [2, 3, 4] as const

const COLOR_RULES: { value: ColorRule; label: string; hint: string }[] = [
  { value: 'any', label: 'Any mix', hint: 'Any color combination at the table.' },
  { value: 'distinct', label: 'Different', hint: 'No one shares the same color identity.' },
  { value: 'no_overlap', label: 'No shared colors', hint: 'No color repeats between the decks at the table.' },
]

const MODES: { value: DrawMode; label: string; hint: string }[] = [
  { value: 'precon', label: 'Official precons', hint: 'Deals from every Commander precon.' },
  {
    value: 'pool',
    label: 'Table deck pool',
    hint: "Pools every player's decks; no one gets a deck of their own. Happens in an online room.",
  },
]

export default function HomePage() {
  const t = useT()
  const { openAuth } = useAuthDialog()
  useTitle(t('Deal decks'))
  const navigate = useNavigate()
  const { user } = useAuth()
  const myDecks = useMyDecks()
  const [setup, setSetupState] = useState<TableSetup>(loadSetup)
  const [showFilters, setShowFilters] = useState(
    () => setup.colorRule !== 'any' || setup.sameEdition || !!setup.yearFrom || !!setup.edition || setup.onlyMine,
  )

  const update = (patch: Partial<TableSetup>) =>
    setSetupState((prev) => {
      const next = { ...prev, ...patch }
      saveSetup(next)
      return next
    })

  const editions = useQuery({ queryKey: ['editions'], queryFn: api.editions, staleTime: Infinity })
  const years = [...new Set((editions.data ?? []).map((e) => e.release_date?.slice(0, 4)).filter(Boolean))]
    .sort()
    .reverse() as string[]

  const isPool = setup.mode === 'pool'

  const [roomCode, setRoomCode] = useState('')
  const createRoom = useMutation({
    mutationFn: () => {
      const { names: n, filters, mode } = setupToRequest(setup, myDecks.slugs)
      const hostName = mode === 'pool' ? undefined : n[0] || user?.username || ''
      if (mode === 'precon' && !hostName) throw new Error(t('Enter your name as player 1 to create the room.'))
      return api.createRoom({ name: hostName, mode, filters: { ...filters, deck_slugs: undefined } })
    },
    onSuccess: (room) => {
      if (room.token) setRoomToken(room.code, room.token)
      navigate(`/sala/${room.code}`)
    },
  })

  const draw = useMutation({
    mutationFn: () => {
      const { names, filters } = setupToRequest({ ...setup, mode: 'precon' }, myDecks.slugs)
      return api.draw(names, filters)
    },
    onSuccess: (result) => {
      setLastDeal(result.code)
      navigate(`/sorteio/${result.code}`, { state: { animate: true } })
    },
  })

  const { items: arts } = useArts()
  const precons = arts.length || 180
  // "Who plays {what} tonight?" com a palavra do meio em destaque
  const headline = t('Who plays {what} tonight?').split('{what}')

  const names = setup.names.slice(0, setup.players)
  const trimmed = names.map((n) => n.trim().toLocaleLowerCase()).filter(Boolean)
  const duplicate = new Set(trimmed).size !== trimmed.length
  const notEnoughMine = setup.onlyMine && myDecks.slugs.length < setup.players
  const activeFilters =
    (setup.noRepeat && user ? 1 : 0) +
    (setup.colorRule !== 'any' ? 1 : 0) +
    (setup.sameEdition ? 1 : 0) +
    (setup.yearFrom || setup.yearTo ? 1 : 0) +
    (setup.edition ? 1 : 0) +
    (setup.onlyMine ? 1 : 0) +
    (setup.maxBracket || setup.bracketBalance ? 1 : 0)

  const setName = (i: number, value: string) => {
    const next = [...setup.names]
    next[i] = value
    update({ names: next })
  }

  const lastDeal = getLastDeal()

  return (
    <>
      <Hero>
        <h1 className="max-w-3xl font-display text-6xl font-extrabold leading-[0.9] text-parchment sm:text-8xl">
          {headline[0]}
          <span className="text-gold">{t('what')}</span>
          {headline[1]}
        </h1>
        <p className="mt-4 max-w-xl text-lg text-parchment/75 sm:text-xl">
          {t('Shuffle {n} official Commander precons and deal one to every player. Fair, fast, no arguments.', {
            n: precons,
          })}
        </p>
      </Hero>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-6 pb-16 sm:px-6 lg:grid-cols-[minmax(0,24rem)_1fr] lg:gap-12">
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            draw.mutate()
          }}
        >
          <h2 className="border-b-2 border-parchment pb-1.5 font-display text-2xl text-parchment">{t('Your table')}</h2>

          <div className="space-y-2">
            <div role="radiogroup" aria-label={t('Deal mode')} className="flex flex-wrap gap-2 text-sm">
              {MODES.map((m) => (
                <button
                  type="button"
                  key={m.value}
                  role="radio"
                  aria-checked={setup.mode === m.value}
                  onClick={() => update({ mode: m.value })}
                  className={`rounded-full border px-3.5 py-1 transition ${
                    setup.mode === m.value
                      ? 'border-parchment bg-parchment/10 text-parchment'
                      : 'border-line text-parchment/60 hover:border-parchment/50 hover:text-parchment'
                  }`}
                >
                  {t(m.label)}
                </button>
              ))}
            </div>
            <p className="text-xs text-parchment/50">{t(MODES.find((m) => m.value === setup.mode)?.hint ?? '')}</p>
          </div>

          {isPool ? (
            <div className="space-y-5">
              <ol className="space-y-3 rounded-lg border border-line bg-surface/60 p-5 text-sm text-parchment/80">
                {[
                  <>
                    {t('Each player adds the precons they own and their own decks to')}{' '}
                    <Link to="/minha-pool" className="text-gold hover:underline">
                      {t('My pool')}
                    </Link>
                    .
                  </>,
                  t('You create the room and send the link to the table.'),
                  t('Everyone joins on their own phone, with their own account, and the deal happens live for all.'),
                ].map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-parchment/5 font-display text-sm text-gold">
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>

              {user ? (
                <>
                  <RulesCard>
                    <RuleRow
                      stacked
                      label={t('Colors')}
                      hint={t(COLOR_RULES.find((r) => r.value === setup.colorRule)?.hint ?? '')}
                    >
                      <Segmented
                        label={t('Colors')}
                        value={setup.colorRule}
                        onChange={(colorRule) => update({ colorRule })}
                        options={COLOR_RULES.map((r) => ({ value: r.value, label: t(r.label) }))}
                      />
                    </RuleRow>
                    <BracketRule
                      stacked
                      maxBracket={setup.maxBracket}
                      balance={setup.bracketBalance}
                      onChange={(p) =>
                        update({
                          ...(p.maxBracket !== undefined && { maxBracket: p.maxBracket }),
                          ...(p.balance !== undefined && { bracketBalance: p.balance }),
                        })
                      }
                    />
                    <RuleRow
                      stacked
                      label={t('Repeats')}
                      hint={t('No one gets a deck they already got in earlier deals.')}
                    >
                      <Switch
                        label={t('No repeats')}
                        checked={setup.noRepeat}
                        onChange={(noRepeat) => update({ noRepeat })}
                      />
                    </RuleRow>
                  </RulesCard>
                  <button
                    type="button"
                    onClick={() => createRoom.mutate()}
                    disabled={createRoom.isPending}
                    className="w-full rounded-lg btn-ember px-6 py-4 font-display text-lg font-bold text-ink shadow-lg transition hover:brightness-110 disabled:opacity-50"
                  >
                    {createRoom.isPending ? t('Creating…') : t('Create deck pool room')}
                  </button>
                  {createRoom.isError && <p className="text-center text-sm text-red-400">{createRoom.error.message}</p>}
                </>
              ) : (
                <div className="space-y-3 rounded-lg border border-line bg-surface/60 p-5 text-center text-sm">
                  <p className="text-parchment/80">{t('Sign in to use the deck pool.')}</p>
                  <button
                    type="button"
                    onClick={() => openAuth('login')}
                    className="inline-block rounded-md btn-ember font-display text-xl tracking-wide px-5 py-2.5 text-ink hover:brightness-110"
                  >
                    {t('Sign in or create account')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="font-display text-sm tracking-wider text-parchment/60">{t('Players')}</span>
                <div role="radiogroup" aria-label={t('Number of players')} className="flex gap-2">
                  {PLAYER_OPTIONS.map((n) => (
                    <button
                      type="button"
                      key={n}
                      role="radio"
                      aria-checked={setup.players === n}
                      onClick={() => update({ players: n })}
                      className={`h-10 w-10 rounded-full border font-display text-xl transition ${
                        setup.players === n
                          ? 'border-gold bg-gold text-ink'
                          : 'border-line text-parchment/70 hover:border-parchment/50'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <fieldset className="space-y-1">
                <legend className="sr-only">{t("Who's playing? (optional)")}</legend>
                {names.map((name, i) => (
                  <div key={`${setup.mode}-${i}`} className="flex items-center gap-3">
                    <span className="w-5 font-display text-2xl text-gold">{i + 1}</span>
                    <input
                      value={name}
                      maxLength={40}
                      onChange={(e) => setName(i, e.target.value)}
                      placeholder={t('Player {n}', { n: i + 1 })}
                      aria-label={t('Player {n} name', { n: i + 1 })}
                      autoCapitalize="none"
                      className="w-full border-0 border-b border-line bg-transparent px-1 py-2.5 text-lg placeholder:text-parchment/30 focus:border-parchment focus:outline-none"
                    />
                  </div>
                ))}
                <p className="pt-1 text-xs text-parchment/45">{t('Names are optional.')}</p>
                {duplicate && <p className="text-sm text-amber-400">{t('Some names are repeated.')}</p>}
              </fieldset>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setShowFilters((v) => !v)}
                  className="flex w-full items-center justify-between border-y border-line py-2.5 text-sm text-parchment/75 transition hover:text-parchment"
                  aria-expanded={showFilters}
                >
                  <span className="font-display text-base tracking-wider">
                    {t('Deal rules')}
                    {activeFilters > 0 && (
                      <span className="ml-2 rounded-full bg-gold px-2 py-0.5 font-sans text-xs font-semibold normal-case tracking-normal text-ink">
                        {t(activeFilters === 1 ? '{n} rule on' : '{n} rules on', { n: activeFilters })}
                      </span>
                    )}
                  </span>
                  <svg
                    viewBox="0 0 20 20"
                    className={`h-4 w-4 transition-transform ${showFilters ? 'rotate-180' : ''}`}
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M5 7l5 6 5-6z" />
                  </svg>
                </button>

                {showFilters && (
                  <RulesCard>
                    <RuleRow
                      stacked
                      label={t('Colors')}
                      hint={t(COLOR_RULES.find((r) => r.value === setup.colorRule)?.hint ?? '')}
                    >
                      <Segmented
                        label={t('Colors')}
                        value={setup.colorRule}
                        onChange={(colorRule) => update({ colorRule })}
                        options={COLOR_RULES.map((r) => ({ value: r.value, label: t(r.label) }))}
                      />
                    </RuleRow>

                    <RuleRow stacked label={t('Era')}>
                      <Segmented
                        label={t('Era')}
                        value={
                          !setup.yearTo && ['', '2020', '2024'].includes(setup.yearFrom) ? setup.yearFrom : 'custom'
                        }
                        onChange={(yearFrom) => yearFrom !== 'custom' && update({ yearFrom, yearTo: '' })}
                        options={[
                          { value: '', label: t('Any') },
                          { value: '2020', label: '2020+' },
                          { value: '2024', label: '2024+' },
                        ]}
                      />
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <select
                          value={setup.yearFrom}
                          onChange={(e) => update({ yearFrom: e.target.value })}
                          aria-label={t('From year')}
                          className="rounded-md border border-line bg-ink px-2 py-2"
                        >
                          <option value="">{t('From: any')}</option>
                          {years.map((y) => (
                            <option key={y} value={y}>
                              {t('From: {year}', { year: y })}
                            </option>
                          ))}
                        </select>
                        <select
                          value={setup.yearTo}
                          onChange={(e) => update({ yearTo: e.target.value })}
                          aria-label={t('To year')}
                          className="rounded-md border border-line bg-ink px-2 py-2"
                        >
                          <option value="">{t('To: any')}</option>
                          {years.map((y) => (
                            <option key={y} value={y}>
                              {t('To: {year}', { year: y })}
                            </option>
                          ))}
                        </select>
                      </div>
                    </RuleRow>

                    <RuleRow stacked label={t('Set')}>
                      <Switch
                        label={t('All decks from the same set')}
                        checked={setup.sameEdition}
                        onChange={(sameEdition) => update({ sameEdition })}
                      />
                      <select
                        value={setup.edition}
                        onChange={(e) => update({ edition: e.target.value })}
                        aria-label={t('Specific set')}
                        className="w-full rounded-md border border-line bg-ink px-2 py-2 text-sm"
                      >
                        <option value="">{t('Any set')}</option>
                        {editions.data?.map((e) => (
                          <option key={e.code} value={e.code}>
                            {e.name} ({e.deck_count})
                          </option>
                        ))}
                      </select>
                    </RuleRow>

                    <BracketRule
                      stacked
                      maxBracket={setup.maxBracket}
                      balance={setup.bracketBalance}
                      onChange={(p) =>
                        update({
                          ...(p.maxBracket !== undefined && { maxBracket: p.maxBracket }),
                          ...(p.balance !== undefined && { bracketBalance: p.balance }),
                        })
                      }
                    />
                    <RuleRow
                      stacked
                      label={t('My decks')}
                      hint={
                        notEnoughMine ? (
                          <span className="text-amber-400">
                            {t('You need to mark at least {n} decks.', { n: setup.players })}
                          </span>
                        ) : (
                          <>
                            {t('Mark the decks you own in the')}{' '}
                            <Link to="/catalogo" className="text-gold/80 hover:underline">
                              {t('catalog')}
                            </Link>
                            .
                          </>
                        )
                      }
                    >
                      <Switch
                        label={t('Only my decks ({n})', { n: myDecks.slugs.length })}
                        checked={setup.onlyMine}
                        onChange={(onlyMine) => update({ onlyMine })}
                      />
                    </RuleRow>

                    <RuleRow
                      stacked
                      label={t('Repeats')}
                      hint={
                        user
                          ? t('No one gets a deck they already got in deals you created (matched by player name).')
                          : t('Sign in so the site remembers who already played each deck.')
                      }
                    >
                      <Switch
                        label={t('No repeats')}
                        checked={setup.noRepeat}
                        disabled={!user}
                        onChange={(noRepeat) => update({ noRepeat })}
                      />
                    </RuleRow>
                  </RulesCard>
                )}
              </div>

              <button
                type="submit"
                disabled={draw.isPending || duplicate || notEnoughMine}
                className="w-full rounded-md btn-ember px-6 py-3.5 font-display text-2xl font-bold tracking-wide text-ink transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
              >
                {draw.isPending ? t('Shuffling…') : t('Deal the decks')}
              </button>

              {draw.isError && <p className="text-center text-sm text-red-400">{draw.error.message}</p>}
            </>
          )}
        </form>

        <aside className="space-y-10">
          <LastDeal code={lastDeal} />

          <section className="space-y-4">
            <h2 className="border-b-2 border-parchment pb-1.5 font-display text-2xl text-parchment">
              {isPool ? t('Already have a room?') : t('Everyone on their own phone')}
            </h2>
            <p className="max-w-xl text-parchment/70">
              {isPool
                ? t('Enter the code the host sent you.')
                : t(
                    'Create a room, send the link to the table and everyone watches the deal live. Each player copies their own deck.',
                  )}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              {!isPool && (
                <button
                  type="button"
                  onClick={() => createRoom.mutate()}
                  disabled={createRoom.isPending}
                  className="rounded-md border border-parchment/50 px-5 py-2.5 font-display text-lg tracking-wide text-parchment transition hover:bg-parchment/10 disabled:opacity-50"
                >
                  {createRoom.isPending ? t('Creating…') : t('Create online room')}
                </button>
              )}
              <form
                className="flex flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const code = roomCode.trim().toLowerCase()
                  if (code) navigate(`/sala/${code}`)
                }}
              >
                <input
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  placeholder={t('Room code')}
                  aria-label={t('Room code')}
                  maxLength={12}
                  autoCapitalize="none"
                  className="min-w-0 flex-1 rounded-md border border-line bg-transparent px-4 py-2.5 uppercase tracking-widest placeholder:normal-case placeholder:tracking-normal placeholder:text-parchment/30 focus:border-parchment focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-md border border-line px-4 py-2.5 text-sm font-semibold text-parchment/80 hover:border-parchment/50"
                >
                  {t('Join')}
                </button>
              </form>
            </div>
            {!isPool && createRoom.isError && <p className="text-sm text-red-400">{createRoom.error.message}</p>}
          </section>
        </aside>
      </div>
    </>
  )
}
