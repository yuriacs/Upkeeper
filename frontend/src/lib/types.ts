export type Edition = {
  code: string
  name: string
  icon_svg_uri: string
  release_date?: string | null
  deck_count?: number
}

export type CommanderMini = {
  name: string
  mana_cost: string
  image_normal: string
  image_art_crop: string
}

export type DeckKind = 'precon' | 'user'

export type DeckSummary = {
  slug: string
  name: string
  edition: Edition | null
  release_date: string | null
  color_identity: string
  face_commander: CommanderMini | null
  is_active: boolean
  kind: DeckKind
  owner: string | null
}

export type Card = {
  scryfall_id: string
  name: string
  mana_cost: string
  cmc: string
  type_line: string
  oracle_text: string
  colors: string
  color_identity: string
  category: string
  rarity: string
  layout: string
  set_code: string
  collector_number: string
  image_normal: string
  image_small: string
  image_art_crop: string
  image_back: string
}

export type DeckCard = { quantity: number; card: Card }

export type DeckSection = { key: string; label: string; count: number; cards: DeckCard[] }

export type DeckDetail = DeckSummary & {
  source_url: string
  card_count: number
  commanders: DeckCard[]
  sections: DeckSection[]
  decklist_text?: string
  /** Só nos precons oficiais */
  record?: WinRecord
}

export type UserDeckSaved = DeckDetail & { warnings: string[] }

export type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] }

export type ColorRule = 'any' | 'distinct' | 'no_overlap'

export type DrawFilters = {
  year_from?: number
  year_to?: number
  editions?: string[]
  color_rule?: ColorRule
  same_edition?: boolean
  no_repeat?: boolean
  deck_slugs?: string[]
}

export type DrawEntry = { position: number; player_name: string; deck: DeckSummary | null; owner: string | null }

export type DrawMode = 'precon' | 'pool'

export type Draw = {
  code: string
  mode: DrawMode
  created_at: string
  players: number
  pool_size: number
  filters: DrawFilters
  entries: DrawEntry[]
  /** Posição (entry.position) de quem ganhou a partida; null = ainda não marcado */
  winner_position: number | null
  result_at: string | null
  can_set_result: boolean
  manage_token?: string
}

export type WinRecord = { games: number; wins: number; win_rate: number }

export type DeckRanking = WinRecord & { deck: DeckSummary }

export type GlobalStats = {
  min_games: number
  games: number
  draws: number
  most_wins: DeckRanking[]
  best_rate: DeckRanking[]
  unlucky: DeckRanking[]
  players: (WinRecord & { username: string })[]
}

export type ScoreRow = WinRecord & { name: string }

export type MyDraw = {
  code: string
  mode: DrawMode
  created_at: string
  position: number
  player_name: string
  deck: DeckSummary | null
  result: 'won' | 'lost' | null
  winner: string | null
  opponents: DrawEntry[]
}

export type MyStats = WinRecord & {
  draws: number
  most_received: { deck: DeckSummary; times: number }[]
  best_decks: DeckRanking[]
}

export type User = { id: number; username: string; email: string; is_admin?: boolean }

export type DayCount = { date: string; count: number }

export type AdminOverview = {
  days: number
  users: { total: number; new_7d: number; new_30d: number; active_30d: number; with_pool: number }
  content: {
    owned_precons: number
    imported_decks: number
    draws: number
    draws_7d: number
    room_draws: number
    games: number
    open_rooms: number
  }
  signups_by_day: DayCount[]
  draws_by_day: DayCount[]
  top_owned: { slug: string; name: string; owners: number }[]
}

export type AdminUser = {
  id: number
  username: string
  email: string
  date_joined: string
  last_login: string | null
  is_admin: boolean
  precons: number
  decks: number
  draws: number
  games: number
  wins: number
}

export type AdminUserOrdering = 'recent' | 'oldest' | 'last_login' | 'username' | 'draws' | 'wins' | 'pool'

export type AuthResponse = { token: string; user: User }

export type RoomPlayer = { id: number; name: string; username: string | null }

export type Room = {
  code: string
  mode: DrawMode
  filters: DrawFilters
  host_id: number | null
  players: RoomPlayer[]
  round: number
  draw: Draw | null
  draw_seats: number[]
  reveal_at: string | null
  you: number | null
  server_time: string
  token?: string
}
