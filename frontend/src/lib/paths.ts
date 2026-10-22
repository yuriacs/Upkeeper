import type { DeckSummary } from './types'

export const deckPath = (deck: Pick<DeckSummary, 'kind' | 'slug'>) =>
  deck.kind === 'user' ? `/user-deck/${deck.slug}` : `/deck/${deck.slug}`

// Endereços antigos, em português (links compartilhados, favoritos, e-mails já enviados), e os de
// agora. Mais longos primeiro: o primeiro prefixo que bate ganha.
const LEGACY: [string, string][] = [
  ['/minha-pool/montar', '/my-pool/build'],
  ['/minha-pool/novo', '/my-pool/new'],
  ['/minha-pool', '/my-pool'],
  ['/deck-usuario', '/user-deck'],
  ['/entrar/social', '/login/social'],
  ['/entrar', '/login'],
  ['/esqueci-a-senha', '/forgot-password'],
  ['/redefinir-senha', '/reset-password'],
  ['/meus-sorteios', '/history'],
  ['/sortear', '/draw'],
  ['/sorteio', '/draw'],
  ['/sala', '/room'],
  ['/catalogo', '/catalog'],
  ['/privacidade', '/privacy'],
  ['/apoie', '/support'],
  ['/novidades', '/changelog'],
  ['/partida', '/replay'],
  ['/painel', '/admin'],
  ['/conta', '/account'],
  ['/amigos', '/friends'],
  ['/mesa', '/table'],
]
const LEGACY_PARAMS: Record<string, string> = {
  assistir: 'watch',
  conectado: 'connected',
  criar: 'signup',
  meus: 'mine',
  poder: 'power',
}

/** O endereço novo de um endereço antigo (caminho, parâmetros e #), ou null se não for antigo */
export function legacyRedirect(pathname: string, search: string, hash: string): string | null {
  const hit = LEGACY.find(([old]) => pathname === old || pathname.startsWith(`${old}/`))
  if (!hit) return null
  const params = new URLSearchParams()
  new URLSearchParams(search).forEach((value, key) => params.append(LEGACY_PARAMS[key] ?? key, value))
  const query = params.toString().replace(/=(?=&|$)/g, '') // "?signup" continua sem "="
  return hit[1] + pathname.slice(hit[0].length) + (query ? `?${query}` : '') + hash
}
