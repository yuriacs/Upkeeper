import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { CardModal, HoverPreview } from '../components/CardPreview'
import { EditionBadge } from '../components/DeckTile'
import { BracketBadge, BracketPanel, PowerBadge } from '../components/Bracket'
import { PriceBadge, PricePanel } from '../components/Price'
import DeckAnalysis from '../components/DeckAnalysis'
import DeckStats from '../components/DeckStats'
import DeckMatchups from '../components/DeckMatchups'
import Trophy from '../components/Trophy'
import ExportMenu from '../components/ExportMenu'
import { ColorIdentity, ManaCost } from '../components/Mana'
import OwnedToggle from '../components/OwnedToggle'
import ReportImageButton from '../components/ReportImageButton'
import { withArts } from '../lib/cardArts'
import { isUploadedImage } from '../lib/moderation'
import { api, ApiError } from '../lib/api'
import LoadError from '../components/LoadError'
import { useAuth } from '../lib/auth'
import { displayName } from '../lib/cardName'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/money'
import type { Card, DeckCard } from '../lib/types'
import { useTitle } from '../hooks/useTitle'

type View = 'list' | 'images'

const canHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches

// Esmaece a arte nas bordas (embaixo e dos lados) para ela se dissolver no fundo
const FADE = 'linear-gradient(to bottom, #000 35%, transparent), linear-gradient(to right, transparent, #000 15%, #000 85%, transparent)'
const FADE_EDGES = {
  maskImage: FADE,
  maskComposite: 'intersect',
  WebkitMaskImage: FADE,
  WebkitMaskComposite: 'source-in',
} as const

export default function DeckPage({ kind = 'precon' }: { kind?: 'precon' | 'user' }) {
  const { t, locale } = useI18n()
  const { slug = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const importWarnings = (location.state as { warnings?: string[] } | null)?.warnings ?? []
  const queryClient = useQueryClient()
  const deck = useQuery({
    queryKey: ['deck', kind, slug],
    queryFn: () => (kind === 'user' ? api.userDeck(slug) : api.deck(slug)),
    staleTime: 5 * 60_000, // a lista de cartas quase nunca muda
    select: withArts, // decks montados: cartas com arte personalizada aparecem com ela
  })
  useTitle(deck.data?.name ?? t('Deck'))
  const remove = useMutation({
    mutationFn: () => api.deleteMyDeck(slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate('/my-pool')
    },
  })

  const [view, setView] = useState<View>('list')
  const [hover, setHover] = useState<{ card: Card; x: number; y: number } | null>(null)
  const [modal, setModal] = useState<Card | null>(null)
  const closeModal = useCallback(() => setModal(null), [])

  const hoverHandlers = (card: Card) => ({
    onMouseMove: (e: MouseEvent) => canHover() && setHover({ card, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setHover(null),
    onClick: () => {
      setHover(null)
      setModal(card)
    },
  })

  if (deck.isPending) return <p className="text-parchment/60">{t('Loading deck…')}</p>
  if (deck.isError)
    return (
      <div className="space-y-4 text-center">
        {deck.error instanceof ApiError && deck.error.status === 404 ? (
          <p className="text-red-400">{t('Deck not found.')}</p>
        ) : (
          <LoadError error={deck.error} onRetry={() => deck.refetch()} retrying={deck.isFetching} />
        )}
        <Link to="/catalog" className="text-gold hover:underline">
          {t('Back to catalog')}
        </Link>
      </div>
    )

  const d = deck.data
  const renderRow = ({ quantity, card }: DeckCard) => (
    <li key={card.scryfall_id}>
      <button
        {...hoverHandlers(card)}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-parchment/5 focus-visible:outline-1 focus-visible:outline-gold"
      >
        <span className="w-5 shrink-0 text-right text-parchment/50">{quantity}</span>
        <span className="min-w-0 flex-1 truncate">{card.name}</span>
        <ManaCost cost={card.mana_cost} className="shrink-0" />
        {/* Preço de uma cópia no Scryfall (básicos quase sempre sem preço) */}
        <span className="w-14 shrink-0 text-right text-xs text-parchment/45 tabular-nums">
          {money(card.price_usd, 'USD', locale)}
        </span>
      </button>
    </li>
  )

  const renderImage = ({ quantity, card }: DeckCard) => (
    <button
      key={card.scryfall_id}
      onClick={() => setModal(card)}
      className="relative overflow-hidden rounded-[4.75%] transition hover:-translate-y-1 hover:shadow-xl hover:shadow-black focus-visible:outline-2 focus-visible:outline-gold"
      title={card.name}
    >
      {card.image_small || card.image_normal ? (
        <img src={card.image_normal || card.image_small} alt={card.name} loading="lazy" className="w-full" />
      ) : (
        <div className="aspect-[63/88] bg-surface p-2 text-xs">{card.name}</div>
      )}
      {quantity > 1 && (
        <span className="absolute right-2 top-2 rounded-full bg-ink/90 px-2 py-0.5 text-xs font-bold text-gold">
          ×{quantity}
        </span>
      )}
      {money(card.price_usd, 'USD', locale) && (
        <span className="absolute bottom-2 left-2 rounded-full bg-ink/90 px-2 py-0.5 text-[0.7rem] text-parchment/80 tabular-nums">
          {money(card.price_usd, 'USD', locale)}
        </span>
      )}
    </button>
  )

  return (
    <article className="space-y-8">
      {/* Arte do comandante ao fundo do topo, como na página inicial */}
      <div className="relative isolate -mx-4 -mt-10 space-y-6 overflow-hidden px-4 pt-8 pb-6 sm:-mx-6 sm:px-6">
        {d.face_commander?.image_art_crop && (
          <img
            src={d.face_commander.image_art_crop}
            alt=""
            className="absolute inset-0 -z-20 h-full w-full object-cover object-[center_25%] opacity-45"
            style={FADE_EDGES}
          />
        )}
        <div className="absolute inset-0 -z-10 bg-ink/40" />
        {kind === 'user' ? (
          <Link to="/my-pool" className="text-sm text-parchment/60 hover:text-gold">
            {t('← Deck pool')}
          </Link>
        ) : (
          <Link to="/catalog" className="text-sm text-parchment/60 hover:text-gold">
            {t('← Catalog')}
          </Link>
        )}

        <header className="flex flex-col gap-6 sm:flex-row">
          <div className="flex shrink-0 justify-center gap-3">
            {d.commanders.map(({ card }) => (
              <button key={card.scryfall_id} onClick={() => setModal(card)} className="shrink-0">
                <img
                  src={card.image_normal}
                  alt={card.name}
                  className={`${d.commanders.length > 1 ? 'w-36 sm:w-40' : 'w-56'} rounded-[4.75%] shadow-2xl shadow-black transition hover:scale-[1.02]`}
                />
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <h1 className="font-display text-3xl text-parchment sm:text-4xl">{d.name}</h1>
            <p className="text-lg">{d.commanders.map((c) => displayName(c.card.name)).join(' & ')}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ColorIdentity colors={d.color_identity} className="text-xl" />
              {d.edition ? (
                <EditionBadge name={d.edition.name} icon={d.edition.icon_svg_uri} />
              ) : (
                <span className="text-sm text-parchment/60">{t("{owner}'s deck", { owner: d.owner ?? '' })}</span>
              )}
              <span className="text-sm text-parchment/50">{d.release_date?.slice(0, 4)}</span>
              <span className="text-sm text-parchment/50">
                {t(d.card_count === 1 ? '{n} card' : '{n} cards', { n: d.card_count })}
              </span>
              <BracketBadge bracket={d.bracket} className="!text-xs" />
              <PowerBadge power={d.power} className="!text-sm" />
              <PriceBadge usd={d.price?.usd ?? d.price_usd} className="!text-sm" />
            </div>
            {d.kind === 'precon' ? (
              <div>
                <OwnedToggle slug={d.slug} variant="full" />
              </div>
            ) : (
              user?.username === d.owner && (
                <div className="flex gap-2">
                  <Link
                    to={`/my-pool/build/${d.slug}`}
                    className="rounded-lg btn-ember px-3 py-1.5 text-sm font-semibold text-ink hover:brightness-110"
                  >
                    {t('Edit in the deckbuilder')}
                  </Link>
                  <Link
                    to={`/my-pool/deck/${d.slug}`}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm text-parchment/80 hover:border-parchment/40 hover:text-gold"
                  >
                    {t('Edit list')}
                  </Link>
                  <button
                    onClick={() => window.confirm(t('Delete the deck "{name}"?', { name: d.name })) && remove.mutate()}
                    disabled={remove.isPending}
                    className="rounded-lg border border-red-400/30 px-3 py-1.5 text-sm text-red-300/80 hover:border-red-400/60"
                  >
                    {t('Delete')}
                  </button>
                </div>
              )
            )}
            {importWarnings.map((w) => (
              <p key={w} className="text-sm text-amber-400">
                {w}
              </p>
            ))}
            {!d.is_active && (
              <p className="text-sm text-parchment/50">
                {t("This version isn't in the main deal, only in deals among your own decks.")}
              </p>
            )}
            {!!d.record?.games && (
              <p className="flex items-center gap-1.5 text-sm text-parchment/70">
                <Trophy className="size-4 text-gold" />
                {t('At tables on the site:')} <strong className="text-parchment">{d.record.wins}</strong>{' '}
                {t(
                  d.record.games === 1
                    ? d.record.wins === 1
                      ? 'win in {games} game ({pct}%)'
                      : 'wins in {games} game ({pct}%)'
                    : d.record.wins === 1
                      ? 'win in {games} games ({pct}%)'
                      : 'wins in {games} games ({pct}%)',
                  { games: d.record.games, pct: Math.round(d.record.win_rate * 100) },
                )}
              </p>
            )}
            {d.source_url && (
              <a
                href={d.source_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-parchment/50 underline-offset-4 hover:text-gold hover:underline"
              >
                {t('Official Wizards list ↗')}
              </a>
            )}
          </div>
        </header>
      </div>

      {d.analysis && (
        <DeckAnalysis
          analysis={d.analysis}
          bracket={d.bracket}
          onCard={(name) => {
            const all = [...d.commanders, ...d.sections.flatMap((s) => s.cards)]
            const found = all.find((dc) => dc.card.name === name || dc.card.name.split(' // ')[0] === name)
            if (found) setModal(found.card)
          }}
        />
      )}

      <BracketPanel bracket={d.bracket} details={d.bracket_details} />

      {d.price && (
        <PricePanel
          price={d.price}
          onCard={(name) => {
            const all = [...d.commanders, ...d.sections.flatMap((s) => s.cards)]
            const found = all.find((dc) => dc.card.name === name)
            if (found) setModal(found.card)
          }}
        />
      )}

      <DeckStats deck={d} />

      {!!d.record?.games && <DeckMatchups kind={kind} slug={slug} />}

      <div className="flex items-center justify-between border-b border-line pb-3">
        <h2 className="font-display text-xl text-parchment">Decklist</h2>
        <div className="flex items-center gap-2">
          <ExportMenu deck={d} />
          <div className="flex rounded-lg border border-line p-0.5 text-sm" role="tablist">
            {(['list', 'images'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 ${view === v ? 'bg-parchment/10 text-gold' : 'text-parchment/60 hover:text-parchment'}`}
              >
                {v === 'list' ? t('List') : t('Images')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === 'list' ? (
        <div className="gap-8 sm:columns-2 lg:columns-3">
          {d.sections.map((s) => (
            <section key={s.key} className="mb-6 break-inside-avoid">
              <h3 className="mb-1 flex justify-between px-2 text-sm font-semibold uppercase tracking-wide text-gold/80">
                <span>{s.label}</span>
                <span className="text-parchment/40">{s.count}</span>
              </h3>
              <ul>{s.cards.map(renderRow)}</ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {d.sections.map((s) => (
            <section key={s.key}>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gold/80">
                {s.label} <span className="text-parchment/40">({s.count})</span>
              </h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">{s.cards.map(renderImage)}</div>
            </section>
          ))}
        </div>
      )}

      <HoverPreview card={hover?.card ?? null} x={hover?.x ?? 0} y={hover?.y ?? 0} />
      <CardModal
        key={modal?.scryfall_id ?? 'none'}
        card={modal}
        onClose={closeModal}
        extra={
          // Arte personalizada do dono do deck: quem vê pode denunciar
          user && user.username !== d.owner && isUploadedImage(modal?.image_normal) ? (
            <ReportImageButton url={modal.image_normal} />
          ) : undefined
        }
      />
    </article>
  )
}
