/*
 * Conquistas: nome, como ganhar e ícone de cada uma (o servidor diz quais a conta já tem e o
 * progresso). Usado no perfil público, no registro da mesa e no aviso de conquista nova.
 * As regras ficam no backend (achievements/catalog.py e accounts/profile.py).
 */
import {
  Award,
  BookX,
  Coffee,
  Crown,
  Dices,
  DoorOpen,
  Eye,
  Flame,
  Gem,
  Hammer,
  HandCoins,
  HeartPulse,
  Hourglass,
  Layers,
  Library,
  Map as MapIcon,
  Medal,
  Palette,
  Rabbit,
  Rainbow,
  RefreshCcw,
  Shuffle,
  Skull,
  Sparkles,
  Sunrise,
  Swords,
  Theater,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { AchievementKey } from './types'

type T = (s: string, v?: Record<string, string | number>) => string

export type AchievementInfo = { icon: LucideIcon; name: (t: T) => string; how: (t: T, n: number) => string }

export const ACHIEVEMENTS: Record<AchievementKey, AchievementInfo> = {
  first_game: { icon: Swords, name: (t) => t('First game'), how: (t) => t('Finish a game') },
  regular: { icon: Flame, name: (t) => t('Regular'), how: (t, n) => t('Finish {n} games', { n }) },
  veteran: { icon: Medal, name: (t) => t('Veteran'), how: (t, n) => t('Finish {n} games', { n }) },
  first_win: { icon: Trophy, name: (t) => t('First win'), how: (t) => t('Win a game') },
  champion: { icon: Crown, name: (t) => t('Champion'), how: (t, n) => t('Win {n} games', { n }) },
  legend: { icon: Award, name: (t) => t('Legend'), how: (t, n) => t('Win {n} games', { n }) },
  deckbuilders_pride: {
    icon: Hammer,
    name: (t) => t('Deckbuilder’s Pride'),
    how: (t) => t('Add your first deck to your deck pool'),
  },
  shuffle_up: { icon: Shuffle, name: (t) => t('Shuffle Up'), how: (t) => t('Make your first deal') },
  architect: { icon: Gem, name: (t) => t('Architect'), how: (t, n) => t('Have {n} decks of your own', { n }) },
  collector: { icon: Library, name: (t) => t('Collector'), how: (t, n) => t('Own {n} precons', { n }) },
  explorer: { icon: MapIcon, name: (t) => t('Explorer'), how: (t, n) => t('Play with {n} different commanders', { n }) },
  social: { icon: Users, name: (t) => t('Social'), how: (t, n) => t('Have {n} friends', { n }) },
  first_upkeep: { icon: DoorOpen, name: (t) => t('First Upkeep'), how: (t) => t('Sit down at a table for the first time') },
  mulligan_survivor: {
    icon: RefreshCcw,
    name: (t) => t('Mulligan Survivor'),
    how: (t) => t('Take a mulligan and still win the game'),
  },
  counter_hoarder: {
    icon: Layers,
    name: (t) => t('Counter Hoarder'),
    how: (t) => t('Have 20 or more counters on a single permanent'),
  },
  snake_eyes: { icon: Dices, name: (t) => t('Snake Eyes'), how: (t) => t('Roll a 1 on the d20 three times in a row') },
  marathon: { icon: Hourglass, name: (t) => t('Marathon'), how: (t) => t('Play a game that lasts more than 2 hours') },
  speedrun: { icon: Zap, name: (t) => t('Speedrun'), how: (t) => t('Win before your 6th turn') },
  comeback_kid: { icon: HeartPulse, name: (t) => t('Comeback Kid'), how: (t) => t('Win after dropping to 5 life or less') },
  color_pie: {
    icon: Palette,
    name: (t) => t('Color Pie'),
    how: (t) => t('Win with mono-colored commanders of all 5 colors'),
  },
  wubrg: { icon: Rainbow, name: () => 'WUBRG', how: (t) => t('Win with a five-color commander') },
  not_my_deck: { icon: HandCoins, name: (t) => t('Not My Deck'), how: (t) => t('Win with another player’s deck') },
  stolen_thunder: {
    icon: Skull,
    name: (t) => t('Stolen Thunder'),
    how: (t) => t('Beat the owner of the deck you are playing'),
  },
  playgroup: { icon: Coffee, name: (t) => t('Playgroup'), how: (t, n) => t('Play {n} games with the same 3 people', { n }) },
  open_table: { icon: Sparkles, name: (t) => t('Open Table'), how: (t, n) => t('Play with {n} different people', { n }) },
  host: { icon: Theater, name: (t) => t('Host'), how: (t, n) => t('Open {n} tables or deal rooms', { n }) },
  upkeeper: { icon: Sunrise, name: (t) => t('Upkeeper'), how: (t, n) => t('Draw a card on your own turn in {n} turns', { n }) },
  timmy: { icon: Rabbit, name: (t) => t('Timmy Moment'), how: (t) => t('Have 10 or more creatures on the battlefield at once') },
  library_empty: { icon: BookX, name: (t) => t('Library Empty'), how: (t) => t('Run out of cards to draw') },
  voyeur: { icon: Eye, name: (t) => t('Voyeur'), how: (t, n) => t('Spend {n} hours watching tables as a spectator', { n }) },
}

/** Nome da conquista pela chave (chave desconhecida, de uma versão nova do servidor: a própria chave) */
export const achievementName = (t: T, key: string): string =>
  key in ACHIEVEMENTS ? ACHIEVEMENTS[key as AchievementKey].name(t) : key
