import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { displayName } from '../lib/cardName'
import { deckPath } from '../lib/paths'
import type { DeckSummary } from '../lib/types'
import { BracketBadge, PowerBadge } from './Bracket'
import { ColorIdentity } from './Mana'
import OwnedToggle from './OwnedToggle'

export function EditionBadge({ name, icon }: { name: string; icon: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-parchment/60" title={name}>
      {icon && <img src={icon} alt="" className="h-3.5 w-3.5 shrink-0 invert opacity-70" loading="lazy" />}
      <span className="truncate">{name}</span>
    </span>
  )
}

/** Cor de cada mana (W, U, B, R, G e incolor) para os efeitos do card */
const MANA_HEX: Record<string, string> = {
  W: '#f6e7b0',
  U: '#3fa2ff',
  B: '#a070e0',
  R: '#ff5631',
  G: '#37c06a',
  C: '#b9b9c4',
}

/** Número "aleatório" estável para espalhar as partículas sempre do mesmo jeito */
const rand = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

const PARTICLES = 12

/** Efeito do card pelo tipo do comandante: a forma das partículas combina com a criatura */
type Theme = 'ember' | 'feather' | 'ghost' | 'blood' | 'rune' | 'leaf' | 'spark'
const THEMES: [RegExp, Theme][] = [
  [/\bVampire\b/, 'blood'],
  [/\b(Dragon|Phoenix|Hellion|Salamander)\b/, 'ember'],
  [/\b(Angel|Bird|Pegasus|Griffin|Sphinx|Archon)\b/, 'feather'],
  [/\b(Zombie|Spirit|Skeleton|Horror|Specter|Wraith|Shade|Demon|Nightmare)\b/, 'ghost'],
  [/\b(Elf|Dryad|Treefolk|Plant|Fungus|Druid|Dinosaur|Beast|Hydra)\b/, 'leaf'],
  [/\b(Artifact|Construct|Golem|Thopter|Spacecraft|Robot|Artificer)\b/, 'spark'],
  [/\b(Wizard|Sorcerer|Warlock|Shaman|Planeswalker|Cleric|Monk|Advisor)\b/, 'rune'],
]
const themeOf = (typeLine?: string): Theme | null => THEMES.find(([re]) => re.test(typeLine ?? ''))?.[1] ?? null
const RUNES = ['ᚠ', 'ᚱ', 'ᛟ', 'ᚦ', 'ᛉ', '✦', 'ᛗ', 'ᚨ']

/**
 * Efeitos do card: brilho na base e faixa de luz na borda nas cores do deck e, no hover,
 * partículas. A forma vem do tipo do comandante (brasas nos dragões, penas nos anjos, fumaça
 * nos mortos-vivos, gotas nos vampiros, runas nos magos, folhas na natureza, faíscas nos
 * artefatos); sem tipo conhecido, cada cor tem a sua (luz, bolhas, fumaça, brasas, folhas).
 */
function ManaAura({ identity, typeLine }: { identity: string; typeLine?: string }) {
  const colors = identity ? identity.split('').filter((c) => MANA_HEX[c]) : ['C']
  const hex = colors.map((c) => MANA_HEX[c])
  const ring = [...hex, hex[0]].join(', ')
  const theme = themeOf(typeLine)
  return (
    <>
      {/* Brilho na base, nas cores do deck */}
      <div
        aria-hidden
        className="mana-glow pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background: `radial-gradient(ellipse at 50% 120%, ${hex[0]}55, transparent 65%)${
            hex.length > 1 ? `, radial-gradient(ellipse at 90% 110%, ${hex[hex.length - 1]}40, transparent 55%)` : ''
          }`,
        }}
      />
      {/* Faixa de luz que corre pela borda */}
      <div aria-hidden className="mana-ring pointer-events-none absolute inset-0 rounded-lg" style={{ '--ring': ring } as CSSProperties} />
      {/* Partículas: forma pelo tipo do comandante, cor pelas cores do deck */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: PARTICLES }, (_, i) => {
          const c = colors[i % colors.length]
          return (
            <span
              key={i}
              className={`mana-p ${theme ? `fx-${theme}` : `mana-${c}`}`}
              style={
                {
                  left: `${6 + rand(i + 1) * 88}%`,
                  top: `${10 + rand(i + 31) * 80}%`,
                  '--c': theme === 'blood' ? '#b3122e' : MANA_HEX[c],
                  '--dx': `${(rand(i + 7) - 0.5) * 40}px`,
                  '--delay': `${rand(i + 13) * 1.6}s`,
                  '--dur': `${1.8 + rand(i + 19) * 1.4}s`,
                } as CSSProperties
              }
            >
              {theme === 'rune' ? RUNES[i % RUNES.length] : null}
            </span>
          )
        })}
      </div>
    </>
  )
}

/**
 * Card de deck guiado pela arte: a arte do comandante ocupa tudo e o texto fica por cima,
 * no rodapé escurecido. `label` (nome do jogador, num sorteio) aparece em destaque laranja.
 */
export default function DeckTile({
  deck,
  label,
  showOwned = true,
  index = 0,
}: {
  deck: DeckSummary
  label?: string
  showOwned?: boolean
  /** Posição na grade: escalona a entrada ao rolar */
  index?: number
}) {
  const t = useT()
  const art = deck.face_commander?.image_art_crop
  const sub = deck.edition
    ? [deck.edition.name, deck.release_date?.slice(0, 4)].filter(Boolean).join(' · ')
    : t("{owner}'s deck", { owner: deck.owner ?? '' })
  return (
    <Link
      to={deckPath(deck)}
      style={{ '--i': index % 4 } as CSSProperties}
      className="reveal group relative block aspect-[3/4] overflow-hidden rounded-lg bg-surface shadow-lg shadow-black/50 ring-1 ring-white/5 transition duration-300 hover:-translate-y-1 hover:ring-transparent focus-visible:outline-2 focus-visible:outline-gold"
    >
      {art ? (
        <img
          src={art}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-parchment/10 to-transparent" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent via-35% to-black/90" />
      <ManaAura identity={deck.color_identity} typeLine={deck.face_commander?.type_line} />

      <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
        {!deck.is_active && !label ? (
          <span className="rounded bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-parchment/70">
            {t('not in the main deal')}
          </span>
        ) : (
          <span />
        )}
        {showOwned && deck.kind !== 'user' && <OwnedToggle slug={deck.slug} />}
      </div>

      <div className="absolute inset-x-3 bottom-3 space-y-1">
        {label && <p className="truncate font-display text-base tracking-wide text-gold">{label}</p>}
        <h3 className="font-display text-xl text-parchment drop-shadow sm:text-2xl-[0_1px_6px_rgba(0,0,0,0.8)]">
          {deck.name}
        </h3>
        {deck.face_commander && (
          <p className="truncate text-sm text-parchment/75">{displayName(deck.face_commander.name)}</p>
        )}
        <div className="flex items-center gap-2 pt-1 text-xs text-parchment/70">
          <ColorIdentity colors={deck.color_identity} className="shrink-0 text-sm" />
          <BracketBadge bracket={deck.bracket} />
          <PowerBadge power={deck.power} />
          {!label && <span className="ml-auto hidden truncate text-parchment/55 sm:inline">{sub}</span>}
        </div>
      </div>
    </Link>
  )
}
