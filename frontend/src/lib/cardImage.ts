/*
 * Tamanho da imagem da carta conforme o tamanho em que ela aparece. As imagens vêm do Scryfall,
 * que tem a mesma carta em vários tamanhos: "small" (146 px de largura, ~12 KB) e "normal"
 * (488 px, ~70 KB). No campo e na mão as cartas têm de 60 a 120 px, então a pequena basta e o
 * download cai uns 80% (no celular faz muita diferença). A carta ampliada continua na "normal".
 */

/** Largura da imagem "small" do Scryfall */
const SMALL_WIDTH = 146

/** Mesma carta, na versão pequena (se for uma imagem do Scryfall; senão, a mesma URL) */
export function smallImage(url: string): string {
  if (!url) return url
  if (url.includes('cards.scryfall.io/normal/'))
    return url.replace('cards.scryfall.io/normal/', 'cards.scryfall.io/small/')
  if (url.includes('api.scryfall.com/') && url.includes('version=normal'))
    return url.replace('version=normal', 'version=small')
  return url
}

/**
 * Imagem certa para uma carta mostrada com `width` px: a pequena enquanto ela não ficar borrada
 * (considera a densidade da tela: num celular com tela 2x, a pequena vale até ~90 px).
 */
export function cardImage(url: string, width: number): string {
  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 3)
  return width * dpr <= SMALL_WIDTH * 1.25 ? smallImage(url) : url
}
