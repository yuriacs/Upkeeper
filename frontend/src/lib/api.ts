import type {
  AdminOverview,
  AdminUser,
  AdminUserOrdering,
  AuthResponse,
  DeckDetail,
  DeckSummary,
  Draw,
  DrawFilters,
  DrawMode,
  Edition,
  Friends,
  GlobalStats,
  MyDraw,
  MyStats,
  MyTable,
  Paginated,
  Prelogin,
  Room,
  ScoreRow,
  SocialProvider,
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

/** Erro de rede ou servidor acordando/fora do ar: vale tentar de novo. */
export function isTransient(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || err.status === 429 || err.status >= 500)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        // Mensagens de erro do servidor no idioma escolhido no site
        'Accept-Language': getLang() === 'pt' ? 'pt-BR' : 'en',
        ...(authToken ? { Authorization: `Token ${authToken}` } : {}),
        ...init?.headers,
      },
    })
  } catch {
    // fetch só falha assim sem resposta nenhuma: sem internet, servidor acordando, CORS de um 502...
    throw new ApiError(0, translate(getLang(), "Couldn't reach the server. Check your connection and try again."))
  }
  if (res.status === 401 && authToken) onUnauthorized?.()
  if (!res.ok) {
    let message =
      res.status >= 500
        ? translate(getLang(), 'The server is waking up or unstable. Try again in a moment.')
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
  adminUsers: (search: string, ordering: AdminUserOrdering, page: number) => {
    const params = new URLSearchParams({ page: String(page), ordering })
    if (search) params.set('search', search)
    return request<Paginated<AdminUser>>(`/api/admin/users/?${params}`)
  },
  arts: () => request<{ arts: string[]; items?: { art: string; commander: string }[] }>('/api/arts/'),
  stats: () => request<GlobalStats>('/api/stats/'),
  myDraws: (page: number) => request<Paginated<MyDraw>>(`/api/auth/me/draws/?page=${page}`),
  myStats: () => request<MyStats>('/api/auth/me/stats/'),
  myTables: () => request<{ tables: MyTable[]; idle_close: number }>('/api/tables/mine/'),
  /** Todas as mesas abertas (com lugar: entrar; cheias: assistir) */
  openTables: () => request<{ tables: MyTable[]; idle_close: number }>('/api/tables/open/'),
  // Amigos (mesas "só amigos"): pedido pelo nome de usuário, o outro aceita
  friends: () => request<Friends>('/api/auth/friends/'),
  addFriend: (username: string) => request<Friends>('/api/auth/friends/', json('POST', { username })),
  acceptFriend: (id: number) => request<Friends>(`/api/auth/friends/${id}/accept/`, json('POST')),
  removeFriend: (id: number) => request<Friends>(`/api/auth/friends/${id}/`, json('DELETE')),

  health: () => request<{ status: string }>('/api/health/'),

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
