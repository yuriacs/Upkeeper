/*
 * Cartas desenhadas no site (fichas personalizadas; um criador de cartas no futuro). `drawCard`
 * monta a carta inteira a partir de um CardSpec; `drawReadyCard` usa uma imagem de carta já pronta
 * (feita em outro editor), só enquadrada no formato.
 */
import { drawArt } from './draw'
import { CARD_H, CARD_W, RENDER_SCALE, type ArtFrame } from './spec'

export * from './spec'
export { artBox, drawArt, drawCard, loadCardFonts } from './draw'
export { isSymbol } from './symbols'

/** Imagem grande demais para abrir no navegador sem travar (o servidor ainda reduz para 488 × 680) */
const MAX_IMAGE = 15 * 1024 * 1024

/** Abre a imagem escolhida no computador (null se não for uma imagem que dê para usar) */
export async function loadImageFile(file: File): Promise<ImageBitmap | null> {
  if (!file.type.startsWith('image/') || file.size > MAX_IMAGE) return null
  try {
    return await createImageBitmap(file)
  } catch {
    return null
  }
}

/** Imagem de carta já pronta ocupando a carta inteira, com o enquadramento escolhido */
export function drawReadyCard(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  frame: ArtFrame,
) {
  ctx.fillStyle = '#0b0b0b'
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  drawArt(ctx, image, frame, 0, 0, CARD_W, CARD_H)
}

/** Prepara um canvas em 2× e desenha nele em medidas de carta (488 × 680) */
export function paint(canvas: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D) => void) {
  canvas.width = CARD_W * RENDER_SCALE
  canvas.height = CARD_H * RENDER_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0)
  draw(ctx)
}

/**
 * O canvas pronto para enviar ao servidor (que reduz para 488 × 680 em WebP). WebP de alta
 * qualidade: em PNG o granulado da moldura deixaria o arquivo perto do limite de envio (o Safari,
 * que não gera WebP, manda PNG mesmo).
 */
export const canvasBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', 0.95))
