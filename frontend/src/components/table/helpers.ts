/*
 * Cartas de ajuda da mesa (como os "board helpers" do untap): Monarca, Iniciativa, O Anel,
 * Dia/Noite, Bênção da Cidade e as que guardam marcadores do jogador (energia, radiação,
 * experiência, velocidade), além das masmorras. As imagens vêm do Scryfall.
 *
 * `name` é o nome que vai para a mesa (o servidor trata "The Monarch", "The Initiative" e
 * "Day // Night" como únicas: quem cria pega para si). `counter` é o marcador que a carta guarda.
 */
import {
  Castle,
  CircleDot,
  Crown,
  DoorOpen,
  Gauge,
  Radiation,
  Sparkle,
  Star,
  SunMoon,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export type Helper = {
  key: string
  name: string
  /** Nome exato no Scryfall */
  scryfall: string
  icon: LucideIcon
  counter?: string
  /** Começa pelo verso (Iniciativa: a frente é a masmorra Undercity) */
  swap?: boolean
  group: 'designation' | 'counter' | 'dungeon'
}

export const HELPERS: Helper[] = [
  { key: 'monarch', name: 'The Monarch', scryfall: 'The Monarch', icon: Crown, group: 'designation' },
  {
    key: 'initiative',
    name: 'The Initiative',
    scryfall: 'Undercity // The Initiative',
    icon: DoorOpen,
    swap: true,
    group: 'designation',
  },
  {
    key: 'ring',
    name: 'The Ring',
    scryfall: 'The Ring // The Ring Tempts You',
    icon: CircleDot,
    counter: 'Tempted',
    group: 'designation',
  },
  { key: 'daynight', name: 'Day // Night', scryfall: 'Day // Night', icon: SunMoon, group: 'designation' },
  { key: 'blessing', name: "City's Blessing", scryfall: "City's Blessing", icon: Sparkle, group: 'designation' },
  { key: 'energy', name: 'Energy', scryfall: 'Energy Reserve', icon: Zap, counter: 'Energy', group: 'counter' },
  { key: 'rad', name: 'Radiation', scryfall: 'Radiation', icon: Radiation, counter: 'Rad', group: 'counter' },
  { key: 'xp', name: 'Experience', scryfall: 'Experience', icon: Star, counter: 'Experience', group: 'counter' },
  {
    key: 'speed',
    name: 'Speed',
    scryfall: 'Start Your Engines! // Max Speed',
    icon: Gauge,
    counter: 'Speed',
    group: 'counter',
  },
  { key: 'tomb', name: 'Tomb of Annihilation', scryfall: 'Tomb of Annihilation', icon: Castle, group: 'dungeon' },
  { key: 'mine', name: 'Lost Mine of Phandelver', scryfall: 'Lost Mine of Phandelver', icon: Castle, group: 'dungeon' },
  {
    key: 'madmage',
    name: 'Dungeon of the Mad Mage',
    scryfall: 'Dungeon of the Mad Mage',
    icon: Castle,
    group: 'dungeon',
  },
]

export const helperByName = (name: string) => HELPERS.find((h) => h.name === name)

/** Nome da carta de ajuda no idioma de quem lê */
export const helperLabel = (t: (s: string) => string, key: string) =>
  ({
    monarch: t('The Monarch'),
    initiative: t('The Initiative'),
    ring: t('The Ring'),
    daynight: t('Day / Night'),
    blessing: t('City’s Blessing'),
    energy: t('Energy'),
    rad: t('Radiation'),
    xp: t('Experience'),
    speed: t('Speed'),
    tomb: t('Tomb of Annihilation'),
    mine: t('Lost Mine of Phandelver'),
    madmage: t('Dungeon of the Mad Mage'),
  })[key] ?? key

/** Frente e verso de cada carta de ajuda (uma busca só no Scryfall, guardada para a sessão) */
export type HelperImages = Record<string, { image: string; back: string }>
let cache: Promise<HelperImages> | null = null

type ScryFace = { image_uris?: { normal: string } }
type ScryCard = { name: string; image_uris?: { normal: string }; card_faces?: ScryFace[] }

export function loadHelperImages(): Promise<HelperImages> {
  if (cache) return cache
  const q = `(${HELPERS.map((h) => `!"${h.scryfall}"`).join(' or ')}) include:extras`
  cache = fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=cards`, {
    headers: { Accept: 'application/json' },
  })
    .then((r) => (r.ok ? r.json() : { data: [] }))
    .then((d: { data?: ScryCard[] }) => {
      const out: HelperImages = {}
      for (const h of HELPERS) {
        const c = (d.data ?? []).find((card) => card.name === h.scryfall)
        if (!c) continue
        const front = c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal ?? ''
        const back = c.card_faces?.[1]?.image_uris?.normal ?? ''
        if (front) out[h.key] = h.swap && back ? { image: back, back: front } : { image: front, back }
      }
      return out
    })
    .catch(() => {
      cache = null // tenta de novo na próxima vez
      return {}
    })
  return cache
}
