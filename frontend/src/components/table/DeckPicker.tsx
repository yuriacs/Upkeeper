import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useDebounce } from '../../hooks/useDebounce'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { displayName } from '../../lib/cardName'
import { useI18n } from '../../lib/i18n'
import { deckRuleIssue, hasRules, ruleChips } from '../../lib/tableRules'
import RandomPrecon from './RandomPrecon'
import type { DealtDeck, TableDeck } from '../../hooks/useTableSocket'
import type { DeckSummary, TableRules } from '../../lib/types'

/**
 * Escolha do deck para a mesa: um deck do sorteio, um precon do catálogo, um precon sorteado na
 * hora (aba "Sortear", RandomPrecon) ou um deck da sua pool.
 * Mesa com regras (bracket, tutores, valor): os decks que já se sabe que não servem ficam apagados;
 * os tutores o servidor confere ao carregar.
 */
export default function DeckPicker({
  dealt,
  rules,
  taken = [],
  onPick,
  onClose,
}: {
  dealt: DealtDeck[]
  rules?: TableRules
  /** Precons (slugs) que os outros jogadores já estão usando: o sorteio não repete */
  taken?: string[]
  onPick: (d: Pick<TableDeck, 'kind' | 'ref'>) => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const { user } = useAuth()
  const [tab, setTab] = useState<'dealt' | 'precon' | 'random' | 'mine'>(dealt.length ? 'dealt' : 'precon')
  const [search, setSearch] = useState('')
  const q = useDebounce(search.trim(), 300)
  const precons = useQuery({
    queryKey: ['table-precons', q],
    queryFn: () => api.decks({ search: q, ordering: '-release_date' }, 1, 30),
    enabled: tab === 'precon',
  })
  const mine = useQuery({ queryKey: ['me', 'decks', user?.id], queryFn: api.myDecks, enabled: tab === 'mine' })

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const list: DeckSummary[] = (tab === 'precon' ? precons.data?.results : tab === 'mine' ? mine.data : []) ?? []
  const loading = tab === 'precon' ? precons.isLoading : mine.isLoading
  const tabClass = (active: boolean) =>
    `px-3 py-1 rounded-full text-sm transition ${active ? 'bg-parchment text-ink font-semibold' : 'text-parchment/60 hover:text-parchment'}`

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('Choose your deck')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-3xl flex-col rounded-xl border border-line bg-ink"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-2xl">{t('Choose your deck')}</h2>
          <div className="flex rounded-full border border-line p-0.5">
            {dealt.length > 0 && (
              <button className={tabClass(tab === 'dealt')} onClick={() => setTab('dealt')}>
                {t('Dealt decks')}
              </button>
            )}
            <button className={tabClass(tab === 'precon')} onClick={() => setTab('precon')}>
              {t('Precons')}
            </button>
            <button className={tabClass(tab === 'random')} onClick={() => setTab('random')}>
              {t('Random')}
            </button>
            <button className={tabClass(tab === 'mine')} onClick={() => setTab('mine')}>
              {t('My decks')}
            </button>
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-parchment/60 hover:text-gold"
            aria-label={t('Close')}
          >
            ✕
          </button>
        </div>
        {hasRules(rules) && (
          <p className="border-b border-line bg-gold/5 px-4 py-2 text-xs text-parchment/70">
            <span className="font-semibold text-gold">{t('Table rules:')}</span> {ruleChips(t, rules, locale).join(' · ')}
          </p>
        )}
        {tab === 'precon' && (
          <div className="px-4 pt-3">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('Search by deck or commander')}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 focus:border-gold focus:outline-none"
            />
          </div>
        )}
        {tab === 'random' && (
          <div className="overflow-y-auto">
            <RandomPrecon rules={rules} taken={taken} onPick={(slug) => onPick({ kind: 'precon', ref: slug })} />
          </div>
        )}
        {tab !== 'random' && (
        <ul className="grid gap-2 overflow-y-auto p-4 sm:grid-cols-2">
          {tab === 'dealt' &&
            dealt.map((d) => (
              <li key={d.position}>
                <button
                  onClick={() => onPick(d.deck)}
                  disabled={d.claimed}
                  className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface p-3 text-left transition enabled:hover:border-gold/60 disabled:opacity-40"
                >
                  <span className="font-display w-6 text-xl text-gold">{d.position}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{d.deck.name}</span>
                    <span className="block truncate text-xs text-parchment/50">
                      {d.player}
                      {d.claimed ? ` · ${t('already taken')}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          {tab !== 'dealt' && loading && <li className="text-sm text-parchment/50">{t('Loading…')}</li>}
          {tab !== 'dealt' && !loading && list.length === 0 && (
            <li className="text-sm text-parchment/50">
              {tab === 'mine' ? t('Your pool has no imported decks yet.') : t('No decks found.')}
            </li>
          )}
          {list.map((d) => {
            const issue = deckRuleIssue(t, rules, d, locale)
            return (
            <li key={`${d.kind}-${d.slug}`}>
              <button
                onClick={() => onPick({ kind: d.kind, ref: d.slug })}
                disabled={!!issue}
                title={issue ?? undefined}
                className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface p-2 text-left transition enabled:hover:border-gold/60 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {d.face_commander?.image_art_crop ? (
                  <img
                    src={d.face_commander.image_art_crop}
                    alt=""
                    className="h-12 w-16 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="h-12 w-16 shrink-0 rounded bg-parchment/5" />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{d.name}</span>
                  <span className="block truncate text-xs text-parchment/50">
                    {d.face_commander ? displayName(d.face_commander.name) : ''}
                    {d.edition ? ` · ${d.edition.name}` : ''}
                  </span>
                  {issue && <span className="block truncate text-xs text-red-300/80">{issue}</span>}
                </span>
              </button>
            </li>
            )
          })}
        </ul>
        )}
      </div>
    </div>
  )
}
