import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import HeroFan from '../components/HeroFan'
import BracketRule from '../components/BracketRule'
import { RuleRow, RulesCard, Segmented, Switch } from '../components/RuleControls'
import { useMyDecks } from '../hooks/useMyDecks'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
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
  useTitle(null)
  const t = useT()
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
    onSuccess: (result) => navigate(`/sorteio/${result.code}`, { state: { animate: true } }),
  })

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

  return (
    <section className="space-y-10">
      <div className="space-y-4 text-center">
        <HeroFan />
        <p className="text-xs uppercase tracking-[0.3em] text-gold/60">Commander · {t('2 to 4 players')}</p>
        <h1 className="font-display text-3xl text-balance text-gold sm:text-5xl">{t('Who plays what?')}</h1>
        <p className="mx-auto max-w-xl text-balance text-parchment/70">
          {t("Tell us who's at the table and let fate hand out the decks. No repeats, no arguments.")}
        </p>
      </div>

      <form
        className="mx-auto flex max-w-md flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          draw.mutate()
        }}
      >
        <div className="space-y-2">
          <div
            role="radiogroup"
            aria-label={t('Deal mode')}
            className="flex rounded-lg border border-gold/20 p-1 text-sm"
          >
            {MODES.map((m) => (
              <button
                type="button"
                key={m.value}
                role="radio"
                aria-checked={setup.mode === m.value}
                onClick={() => update({ mode: m.value })}
                className={`flex-1 rounded-md py-2 transition ${
                  setup.mode === m.value ? 'bg-gold/20 text-gold' : 'text-parchment/60 hover:text-parchment'
                }`}
              >
                {t(m.label)}
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-parchment/50">{t(MODES.find((m) => m.value === setup.mode)?.hint ?? '')}</p>
        </div>

        {isPool ? (
          <div className="space-y-5">
            <ol className="space-y-3 rounded-xl border border-gold/15 bg-surface/60 p-5 text-sm text-parchment/80">
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
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold/15 font-display text-sm text-gold">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>

            {user ? (
              <>
                <RulesCard>
                  <RuleRow stacked label={t('Colors')} hint={t(COLOR_RULES.find((r) => r.value === setup.colorRule)?.hint ?? '')}>
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
                  className="w-full rounded-lg bg-gold px-6 py-4 font-display text-lg font-bold text-ink shadow-lg shadow-gold/20 transition hover:brightness-110 disabled:opacity-50"
                >
                  {createRoom.isPending ? t('Creating…') : t('Create deck pool room')}
                </button>
                {createRoom.isError && <p className="text-center text-sm text-red-400">{createRoom.error.message}</p>}
              </>
            ) : (
              <div className="space-y-3 rounded-xl border border-gold/20 bg-surface/60 p-5 text-center text-sm">
                <p className="text-parchment/80">{t('Sign in to use the deck pool.')}</p>
                <Link
                  to="/entrar"
                  state={{ next: '/' }}
                  className="inline-block rounded-lg bg-gold px-5 py-2.5 font-semibold text-ink hover:brightness-110"
                >
                  {t('Sign in or create account')}
                </Link>
              </div>
            )}
          </div>
        ) : (
          <>
            <div role="radiogroup" aria-label={t('Number of players')} className="flex w-full gap-2">
              {PLAYER_OPTIONS.map((n) => (
                <button
                  type="button"
                  key={n}
                  role="radio"
                  aria-checked={setup.players === n}
                  onClick={() => update({ players: n })}
                  className={`flex-1 rounded-lg border py-3 text-center transition ${
                    setup.players === n
                      ? 'border-gold bg-gold/15 text-gold'
                      : 'border-gold/20 text-parchment/70 hover:border-gold/50'
                  }`}
                >
                  <span className="block font-display text-2xl">{n}</span>
                  <span className="text-xs">{t('players')}</span>
                </button>
              ))}
            </div>

            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm text-parchment/60">{t("Who's playing? (optional)")}</legend>
              {names.map((name, i) => (
                <div key={`${setup.mode}-${i}`} className="flex items-center gap-3">
                  <span className="w-5 text-right font-display text-gold/70">{i + 1}</span>
                  <input
                    value={name}
                    maxLength={40}
                    onChange={(e) => setName(i, e.target.value)}
                    placeholder={t('Player {n}', { n: i + 1 })}
                    aria-label={t('Player {n} name', { n: i + 1 })}
                    autoCapitalize="none"
                    className="w-full rounded-lg border border-gold/20 bg-ink px-4 py-2.5 placeholder:text-parchment/30 focus:border-gold focus:outline-none"
                  />
                </div>
              ))}
              {duplicate && <p className="text-sm text-amber-400">{t('Some names are repeated.')}</p>}
            </fieldset>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg border border-gold/15 px-4 py-2.5 text-sm text-parchment/70 transition hover:border-gold/40 hover:text-gold"
                aria-expanded={showFilters}
              >
                <span>
                  {t('Deal rules')}
                  {activeFilters > 0 && (
                    <span className="ml-2 rounded-full bg-gold/15 px-2 py-0.5 text-xs text-gold">
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
                  <RuleRow stacked label={t('Colors')} hint={t(COLOR_RULES.find((r) => r.value === setup.colorRule)?.hint ?? '')}>
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
                      value={!setup.yearTo && ['', '2020', '2024'].includes(setup.yearFrom) ? setup.yearFrom : 'custom'}
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
                        className="rounded-md border border-gold/20 bg-ink px-2 py-2"
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
                        className="rounded-md border border-gold/20 bg-ink px-2 py-2"
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
                      className="w-full rounded-md border border-gold/20 bg-ink px-2 py-2 text-sm"
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
                        <span className="text-amber-400">{t('You need to mark at least {n} decks.', { n: setup.players })}</span>
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
              className="w-full rounded-lg bg-gold px-6 py-4 font-display text-lg font-bold text-ink shadow-lg shadow-gold/20 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
            >
              {draw.isPending ? t('Shuffling…') : t('Deal decks')}
            </button>

            {draw.isError && <p className="text-center text-sm text-red-400">{draw.error.message}</p>}
          </>
        )}
      </form>

      <div className="mx-auto max-w-md space-y-4 rounded-xl border border-gold/15 bg-surface/40 p-5">
        <div className="space-y-1 text-center">
          <h2 className="font-display text-xl text-gold">{isPool ? t('Already have a room?') : t('Everyone on their own phone')}</h2>
          <p className="text-sm text-parchment/60">
            {isPool
              ? t('Enter the code the host sent you.')
              : t('Create a room, send the link to the table and everyone watches the deal live. Each player copies their own deck.')}
          </p>
        </div>
        {!isPool && (
          <>
            <button
              type="button"
              onClick={() => createRoom.mutate()}
              disabled={createRoom.isPending}
              className="w-full rounded-lg border border-gold/50 px-5 py-3 font-semibold text-gold transition hover:bg-gold/10 disabled:opacity-50"
            >
              {createRoom.isPending ? t('Creating…') : t('Create online room')}
            </button>
            {createRoom.isError && <p className="text-center text-sm text-red-400">{createRoom.error.message}</p>}
          </>
        )}
        <form
          className="flex gap-2"
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
            className="min-w-0 flex-1 rounded-lg border border-gold/20 bg-ink px-4 py-2.5 uppercase tracking-widest placeholder:normal-case placeholder:tracking-normal placeholder:text-parchment/30 focus:border-gold focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg border border-parchment/20 px-4 py-2.5 text-sm text-parchment/80 hover:border-parchment/40"
          >
            {t('Join')}
          </button>
        </form>
      </div>
    </section>
  )
}
