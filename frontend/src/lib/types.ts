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
  /** Ex.: "Legendary Creature — Dragon" (decks importados podem não ter) */
  type_line?: string
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
  /** Bracket estimado (2, 3 ou 4); null = ainda não calculado */
  bracket?: number | null
  /** Nível de poder estimado, 1 a 10 */
  power?: number | null
  /** Valor estimado (soma dos preços no Scryfall), em texto decimal ("61.50"); null = ainda não calculado */
  price_usd?: string | null
  price_eur?: string | null
}

/** Valor estimado do deck na página dele */
export type DeckPrice = {
  usd: string
  eur: string
  /** Cópias sem preço no Scryfall (ficam fora da soma) */
  missing: number
  top: { name: string; quantity: number; usd: string | null; eur: string | null; image: string }[]
  updated_at: string | null
}

export type AnalysisCategoryKey =
  'fast_mana' | 'ramp' | 'draw' | 'tutor' | 'removal' | 'board_wipe' | 'counterspell' | 'protection'

export type PowerFactor = { key: string; value: number; score: number; weight: number; points: number }

export type DeckAnalysis = {
  power: number
  label: string
  base: number
  bracket_bonus: number
  score: number
  factors: PowerFactor[]
  categories: Record<AnalysisCategoryKey, { count: number; cards: string[] }>
  lands: number
  avg_cmc: number
}

export type BracketDetails = {
  game_changers?: string[]
  mass_land_denial?: string[]
  extra_turns?: string[]
  two_card_combos?: string[][]
  banned?: string[]
  /** Está no 4 só por causa desta carta de destruição de terrenos em massa */
  single_trigger?: string | null
}

export type Card = {
  scryfall_id: string
  oracle_id?: string | null
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
  /** Preço desta edição no Scryfall (US$), texto decimal */
  price_usd?: string | null
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
  bracket_details?: BracketDetails
  analysis?: DeckAnalysis
  price?: DeckPrice
  /** Decks montados: artes personalizadas {oracle_id: url} */
  arts?: Record<string, string>
}

/** Arte personalizada enviada pelo usuário */
export type CardArtItem = { id: string; url: string; created_at: string }

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
  /** Só decks até este bracket estimado */
  max_bracket?: number | null
  /** No máximo 1 bracket de diferença entre os decks da mesa */
  bracket_balance?: boolean
}

export type DrawEntry = {
  position: number
  player_name: string
  deck: DeckSummary | null
  owner: string | null
  /** Sala: o jogador resorteou o próprio deck (nome do deck anterior); vazio se não */
  rerolled_from?: string
}

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
  players: (WinRecord & { username: string; supporter?: boolean })[]
}

export type ScoreRow = WinRecord & { name: string }

export type MyDraw = {
  code: string
  /** "table": partida numa mesa aberta, sem sorteio (sem página de sorteio) */
  mode: DrawMode | 'table'
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
  /** Partidas de mesa aberta (já somadas em games e wins) */
  table_games?: number
  most_received: { deck: DeckSummary; times: number }[]
  best_decks: DeckRanking[]
}

export type SocialProvider = 'google' | 'discord'

export type User = {
  id: number
  username: string
  is_admin?: boolean
  /** Conta criada pelo Google/Discord não tem senha (excluir confirma com o nome de usuário) */
  has_password?: boolean
  /** Serviços ligados para entrar */
  social?: SocialProvider[]
  /** "derived": a senha nunca sai do navegador; "legacy": conta antiga até o próximo login */
  auth_scheme?: 'derived' | 'legacy'
  /** Tem e-mail cadastrado (o servidor só guarda a impressão digital; o legível fica no cofre) */
  has_email?: boolean
  /** Já criou o perfil privado (cofre) */
  has_vault?: boolean
  /** Quando dá para trocar o nome de usuário de novo (ISO); null = já pode */
  username_next_change?: string | null
  /** Aceitou aparecer (pelo nome de usuário) nos posts do Upkeeper nas redes sociais */
  social_opt_in?: boolean
  /** Foto de perfil (endereço público; null sem foto) */
  avatar?: string | null
  /** Apoiador do site: situação e escolhas dos enfeites */
  supporter?: SupporterInfo
}

/** Apoiador (doação ativada pelo admin): só enfeites, nada de Magic fica pago */
export type SupporterInfo = {
  active: boolean
  /** Até quando vale (ISO); null = nunca apoiou */
  until: string | null
  /** Já apoiou alguma vez */
  ever: boolean
  sleeve: string
  on_wall: boolean
  /** Fundo do campo na mesa (endereço público) */
  playmat: string | null
  /** Quantos dias cada ativação vale */
  days: number
  /** Soma das doações em centavos (o admin digita ao ativar) */
  total_cents: number
  /** Fundador: selo permanente, não vence */
  founder: boolean
  /** Aparece na página de créditos (só Fundador) */
  in_credits: boolean
  /** Até quando qualquer doação vira Fundador (ISO) */
  founder_until: string
  /** Total que vira Fundador depois do prazo, em centavos */
  founder_total_cents: number
}

export type AdminSupporter = {
  username: string
  until: string
  since: string
  times: number
  active: boolean
  total_cents: number
  founder: boolean
}

/** Aviso de doação por Pix: centavos reservados para a conta e, depois do "Já doei", o presenteado */
export type DonationClaim = { cents: number; reserved_until: string; claimed_at: string | null; gift: string | null }

export type AdminDonation = {
  id: number
  username: string
  gift: string | null
  cents: number
  reserved_at: string
  claimed_at: string
}

/** Perfil privado como o servidor guarda: tudo cifrado no navegador (lib/vault.ts) */
export type VaultPayload = {
  exists: boolean
  salt: string
  iterations: number
  key_by_secret: string
  key_by_recovery: string
  data: string
  version: number
  /** O que tranca o cofre: a senha da conta ou (conta só Google/Discord) uma senha do cofre */
  secret: 'password' | 'vault_password'
}

export type Prelogin = { scheme: 'derived' | 'legacy'; salt: string | null; iterations: number }

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
  date_joined: string
  last_login: string | null
  is_admin: boolean
  precons: number
  decks: number
  draws: number
  games: number
  wins: number
}

/** Imagem denunciada na fila do admin (as denúncias abertas dela somadas) */
export type AdminReport = {
  key: string
  kind: 'avatar' | 'art' | 'playmat'
  url: string
  owner: string
  owner_blocked: boolean
  count: number
  first_at: string
  last_at: string
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

/** Mesa virtual ainda aberta em que você tem lugar (lista do lobby) */
/** Estilo de jogo escolhido ao abrir a mesa */
export type Playstyle = 'beginner' | 'janky' | 'relaxed' | 'optimized' | 'competitive'
/** Regras para os decks da mesa (null = livre): bracket máximo, tutores no máximo, valor máximo em US$ */
export type TableRules = { bracket: number | null; tutors: number | null; price: number | null }
export type TableOptions = {
  title: string
  style: Playstyle | null
  friends_only: boolean
  allow_watch: boolean
  rules?: TableRules
}
/** Amigos e pedidos (id do pedido/amizade e o nome de usuário da outra pessoa) */
export type FriendItem = {
  id: number
  username: string
  /** Só nos amigos aceitos: usou o site há pouco ou está numa mesa */
  online?: boolean
  /** Mesa aberta em que o amigo está sentado agora */
  table?: string | null
}
/** Convite para mesa recebido de um amigo (vale alguns minutos) */
export type TableInvite = { id: number; from: string; code: string; age: number }
export type Friends = { friends: FriendItem[]; incoming: FriendItem[]; outgoing: FriendItem[]; invites?: TableInvite[] }

export type AchievementKey =
  | 'first_game' | 'regular' | 'veteran' | 'first_win' | 'champion' | 'legend'
  | 'builder' | 'architect' | 'collector' | 'explorer' | 'social'
/** Perfil público (/u/:nome) */
export type PublicProfile = {
  username: string
  /** Foto de perfil (null sem foto) */
  avatar?: string | null
  /** Apoiador do site agora (selo ao lado do nome) */
  supporter?: boolean
  /** Fundador (selo permanente) */
  founder?: boolean
  joined: string
  stats: {
    games: number
    wins: number
    win_rate: number
    decks: number
    precons: number
    commanders: number
    /** Horas jogadas, em segundos */
    seconds_played?: number
  }
  commanders: { name: string; image: string; games: number; wins: number }[]
  decks: DeckSummary[]
  achievements: { key: AchievementKey; earned: boolean; progress: number; goal: number }[]
}

export type MyTable = {
  code: string
  players: { name: string; seat: number; deck: string | null; online: boolean; you: boolean }[]
  max_seats: number
  /** Mesas antigas não têm */
  options?: TableOptions
  /** Passou o primeiro turno: quem chega só assiste */
  started?: boolean
  /** Lista pública: você pode sentar (mesa "só amigos": amigo de quem abriu). Sem: pode */
  can_join?: boolean
  /** Quem está assistindo agora */
  spectators?: number
  turn: number
  finished: boolean
  /** Segundos até fechar por inatividade */
  idle_left: number
}

/** Post das redes (painel /admin/social); slides = especificação das imagens (lib/socialCanvas) */
export type SocialNetwork = 'instagram' | 'x'
export type SocialStatus = 'draft' | 'approved' | 'published' | 'error'
export type SocialKind = 'ranking' | 'precon' | 'numbers' | 'news' | 'repost' | 'custom'
export type SocialPost = {
  id: number
  network: SocialNetwork
  kind: SocialKind
  lang: 'pt' | 'en'
  status: SocialStatus
  text: string
  slides: ({ t: string } & Record<string, unknown>)[]
  /** Repost da curadoria: mídia hospedada, post original e autor (o crédito vai na legenda) */
  media_url: string
  /** Post gerado no painel: as imagens já enviadas ao Cloudinary (2 ou mais = carrossel) */
  media_urls: string[]
  media_type: '' | 'image' | 'video'
  source_url: string
  source_handle: string
  /** Legenda do post original, para referência ao escrever a do repost */
  source_caption: string
  /** Por que a publicação automática falhou */
  error: string
  scheduled_for: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}
/** Perfil do Instagram que a curadoria acompanha (backend/social/curation.py) */
export type SocialCreator = {
  id: number
  handle: string
  active: boolean
  followers: number
  authorized: boolean
  authorized_at: string | null
  authorization_note: string
}
/** Post bom de quem ainda não autorizou repost, com a mensagem pronta para a DM */
export type SocialRequest = {
  id: number
  handle: string
  url: string
  media_type: string
  caption: string
  likes: number
  comments: number
  engagement: number
  outlier: number
  posted_at: string
  note: string
  permission_message: string
}
export type SocialFeed = {
  days: number
  numbers: { games: number; players: number; commanders: number; most_played: string | null }
  top_commanders: { name: string; art: string; games: number; wins: number }[]
  top_players: { username: string; games: number; wins: number }[]
  featured_precon: { name: string; commander: string } | null
}
