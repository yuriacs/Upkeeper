import type { Replay, ReplaySummary } from './replay'
import type {
  NewAchievement,
  AdminOverview,
  AdminReport,
  AdminDonation,
  AdminSupporter,
  AdminUser,
  AdminUserOrdering,
  AuthResponse,
  DeckDetail,
  DeckSummary,
  DonationClaim,
  Draw,
  DrawFilters,
  DrawMode,
  Edition,
  Friends,
  CardArtItem,
  BracketDetails,
  DeckAnalysis,
  DescribeResult,
  GeneratorUsage,
  PlayGuide,
  PoolCard,
  SocialCreator,
  SocialFeed,
  SocialKind,
  SocialNetwork,
  SocialPost,
  SocialRequest,
  SocialStatus,
  PublicProfile,
  GlobalStats,
  QueuePick,
  QueueStatus,
  Matchup,
  Season,
  Versus,
  MyDraw,
  MyStats,
  MyTable,
  Paginated,
  Prelogin,
  Room,
  ScoreRow,
  SocialProvider,
  SupporterInfo,
  TournamentDetail,
  TournamentSummary,
  User,
  UserDeckSaved,
  VaultPayload,
} from './types'
import { getDrawToken, saveDrawToken } from './drawTokens'
import { getLang, translate } from './i18n'

// Em dev fica vazio (o proxy do Vite cuida de /api).
// Em produção, a Vercel injeta VITE_API_URL com a URL do backend.
const API_URL = import.meta.env.VITE_API_URL ?? ''

let authToken: string | null = null
let onUnauthorized: (() => void) | null = null

/** Token da conta logada (a mesa virtual o manda na primeira mensagem do WebSocket). */
export const getAuthToken = () => authToken

/** URL de WebSocket do backend: mesmo host em dev (proxy do Vite), VITE_API_URL em produção. */
export function wsUrl(path: string): string {
  const base = API_URL || window.location.origin
  return base.replace(/^http/, 'ws') + path
}

/** Chamado pelo AuthProvider: define o token enviado em todas as requisições. */
export function setAuthToken(token: string | null, onExpired?: () => void) {
  authToken = token
  onUnauthorized = onExpired ?? null
}

export class ApiError extends Error {
  status: number
  details: string[]
  fields: Record<string, string[]>
  constructor(status: number, message: string, details: string[] = [], fields: Record<string, string[]> = {}) {
    super(message)
    this.status = status
    this.details = details
    this.fields = fields
  }
}

/** Erro de rede ou servidor reiniciando/fora do ar: vale tentar de novo. */
export function isTransient(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || err.status === 429 || err.status >= 500)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        // Envio de arquivo (FormData): o navegador põe o Content-Type com o separador certo
        ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        // Mensagens de erro do servidor no idioma escolhido no site
        'Accept-Language': getLang() === 'pt' ? 'pt-BR' : 'en',
        ...(authToken ? { Authorization: `Token ${authToken}` } : {}),
        ...init?.headers,
      },
    })
  } catch {
    // fetch só falha assim sem resposta nenhuma: sem internet, servidor reiniciando, CORS de um 502...
    throw new ApiError(0, translate(getLang(), "Couldn't reach the server. Check your connection and try again."))
  }
  if (res.status === 401 && authToken) onUnauthorized?.()
  if (!res.ok) {
    let message =
      res.status >= 500
        ? translate(getLang(), 'The server is unavailable right now. Try again in a moment.')
        : translate(getLang(), 'Error {status}', { status: res.status })
    let details: string[] = []
    let fields: Record<string, string[]> = {}
    try {
      const body = await res.json()
      if (body?.detail) message = body.detail
      if (Array.isArray(body?.errors)) details = body.errors
      if (body && !body.detail && typeof body === 'object') {
        // Erros de validação do DRF: {"campo": ["mensagem"]}
        fields = body
        const first = Object.values(body).flat()[0]
        if (typeof first === 'string') message = first
      }
    } catch {
      /* resposta sem JSON */
    }
    throw new ApiError(res.status, message, details, fields)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const apiGet = <T>(path: string) => request<T>(path)

/** Escolhas dos enfeites de apoiador (PATCH /api/auth/me/supporter/) */
export type SupporterChoices = Partial<
  Pick<SupporterInfo, 'sleeve' | 'on_wall' | 'in_credits' | 'foil' | 'frame' | 'title'>
>

/** Novo torneio (POST /api/tournaments/): as regras dos decks como ao abrir uma mesa */
export type TournamentCreate = {
  name: string
  kind: 'bracket' | 'league'
  team_size?: 1 | 2
  friends_only?: boolean
  max_bracket?: number | null
  max_tutors?: number | null
  max_price?: number | null
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
})

export type DeckFilters = {
  search?: string
  colors?: string
  edition?: string
  year?: string
  slugs?: string
  bracket?: string
  ordering?: string
  power_min?: string
  power_max?: string
}

export const api = {
  editions: () => request<Edition[]>('/api/editions/'),
  decks: (filters: DeckFilters, page: number, pageSize = 24) => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value)
    }
    return request<Paginated<DeckSummary>>(`/api/decks/?${params}`)
  },
  deck: (slug: string) => request<DeckDetail>(`/api/decks/${encodeURIComponent(slug)}/`),
  userDeck: (id: string) => request<DeckDetail>(`/api/user-decks/${encodeURIComponent(id)}/`),

  draw: async (names: string[], filters: DrawFilters, mode: DrawMode = 'precon') => {
    const draw = await request<Draw>('/api/draw/', json('POST', { mode, names, filters }))
    if (draw.manage_token) saveDrawToken(draw.code, draw.manage_token)
    return draw
  },
  getDraw: (code: string) => request<Draw>(`/api/draw/${encodeURIComponent(code)}/`, withDraw(code)),
  /** Marca quem ganhou (posição) ou desfaz (null). Na sala, vai junto o token do jogador. */
  setDrawResult: (code: string, winner: number | null, roomToken?: string | null) => {
    const init = withDraw(code, json('POST', { winner }))
    if (roomToken) init.headers = { ...init.headers, 'X-Room-Token': roomToken }
    return request<Draw>(`/api/draw/${encodeURIComponent(code)}/result/`, init)
  },
  // Painel de administração (só contas com acesso)
  adminOverview: () => request<AdminOverview>('/api/admin/overview/'),
  // Redes sociais (só admin): feed de dados e fila de posts
  socialFeed: () => request<SocialFeed>('/api/admin/social/feed/'),
  socialPosts: (status?: SocialStatus) =>
    request<SocialPost[]>(`/api/admin/social/posts/${status ? `?status=${status}` : ''}`),
  createSocialPost: (data: Partial<SocialPost>) => request<SocialPost>('/api/admin/social/posts/', json('POST', data)),
  generateSocialPosts: (kind: SocialKind, network: SocialNetwork | 'both', lang: 'pt' | 'en') =>
    request<SocialPost[]>('/api/admin/social/posts/generate/', json('POST', { kind, network, lang })),
  updateSocialPost: (id: number, data: Partial<SocialPost>) =>
    request<SocialPost>(`/api/admin/social/posts/${id}/`, json('PATCH', data)),
  deleteSocialPost: (id: number) => request<void>(`/api/admin/social/posts/${id}/`, json('DELETE')),
  socialCreators: () => request<SocialCreator[]>('/api/admin/social/creators/'),
  addSocialCreators: (handles: string) =>
    request<SocialCreator[]>('/api/admin/social/creators/', json('POST', { handles })),
  updateSocialCreator: (id: number, data: Partial<SocialCreator>) =>
    request<SocialCreator>(`/api/admin/social/creators/${id}/`, json('PATCH', data)),
  deleteSocialCreator: (id: number) => request<void>(`/api/admin/social/creators/${id}/`, json('DELETE')),
  socialRequests: () => request<SocialRequest[]>('/api/admin/social/requests/'),
  socialRequestAction: (id: number, action: 'grant' | 'skip') =>
    request<SocialPost | undefined>(`/api/admin/social/requests/${id}/${action}/`, json('POST')),
  repostSocialLink: (url: string) => request<SocialPost>('/api/admin/social/repost/', json('POST', { url })),
  publishSocialPost: (id: number, text?: string, media_urls?: string[]) =>
    request<void>(`/api/admin/social/posts/${id}/publish/`, json('POST', { ...(text ? { text } : {}), ...(media_urls ? { media_urls } : {}) })),
  uploadSocialImage: (id: number, index: number, image: string) =>
    request<{ url: string }>(`/api/admin/social/posts/${id}/media/`, json('POST', { index, image })),
  setSocialOptIn: (opt_in: boolean) => request<User>('/api/auth/me/social/', json('PUT', { opt_in })),
  /** Denúncias de imagens abertas (uma linha por imagem) e a decisão do admin */
  adminSupporters: () =>
    request<{ days: number; active: number; supporters: AdminSupporter[] }>('/api/admin/supporters/'),
  /** `amount` em centavos: entra no total doado (selo de Fundador) */
  grantSupporter: (username: string, amount = 0) =>
    request<AdminSupporter>('/api/admin/supporters/', json('POST', { username, amount })),
  revokeSupporter: (username: string) =>
    request<void>(`/api/admin/supporters/${encodeURIComponent(username)}/`, json('DELETE')),
  adminDonations: () => request<{ days: number; donations: AdminDonation[] }>('/api/admin/donations/'),
  resolveDonation: (id: number, action: 'grant' | 'reject', amount = 0) =>
    request<AdminSupporter | undefined>(`/api/admin/donations/${id}/`, json('POST', { action, amount })),
  myDonation: () => request<DonationClaim>('/api/auth/me/donation/'),
  claimDonation: (gift: string) => request<DonationClaim>('/api/auth/me/donation/', json('POST', { gift })),
  cancelDonation: () => request<void>('/api/auth/me/donation/', json('DELETE')),
  adminReports: () => request<{ reports: AdminReport[] }>('/api/admin/reports/'),
  resolveReport: (key: string, action: 'hide' | 'dismiss', block: boolean) =>
    request<void>(`/api/admin/reports/${key}/`, json('POST', { action, block })),
  unblockUploads: (username: string) =>
    request<void>(`/api/admin/upload-blocks/${encodeURIComponent(username)}/`, json('DELETE')),
  adminUsers: (search: string, ordering: AdminUserOrdering, page: number) => {
    const params = new URLSearchParams({ page: String(page), ordering })
    if (search) params.set('search', search)
    return request<Paginated<AdminUser>>(`/api/admin/users/?${params}`)
  },
  arts: () => request<{ arts: string[]; items?: { art: string; commander: string }[] }>('/api/arts/'),
  /**
   * Ranking: partidas de decks sorteados ("draws") ou de mesas abertas sem sorteio ("tables"); `players`:
   * só as partidas com 2, 3 ou 4 jogadores (4 = 4 ou mais), sem ele todas
   */
  stats: (source: 'draws' | 'tables' = 'draws', players: number | null = null) =>
    request<GlobalStats>(`/api/stats/?source=${source}${players ? `&players=${players}` : ''}`),
  /** Temporada do mês (`month` AAAA-MM; sem, a atual) */
  season: (month?: string) => request<Season>(`/api/stats/season/${month ? `?month=${month}` : ''}`),
  /** Os decks que um deck mais enfrentou (precon pelo slug, deck da pool pelo id) */
  matchups: (kind: 'precon' | 'user', ref: string) =>
    request<{ matchups: Matchup[] }>(`/api/stats/matchups/${kind}/${encodeURIComponent(ref)}/`),
  /** Fila "Achar partida": ver, entrar e sair */
  queue: () => request<QueueStatus>('/api/tables/queue/'),
  joinQueue: (pick: QueuePick) => request<QueueStatus>('/api/tables/queue/', json('POST', pick)),
  leaveQueue: () => request<QueueStatus>('/api/tables/queue/', { method: 'DELETE' }),
  /** Suas partidas com o dono do perfil */
  versus: (username: string) => request<Versus>(`/api/users/${encodeURIComponent(username)}/versus/`),
  myDraws: (page: number) => request<Paginated<MyDraw>>(`/api/auth/me/draws/?page=${page}`),
  myStats: () => request<MyStats>('/api/auth/me/stats/'),
  /** Partidas para rever (só as suas) e uma partida inteira, turno a turno */
  myReplays: () => request<{ replays: ReplaySummary[] }>('/api/tables/replays/'),
  replay: (id: string) => request<Replay>(`/api/tables/replays/${encodeURIComponent(id)}/`),
  /** A partida pelo link público (sem conta) */
  sharedReplay: (key: string) => request<Replay>(`/api/tables/replays/shared/${encodeURIComponent(key)}/`),
  /** Liga ou desliga o link público da partida (qualquer jogador dela) */
  shareReplay: (id: number, on: boolean) =>
    request<{ share: string | null }>(`/api/tables/replays/${id}/share/`, json('POST', { on })),
  /** Abre de novo a mesa de uma partida que fechou sem vencedor (cada um volta ao seu lugar) */
  /** `moment`: turno e ação (índices; ação null = fim do turno) para voltar dali; sem, do fim */
  restoreReplay: (id: string | number, moment?: { turn: number; event: number | null }) =>
    request<{ code: string }>(
      `/api/tables/replays/${encodeURIComponent(String(id))}/restore/`,
      json('POST', moment ?? {}),
    ),
  myTables: () => request<{ tables: MyTable[]; idle_close: number }>('/api/tables/mine/'),
  /** Todas as mesas abertas (com lugar: entrar; cheias: assistir) */
  openTables: () => request<{ tables: MyTable[]; idle_close: number }>('/api/tables/open/'),
  /** Torneios: chave (1v1 ou 2x2) ou liga em pods; cada partida abre uma mesa */
  tournaments: () => request<{ tournaments: TournamentSummary[] }>('/api/tournaments/'),
  tournament: (id: string) => request<TournamentDetail>(`/api/tournaments/${encodeURIComponent(id)}/`),
  createTournament: (data: TournamentCreate) => request<{ id: number }>('/api/tournaments/', json('POST', data)),
  deleteTournament: (id: number) => request<void>(`/api/tournaments/${id}/`, json('DELETE')),
  tournamentAction: (id: number, action: 'join' | 'leave') =>
    request<TournamentDetail>(`/api/tournaments/${id}/${action}/`, json('POST')),
  /** Começa o torneio; na liga, com o número de rodadas (um de round_options) */
  startTournament: (id: number, rounds?: number) =>
    request<TournamentDetail>(`/api/tournaments/${id}/start/`, json('POST', rounds ? { rounds } : {})),
  dropEntry: (id: number, entry: number) =>
    request<TournamentDetail>(`/api/tournaments/${id}/entries/${entry}/drop/`, json('POST')),
  /** Organizador: resultado de uma partida (ids dos inscritos, do 1º em diante; na chave, só o vencedor) */
  matchResult: (id: number, match: number, order: number[]) =>
    request<TournamentDetail>(`/api/tournaments/${id}/matches/${match}/result/`, json('POST', { order })),
  // Amigos (mesas "só amigos"): pedido pelo nome de usuário, o outro aceita
  friends: () => request<Friends>('/api/auth/friends/'),
  addFriend: (username: string) => request<Friends>('/api/auth/friends/', json('POST', { username })),
  acceptFriend: (id: number) => request<Friends>(`/api/auth/friends/${id}/accept/`, json('POST')),
  removeFriend: (id: number) => request<Friends>(`/api/auth/friends/${id}/`, json('DELETE')),
  /** Convida um amigo para a mesa em que você está sentado */
  inviteFriend: (username: string, code: string) =>
    request<void>('/api/auth/friends/invite/', json('POST', { username, code })),
  dismissInvite: (id: number) => request<Friends>(`/api/auth/friends/invites/${id}/`, json('DELETE')),
  profile: (username: string) => request<PublicProfile>(`/api/users/${encodeURIComponent(username)}/`),
  /** Conquistas ganhas que o site ainda não avisou, e marcar o aviso como visto */
  /** Um precon ao acaso para a mesa (regras da mesa, cores que o deck precisa ter, slugs que não servem) */
  randomPrecon: (o: { bracket: number | null; price: number | null; tutors: number | null; colors: string; exclude: string[] }) => {
    const q = new URLSearchParams()
    if (o.bracket != null) q.set('bracket', String(o.bracket))
    if (o.price != null) q.set('price', String(o.price))
    if (o.tutors != null) q.set('tutors', String(o.tutors))
    if (o.colors) q.set('colors', o.colors)
    if (o.exclude.length) q.set('exclude', o.exclude.join(','))
    return request<{ deck: DeckSummary; pool: number }>(`/api/decks/random/?${q}`)
  },
  newAchievements: () => request<{ achievements: NewAchievement[] }>('/api/achievements/new/'),
  seenAchievements: (keys: string[]) =>
    request<{ achievements: NewAchievement[] }>('/api/achievements/seen/', json('POST', { keys })),


  // Conta. A senha nunca vai para o servidor: vai a auth_key derivada dela (lib/account.ts)
  prelogin: (login: string) => request<Prelogin>('/api/auth/prelogin/', json('POST', { login })),
  register: (body: {
    username: string
    email: string
    auth_key: string
    salt: string
    vault: { key_by_secret: string; key_by_recovery: string; data: string }
  }) => request<AuthResponse>('/api/auth/register/', json('POST', body)),
  login: (
    body:
      | { login: string; auth_key: string }
      | { login: string; password: string; upgrade: { auth_key: string; salt: string } },
  ) => request<AuthResponse>('/api/auth/login/', json('POST', body)),
  logout: () => request<void>('/api/auth/logout/', json('POST', {})),
  me: () => request<User>('/api/auth/me/'),
  /** Conta com senha confirma com a chave da senha; conta só do Google/Discord, com o nome de usuário */
  deleteAccount: (confirm: { auth_key: string } | { password: string } | { confirm: string }) =>
    request<void>('/api/auth/me/', json('DELETE', confirm)),
  /** Troca o nome de usuário (uma vez por semana; só maiúsculas/minúsculas não conta) */
  setUsername: (username: string) => request<User>('/api/auth/me/username/', json('PUT', { username })),
  /** O servidor guarda só a impressão digital do e-mail; matches = já era esse */
  setEmail: (email: string) =>
    request<{ matches: boolean; user: User }>('/api/auth/me/email/', json('PUT', { email })),
  vault: () => request<VaultPayload>('/api/auth/me/vault/'),
  patchVault: (data: string, version: number) =>
    request<VaultPayload>('/api/auth/me/vault/', json('PATCH', { data, version })),
  putVault: (body: {
    key_by_secret: string
    key_by_recovery: string
    data: string
    version: number
    salt?: string
    /** Conta com senha prova a senha (o cofre não pode ser trancado com uma senha errada) */
    auth_key?: string
  }) =>
    request<VaultPayload>('/api/auth/me/vault/', json('PUT', body)),
  // Esqueci a senha (o link chega por e-mail; o servidor não grava o endereço)
  forgotPassword: (email: string) => request<{ sent: true }>('/api/auth/password/forgot/', json('POST', { email })),
  resetCheck: (uid: string, token: string) =>
    request<{ username: string; vault: { exists: boolean; key_by_recovery: string; data: string } }>(
      '/api/auth/password/reset/check/',
      json('POST', { uid, token }),
    ),
  resetPassword: (body: {
    uid: string
    token: string
    auth_key: string
    salt: string
    vault: { key_by_secret: string; key_by_recovery: string; data: string }
  }) => request<{ username: string }>('/api/auth/password/reset/', json('POST', body)),
  // Login com Google e Discord (backend: accounts/oauth.py)
  oauthProviders: () =>
    request<{ providers: SocialProvider[]; password_reset?: boolean }>('/api/auth/oauth/providers/'),
  oauthStart: (provider: SocialProvider, mode: 'login' | 'connect') =>
    request<{ url: string; nonce: string }>(`/api/auth/oauth/${provider}/start/`, json('POST', { mode })),
  oauthComplete: (provider: SocialProvider, body: { code: string; state: string; nonce: string }) =>
    request<AuthResponse | { connected: SocialProvider; user: User }>(
      `/api/auth/oauth/${provider}/complete/`,
      json('POST', body),
    ),
  /** Zera o histórico do filtro "Não repetir deck" (os sorteios antigos continuam salvos). */
  resetMyHistory: () => request<{ cleared: number }>('/api/auth/me/history/reset/', json('POST', {})),
  /** Baixa todos os dados da conta (LGPD) como arquivo JSON, com o perfil privado aberto, se estiver. */
  exportAccount: async (filename: string, privateProfile?: unknown) => {
    const data = await request<Record<string, unknown>>('/api/auth/me/export/')
    if (privateProfile) data.private_profile_decrypted_in_your_browser = privateProfile
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  },

  // Deckpool
  myPrecons: () => request<{ slugs: string[] }>('/api/me/precons/'),
  addPrecons: (slugs: string[]) => request<{ slugs: string[] }>('/api/me/precons/', json('POST', { slugs })),
  setPrecon: (slug: string, owned: boolean) =>
    request<{ slugs: string[] }>(`/api/me/precons/${encodeURIComponent(slug)}/`, json(owned ? 'PUT' : 'DELETE')),
  myDecks: () => request<DeckSummary[]>('/api/me/decks/'),
  myDeck: (id: string) => request<DeckDetail>(`/api/me/decks/${encodeURIComponent(id)}/`),
  saveMyDeck: (data: { name: string; decklist: string; commanders?: string[] }, id?: string) =>
    request<UserDeckSaved>(
      id ? `/api/me/decks/${encodeURIComponent(id)}/` : '/api/me/decks/',
      json(id ? 'PUT' : 'POST', data),
    ),
  /** A lista de um deck pelo link (Archidekt, MTGGoldfish): o servidor busca, a página confere e salva */
  deckFromUrl: (url: string) =>
    request<{ name: string; decklist: string; source: string; warnings: string[] }>('/api/me/decks/from-url/', json('POST', { url })),
  /** Função de cada carta (ramp, compra, remoção...) pelas tags do Scryfall, para agrupar no deckbuilder */
  cardRoles: (cards: { oracle_id: string; name: string }[]) =>
    request<{ roles: Record<string, string[]> }>('/api/cards/roles/', json('POST', { cards })),
  /** Cartas favoritas do deckbuilder (oracle ids) */
  favoriteCards: () => request<{ oracle_ids: string[]; max: number }>('/api/me/favorite-cards/'),
  setFavoriteCard: (oracleId: string, on: boolean) =>
    request<void>(`/api/me/favorite-cards/${oracleId}/`, json(on ? 'PUT' : 'DELETE')),
  /**
   * Artes personalizadas de uma carta, de todos os usuários (as mais usadas primeiro); `loose`: as
   * suas antigas ainda sem carta; `mine`/`max`: quantas você enviou e o limite
   */
  cardArts: (oracleId: string) =>
    request<{ arts: CardArtItem[]; loose: CardArtItem[]; mine: number; max: number }>(`/api/card-arts/${oracleId}/`),
  /** Envia uma arte para uma carta: todo mundo pode usá-la nessa carta */
  uploadCardArt: (file: File, oracleId: string) => {
    const body = new FormData()
    body.append('file', file)
    body.append('oracle_id', oracleId)
    return request<CardArtItem>('/api/me/card-arts/', { method: 'POST', body })
  },
  /** Artes que você escolheu para as fichas do Scryfall: {oracle_id: url} (art = null tira) */
  /** Gerador de decks: se a IA está ligada e quantos pedidos a conta ainda tem hoje */
  generatorInfo: () => request<{ ai: boolean; ai_left: number }>('/api/generator/'),
  /** Gerador de decks: a frase do "Descreva seu deck" vira as escolhas (IA) */
  generatorDescribe: (text: string) => request<DescribeResult>('/api/generator/describe/', json('POST', { text })),
  /** Gerador de decks: guia de jogo do deck pronto (IA) */
  generatorGuide: (body: { commanders: string[]; themes: string[]; bracket: number; cards: { name: string; role: string }[] }) =>
    request<PlayGuide>('/api/generator/guide/', json('POST', body)),
  /** Gerador de decks: como foi uma geração (só entra nas somas do dia, sem a conta) */
  generatorStats: (body: { event: 'done' | 'failed' | 'cancelled' | 'saved'; ms?: number; scryfall?: number; edhrec?: number; server?: number }) =>
    request<void>('/api/generator/stats/', json('POST', body)),
  /** Painel do admin: uso do gerador nos últimos 30 dias (gerações, pedidos, tokens e custo da IA) */
  generatorUsage: () => request<GeneratorUsage>('/api/generator/usage/'),
  /** Cartas que o jogador tem (precons marcados e decks montados) nessas cores ("" = incolores) */
  myCardPool: (identity: string) =>
    request<{ cards: PoolCard[]; precons: number; decks: number }>(
      `/api/me/card-pool/?identity=${encodeURIComponent(identity || 'C')}`,
    ),
  /** Bracket e nível de poder de uma lista ainda sendo montada (deckbuilder) */
  deckEstimate: (
    cards: { name: string; oracle_id: string | null; qty: number; cmc: number; land: boolean; commander: boolean }[],
  ) =>
    request<{ bracket: number | null; bracket_details: BracketDetails; analysis: DeckAnalysis }>(
      '/api/deck-estimate/',
      json('POST', { cards }),
    ),
  /** Foto de perfil: envia (troca) ou remove; devolve o endereço novo (null sem foto) */
  uploadAvatar: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<{ avatar: string | null }>('/api/auth/me/avatar/', { method: 'POST', body })
  },
  removeAvatar: () => request<{ avatar: string | null }>('/api/auth/me/avatar/', json('DELETE')),
  /** Apoiador: escolhas dos enfeites (sleeve, aparecer no mural) */
  updateSupporter: (data: SupporterChoices) =>
    request<SupporterInfo>('/api/auth/me/supporter/', json('PATCH', data)),
  /** Fundo do campo na mesa (só apoiador): envia (troca) ou remove */
  uploadPlaymat: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<{ playmat: string | null }>('/api/auth/me/playmat/', { method: 'POST', body })
  },
  removePlaymat: () => request<{ playmat: string | null }>('/api/auth/me/playmat/', json('DELETE')),
  /** Sleeve com imagem própria (só Fundador com apoio ativo): envia (troca) ou remove */
  uploadSleeve: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<{ sleeve_image: string | null }>('/api/auth/me/sleeve/', { method: 'POST', body })
  },
  removeSleeve: () => request<{ sleeve_image: string | null }>('/api/auth/me/sleeve/', json('DELETE')),
  /** Mural da página de apoio */
  supportersWall: () => request<{ supporters: { username: string; avatar: string | null }[] }>('/api/supporters/'),
  /** Página de créditos: os Fundadores */
  supportersCredits: () =>
    request<{ founders: { username: string; avatar: string | null }[] }>('/api/supporters/credits/'),
  /** Denuncia a foto de perfil ou a arte personalizada de outro jogador (vai para a fila do admin) */
  reportImage: (url: string) => request<void>('/api/auth/report-image/', json('POST', { url })),
  /** Fichas personalizadas (imagem da carta inteira, montada no site): para as que não existem no Scryfall */
  customTokens: () => request<{ arts: CardArtItem[]; max: number }>('/api/me/card-arts/?kind=token'),
  uploadCustomToken: (file: File, meta: { name: string; power: string; toughness: string }) => {
    const body = new FormData()
    body.append('file', file)
    body.append('kind', 'token')
    for (const [k, v] of Object.entries(meta)) body.append(k, v)
    return request<CardArtItem>('/api/me/card-arts/', { method: 'POST', body })
  },
  tokenArts: () => request<{ arts: Record<string, string> }>('/api/me/token-arts/'),
  setTokenArt: (oracleId: string, art: string | null) =>
    request<{ arts: Record<string, string> }>('/api/me/token-arts/', json('PUT', { oracle_id: oracleId, art })),
  deleteCardArt: (id: string) => request<void>(`/api/me/card-arts/${id}/`, json('DELETE')),
  /** Arte de uma carta num deck seu (art = null tira) */
  setDeckCardArt: (deckId: string, oracleId: string, art: string | null) =>
    request<{ arts: Record<string, string> }>(`/api/me/decks/${deckId}/arts/`, json('PUT', { oracle_id: oracleId, art })),
  deleteMyDeck: (id: string) => request<void>(`/api/me/decks/${encodeURIComponent(id)}/`, json('DELETE')),

  // Salas online (o token do jogador vai no header X-Room-Token)
  createRoom: (data: { name?: string; mode: DrawMode; filters: DrawFilters }) =>
    request<Room>('/api/rooms/', json('POST', data)),
  getRoom: (code: string, token?: string | null) => request<Room>(`/api/rooms/${code}/`, withRoom(token)),
  joinRoom: (code: string, name: string, token?: string | null) =>
    request<Room>(`/api/rooms/${code}/join/`, withRoom(token, json('POST', { name }))),
  leaveRoom: (code: string, token: string) =>
    request<void>(`/api/rooms/${code}/leave/`, withRoom(token, json('POST', {}))),
  kickFromRoom: (code: string, token: string, playerId: number) =>
    request<Room>(`/api/rooms/${code}/kick/`, withRoom(token, json('POST', { player_id: playerId }))),
  updateRoom: (code: string, token: string, data: { mode?: DrawMode; filters?: DrawFilters }) =>
    request<Room>(`/api/rooms/${code}/`, withRoom(token, json('PATCH', data))),
  resetRoomHistory: (code: string, token: string) =>
    request<Room & { cleared: number }>(`/api/rooms/${code}/history/reset/`, withRoom(token, json('POST', {}))),
  roomScoreboard: (code: string) => request<{ players: ScoreRow[] }>(`/api/rooms/${code}/scoreboard/`),
  drawRoom: (code: string, token: string) =>
    request<Room>(`/api/rooms/${code}/draw/`, withRoom(token, json('POST', {}))),
  rerollRoom: (code: string, token: string) =>
    request<Room>(`/api/rooms/${code}/reroll/`, withRoom(token, json('POST', {}))),
}

function withDraw(code: string, init: RequestInit = {}): RequestInit {
  const token = getDrawToken(code)
  return token ? { ...init, headers: { ...(init.headers as Record<string, string>), 'X-Draw-Token': token } } : init
}

function withRoom(token?: string | null, init: RequestInit = {}): RequestInit {
  return token ? { ...init, headers: { 'X-Room-Token': token } } : init
}
