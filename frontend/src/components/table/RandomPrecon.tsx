import { Dices, ExternalLink, Play } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useArts } from '../../hooks/useArts'
import { api, ApiError } from '../../lib/api'
import { displayName } from '../../lib/cardName'
import { COLOR_NAMES } from '../../lib/colors'
import { useI18n } from '../../lib/i18n'
import { money } from '../../lib/money'
import type { DeckSummary, TableRules } from '../../lib/types'
import { ColorIdentity } from '../Mana'
import Roulette from '../Roulette'

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const
const SPIN = 1600 // ms de roleta antes de mostrar o deck

/**
 * Aba "Sortear" da escolha do deck: um precon ao acaso dentro das regras da mesa, com as cores
 * que o jogador quiser (o deck tem pelo menos essas cores). Não repete os precons que já estão na
 * mesa nem os que já saíram nesta janela. Backend: GET /api/decks/random/.
 */
export default function RandomPrecon({
  rules,
  taken,
  onPick,
}: {
  rules?: TableRules
  /** Precons (slugs) que outros jogadores já estão usando na mesa */
  taken: string[]
  onPick: (slug: string) => void
}) {
  const { t, locale } = useI18n()
  const { arts } = useArts()
  const [colors, setColors] = useState<string[]>([])
  const [seen, setSeen] = useState<string[]>([])
  const [deck, setDeck] = useState<DeckSummary | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [spun, setSpun] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (c: string) => setColors((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))

  async function roll() {
    const exclude = [...new Set([...taken, ...seen, ...(deck ? [deck.slug] : [])])]
    setError(null)
    setDeck(null)
    setSpun(false)
    setSpinning(true)
    try {
      const res = await api.randomPrecon({
        bracket: rules?.bracket ?? null,
        price: rules?.price ?? null,
        tutors: rules?.tutors ?? null,
        colors: colors.join(''),
        exclude,
      })
      setDeck(res.deck)
      setSeen((cur) => [...cur, res.deck.slug])
    } catch (e) {
      setSpinning(false)
      setSpun(false)
      setError(
        e instanceof ApiError && e.status === 404
          ? seen.length
            ? t('No other precon fits these options. Try other colors.')
            : t('No precon fits these options. Try other colors.')
          : e instanceof Error
            ? e.message
            : t('Could not connect.'),
      )
    }
  }

  const revealed = deck && spun
  // Roleta girando, ou já parou e a resposta do servidor ainda não chegou
  const busy = !error && !revealed && (spinning || spun)
  const price = deck ? money(deck.price_usd, 'USD', locale, true) : null

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm text-parchment/70">{t('Let fate pick your deck: a random official precon that fits the table rules.')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs tracking-wide text-parchment/50 uppercase">{t('Must include')}</span>
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => toggle(c)}
            aria-pressed={colors.includes(c)}
            title={t(COLOR_NAMES[c])}
            className={`grid h-9 w-9 place-items-center rounded-full border transition ${
              colors.includes(c) ? 'border-gold bg-gold/15' : 'border-line opacity-50 hover:opacity-90'
            }`}
          >
            <i className={`ms ms-${c.toLowerCase()} ms-cost ms-shadow`} aria-hidden />
          </button>
        ))}
        {colors.length > 0 && (
          <button type="button" onClick={() => setColors([])} className="text-xs text-parchment/50 hover:text-gold">
            {t('Any colors')}
          </button>
        )}
      </div>

      <div className="grid items-center gap-4 sm:grid-cols-[12rem_1fr]">
        <div className="mx-auto w-48 sm:mx-0">
          {busy ? (
            <Roulette
              arts={arts}
              duration={SPIN}
              onDone={() => {
                setSpun(true)
              }}
            />
          ) : revealed && deck ? (
            <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-surface shadow-lg ring-1 ring-gold/40">
              {deck.face_commander?.image_art_crop && (
                <img src={deck.face_commander.image_art_crop} alt="" className="h-full w-full scale-110 object-cover" />
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={roll}
              className="grid aspect-[3/4] w-full place-items-center rounded-lg border border-dashed border-line bg-surface/40 text-parchment/40 transition hover:border-gold/60 hover:text-gold"
              aria-label={t('Draw a precon')}
            >
              <Dices className="h-12 w-12" aria-hidden />
            </button>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          {revealed && deck ? (
            <>
              <div>
                <p className="font-display text-3xl leading-tight text-parchment">{deck.name}</p>
                <p className="text-sm text-parchment/60">
                  {deck.face_commander ? displayName(deck.face_commander.name) : ''}
                  {deck.edition ? ` · ${deck.edition.name}` : ''}
                </p>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-parchment/60">
                  <ColorIdentity colors={deck.color_identity} />
                  {deck.bracket != null && <span>{t('Bracket {n}', { n: deck.bracket })}</span>}
                  {price && <span>{price}</span>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onPick(deck.slug)}
                  className="inline-flex items-center gap-2 rounded-md bg-gold px-4 py-2 font-semibold text-ink hover:brightness-110"
                >
                  <Play className="h-4 w-4" aria-hidden />
                  {t('Play this deck')}
                </button>
                <button
                  type="button"
                  onClick={roll}
                  className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-2 text-parchment/80 hover:border-gold/60 hover:text-gold"
                >
                  <Dices className="h-4 w-4" aria-hidden />
                  {t('Draw again')}
                </button>
                <Link
                  to={`/deck/${deck.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-2 text-sm text-parchment/50 hover:text-gold"
                >
                  {t('See the list')}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            </>
          ) : busy ? (
            <p className="font-display text-2xl text-parchment/60">{t('Shuffling…')}</p>
          ) : (
            <button
              type="button"
              onClick={roll}
              className="inline-flex items-center gap-2 rounded-md bg-gold px-5 py-2.5 font-semibold text-ink hover:brightness-110"
            >
              <Dices className="h-5 w-5" aria-hidden />
              {t('Draw a precon')}
            </button>
          )}
          {error && <p className="text-sm text-red-300/90">{error}</p>}
        </div>
      </div>
    </div>
  )
}
