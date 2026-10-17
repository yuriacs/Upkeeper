import {
  ArrowRight,
  Crown,
  Dices,
  Eye,
  Heart,
  Layers,
  Library,
  MessageSquare,
  Search,
  Share2,
  Sparkles,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { HOME_ART } from '@/lib/homeArt'
import { useT } from '@/lib/i18n'

/** Título de seção no estilo do lançador: sobrelinha dourada, Cinzel e um fio com losango */
export function SectionHeading({
  id,
  eyebrow,
  title,
  note,
}: {
  id?: string
  eyebrow?: string
  title: string
  note?: ReactNode
}) {
  return (
    <div className="reveal flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div>
        {eyebrow && <p className="text-[0.7rem] font-semibold tracking-[0.3em] text-gold uppercase">{eyebrow}</p>}
        <h2 id={id} className="font-epic mt-1.5 scroll-mt-24 text-2xl font-semibold tracking-wide text-parchment sm:text-3xl">
          {title}
        </h2>
        <span aria-hidden className="mt-3 flex items-center gap-2">
          <span className="h-px w-12 bg-gradient-to-r from-gold to-gold/0" />
          <span className="h-1.5 w-1.5 rotate-45 border border-gold/70" />
        </span>
      </div>
      {note && <div className="text-xs text-parchment/50">{note}</div>}
    </div>
  )
}

/** Faixa de números (status das mesas), logo acima da lista */
export function PlayStats({ items }: { items: [string, number | undefined][] }) {
  return (
    <dl className="grid grid-cols-2 border-y border-parchment/10 lg:grid-cols-4">
      {items.map(([label, value], i) => (
        <div
          key={label}
          style={{ '--i': i } as CSSProperties}
          className={`reveal flex flex-col items-center gap-1 px-4 py-6 text-center ${
            i % 2 ? 'border-l border-parchment/10' : i ? 'lg:border-l lg:border-parchment/10' : ''
          } ${i > 1 ? 'border-t border-parchment/10 lg:border-t-0' : ''}`}
        >
          <dd className="font-epic text-metal text-3xl font-bold tabular-nums sm:text-4xl">
            {value === undefined ? '—' : value.toLocaleString()}
          </dd>
          <dt className="text-[0.7rem] font-semibold tracking-[0.2em] text-parchment/55 uppercase">{label}</dt>
        </div>
      ))}
    </dl>
  )
}

/** Duas faixas de arte de comandantes correndo em sentidos opostos (param no hover) */
function ArtMarquee() {
  const t = useT()
  const items = HOME_ART
  if (items.length < 8) return null
  // Metade das artes em cada faixa; repetidas para o laço não ter emenda
  const half = Math.min(14, Math.floor(items.length / 2))
  const rows = [items.slice(0, half), items.slice(half, half * 2)]
  return (
    <section aria-label={t('Commander art')} className="reveal -mx-5 space-y-4 sm:-mx-8 lg:-mx-16">
      {rows.map((row, r) => (
        <div key={r} className="marquee-wrap overflow-hidden">
          <ul
            className={`marquee flex w-max gap-4 ${r ? 'marquee-reverse' : ''}`}
            style={{ '--speed': `${row.length * 6}s` } as CSSProperties}
          >
            {[...row, ...row].map((it, i) => (
              <li
                key={i}
                aria-hidden={i >= row.length}
                className="group relative h-36 w-56 shrink-0 overflow-hidden rounded-md border border-parchment/10 sm:h-44 sm:w-72"
              >
                <img
                  src={it.art}
                  alt=""
                  loading="lazy"
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                  className="h-full w-full object-cover opacity-70 grayscale-[25%] transition duration-500 group-hover:scale-105 group-hover:opacity-100 group-hover:grayscale-0"
                />
                <span className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/90 to-transparent px-3 pt-6 pb-2 text-xs font-semibold text-parchment transition group-hover:translate-y-0">
                  {it.commander}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/** Faixa larga com uma arte em parallax e uma frase de efeito */
function ParallaxBanner({ onNewTable }: { onNewTable: () => void }) {
  const t = useT()
  const items = HOME_ART
  const [pick] = useState(() => Math.random())
  const it = items.length ? items[Math.floor(pick * items.length)] : null
  return (
    <section className="relative isolate -mx-5 overflow-hidden sm:-mx-8 lg:-mx-16">
      {/* A arte do Scryfall tem ~626 px: fica à direita, perto do tamanho original, e se dissolve no preto */}
      {it && (
        <div className="banner-art absolute inset-y-0 right-0 -z-10 w-full overflow-hidden sm:w-[65%] lg:max-w-[780px]">
          <img
            src={it.art}
            alt=""
            loading="lazy"
            onError={(e) => (e.currentTarget.style.display = 'none')}
            className="parallax h-full w-full object-cover opacity-75"
          />
        </div>
      )}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink via-ink/60 to-transparent sm:via-ink/0" />
      <div className="launcher-title px-5 py-28 sm:px-8 lg:px-16 lg:py-36">
        <p className="reveal text-[0.7rem] font-semibold tracking-[0.35em] text-gold uppercase">{t('Gather your playgroup')}</p>
        <p
          style={{ '--i': 1 } as CSSProperties}
          className="reveal font-epic mt-4 max-w-2xl text-4xl leading-tight font-semibold text-parchment uppercase sm:text-5xl"
        >
          {t('Shuffle up and play')}
        </p>
        <p style={{ '--i': 2 } as CSSProperties} className="reveal mt-4 max-w-lg text-parchment/70">
          {t('Every official precon is ready to sit at your table. Send one link and the game begins.')}
        </p>
        <button
          type="button"
          onClick={onNewTable}
          style={{ '--i': 3 } as CSSProperties}
          className="reveal btn-fire mt-8 h-12 rounded-md px-6 font-display text-xl tracking-wide"
        >
          {t('Open a new table')}
        </button>
      </div>
      {it && (
        <p className="absolute right-5 bottom-3 text-[0.7rem] text-parchment/40 sm:right-8 lg:right-16">
          {t('Art: {name}', { name: it.commander })}
        </p>
      )}
    </section>
  )
}

/**
 * Parte de baixo da página Jogar: como funciona, o que tem na mesa, de onde vêm os decks e
 * um último convite para abrir uma mesa.
 */
export default function PlayGuide({ onNewTable }: { onNewTable: () => void }) {
  const t = useT()
  const items = HOME_ART
  const [seed] = useState(() => Math.floor(Math.random() * 1000))
  const art = (i: number) => (items.length ? items[(seed + i * 11) % items.length].art : null)

  // Cada passo tem a cor de uma mana (o medalhão brilha nela)
  const steps: {
    Icon: LucideIcon
    title: string
    text: string
    flavor: string
    cost: string[]
    light: string
  }[] = [
    {
      Icon: Share2,
      title: t('Open a table'),
      text: t('Get a code and send the link to your group (2 to 4 players).'),
      flavor: t('Every legend begins with an invitation.'),
      cost: ['1', 'u'],
      light: '#9cc9ec',
    },
    {
      Icon: Library,
      title: t('Pick your deck'),
      text: t('An official precon or a deck from your pool. Or deal the decks at random.'),
      flavor: t('Choose wisely. The table remembers.'),
      cost: ['2', 'g'],
      light: '#a8d9b4',
    },
    {
      Icon: Sparkles,
      title: t('Play'),
      text: t('Battlefield, hand, library, counters, tokens, undo and hotkeys, all in the browser.'),
      flavor: t('Shuffle up. The dragons are waiting.'),
      cost: ['3', 'r'],
      light: '#f0b39c',
    },
  ]

  const features: [LucideIcon, string, string][] = [
    [Heart, t('Life and counters'), t('Life totals and counters on any card, +1/+1 or any other kind.')],
    [Layers, t('Any token'), t('Search tokens by name (Soldier, Treasure…) and create them in one click.')],
    [Search, t('Library tools'), t('Search, scry, mill, reveal from the top and mulligan.')],
    [Dices, t('Dice and coin'), t('Roll dice and flip coins in front of everyone.')],
    [Crown, t('Board helpers'), t('Monarch, Initiative, The Ring, energy and more, tracked for you.')],
    [Undo2, t('Undo with approval'), t('Misclicked? Ask to undo and the table approves.')],
    [Eye, t('Spectators'), t('Full tables can be watched live.')],
    [MessageSquare, t('Chat and hotkeys'), t('Talk to the table and play almost everything from the keyboard.')],
  ]

  const decks: { to: string; eyebrow: string; title: string; text: string; cta: string }[] = [
    {
      to: '/catalogo',
      eyebrow: t('Catalog'),
      title: t('Official precons'),
      text: t('Every Commander precon, with the full list, colors and an estimated bracket.'),
      cta: t('Browse the catalog'),
    },
    {
      to: '/minha-pool',
      eyebrow: t('My pool'),
      title: t('Your own decks'),
      text: t('Mark the precons you own and paste your own decklists. Bring them to any table.'),
      cta: t('Build your pool'),
    },
    {
      to: '/sortear',
      eyebrow: t('Deal decks'),
      title: t('Who plays what tonight?'),
      text: t('Deal precons or your group’s decks at random, with color and bracket rules, then play here.'),
      cta: t('Deal decks →'),
    },
  ]

  return (
    <div className="space-y-24">
      {/* Como funciona: três passos ligados por um fio dourado, cada um num medalhão */}
      <section aria-labelledby="how-it-works">
        <SectionHeading id="how-it-works" eyebrow={t('Three steps')} title={t('How it works')} />
        <ol className="steps relative mt-14 grid gap-12 md:grid-cols-3 md:gap-8">
          {/* Fio que liga os passos (computador: horizontal; celular: vertical) */}
          <span aria-hidden className="steps-line" />
          {steps.map((step, i) => (
            <li
              key={step.title}
              style={{ '--i': i, '--tint': step.light } as CSSProperties}
              className="reveal step relative flex gap-5 md:flex-col md:items-center md:text-center"
            >
              <span className="step-medal">
                <step.Icon className="h-7 w-7" aria-hidden />
                <span className="step-num">{['I', 'II', 'III'][i]}</span>
              </span>
              <div className="min-w-0 pt-1 md:max-w-xs md:pt-0">
                <p className="flex items-center gap-2 text-[0.7rem] font-semibold tracking-[0.3em] text-gold uppercase md:justify-center">
                  {t('Step {n}', { n: i + 1 })}
                  <span className="flex gap-0.5 text-[0.7rem] tracking-normal" aria-hidden>
                    {step.cost.map((c, k) => (
                      <i key={k} className={`ms ms-${c} ms-cost`} />
                    ))}
                  </span>
                </p>
                <p className="font-epic mt-2 text-2xl font-semibold text-parchment">{step.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-parchment/65">{step.text}</p>
                <p className="mt-3 text-xs text-parchment/40 italic">{step.flavor}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <ArtMarquee />

      {/* O que tem na mesa */}
      <section aria-labelledby="at-the-table">
        <SectionHeading
          id="at-the-table"
          eyebrow={t('At the table')}
          title={t('Everything a Commander game needs')}
          note={t('Free, no install.')}
        />
        {/* O tabuleiro de verdade, numa moldura de tela */}
        <figure className="reveal mt-8 overflow-hidden rounded-xl border border-gold/20 bg-black shadow-[0_40px_90px_-30px_rgb(0_0_0/0.95),0_0_60px_-20px_rgb(236_185_63/0.25)]">
          <picture>
            <source media="(max-width: 640px)" srcSet="/img/board-sm.webp" />
            <img
              src="/img/board.webp"
              alt={t('The virtual table in the middle of a game: battlefield, commanders, life totals and the action log.')}
              loading="lazy"
              width={2400}
              height={1350}
              className="block h-auto w-full"
            />
          </picture>
        </figure>
        <ul className="mt-6 grid gap-px overflow-hidden rounded-lg border border-parchment/10 bg-parchment/10 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(([Icon, title, text], i) => (
            <li key={title} style={{ '--i': i % 4 } as CSSProperties} className="reveal group bg-ink p-6 transition hover:bg-[#100e0b]">
              <Icon className="h-5 w-5 text-gold transition group-hover:drop-shadow-[0_0_8px_rgb(236_185_63/0.8)]" aria-hidden />
              <p className="mt-4 font-semibold text-parchment">{title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-parchment/60">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <ParallaxBanner onNewTable={onNewTable} />

      {/* De onde vêm os decks */}
      <section aria-labelledby="your-decks">
        <SectionHeading id="your-decks" eyebrow={t('Your decks')} title={t('Bring any deck to the table')} />
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {decks.map((d, i) => {
            const image = art(i)
            return (
              <Link
                key={d.to}
                to={d.to}
                style={{ '--i': i } as CSSProperties}
                className="reveal group relative isolate flex min-h-72 flex-col justify-end overflow-hidden rounded-lg border border-parchment/10 p-6 transition hover:border-gold/60 hover:shadow-[0_0_40px_-10px_rgb(236_185_63/0.45)]"
              >
                <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_30%,#3a2a12,#0b0b0d_70%)]" />
                {image && (
                  <img
                    src={image}
                    alt=""
                    loading="lazy"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                    className="absolute inset-0 -z-10 h-full w-full object-cover opacity-60 grayscale-[30%] transition duration-700 group-hover:scale-105 group-hover:opacity-80 group-hover:grayscale-0"
                  />
                )}
                <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black via-black/70 to-black/10" />
                <p className="text-[0.7rem] font-semibold tracking-[0.25em] text-gold uppercase">{d.eyebrow}</p>
                <p className="font-epic mt-2 text-2xl font-semibold text-parchment">{d.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-parchment/70">{d.text}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-gold">
                  {d.cta.replace(' →', '')}
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" aria-hidden />
                </span>
              </Link>
            )
          })}
        </div>
      </section>

      {/* Último convite */}
      <section className="reveal relative isolate overflow-hidden rounded-xl border border-gold/20 px-6 py-14 text-center">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_120%,rgb(236_185_63/0.22),transparent_60%),linear-gradient(180deg,#0d0b08,#09090b)]"
        />
        <p className="text-[0.7rem] font-semibold tracking-[0.3em] text-gold uppercase">{t('Commander online')}</p>
        <p className="font-epic mt-3 text-3xl font-semibold text-parchment sm:text-4xl">{t('Your table is waiting')}</p>
        <p className="mx-auto mt-3 max-w-lg text-parchment/65">
          {t('Open a table, send the link and play Commander with official precons or your own decks. No install.')}
        </p>
        <div className="group relative mx-auto mt-8 w-fit">
          <button type="button" onClick={onNewTable} className="play-plate is-square relative flex h-16 items-center overflow-hidden px-12">
            <span className="font-epic text-metal text-3xl font-bold tracking-wide whitespace-nowrap">
              {t('Start a game')}
            </span>
          </button>
          <span aria-hidden className="pointer-events-none absolute inset-0">
            {Array.from({ length: 12 }, (_, i) => (
              <span
                key={i}
                className="plate-ember"
                style={
                  {
                    left: `${10 + ((i * 37) % 80)}%`,
                    '--dx': `${((i * 23) % 40) - 20}px`,
                    '--size': `${2 + (i % 3)}px`,
                    '--dur': `${1.3 + (i % 4) * 0.25}s`,
                    '--delay': `${(i % 6) * 0.2}s`,
                  } as CSSProperties
                }
              />
            ))}
          </span>
        </div>
      </section>
    </div>
  )
}
