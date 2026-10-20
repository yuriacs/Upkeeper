/*
 * Desenho de uma ficha personalizada no formato de carta (488 × 680, o mesmo das imagens do
 * Scryfall): moldura na cor da ficha, nome, arte (enviada do computador ou um fundo liso), linha
 * de tipo, texto e força/resistência. A imagem pronta vai para o servidor e vira a ficha da mesa.
 */

export const TOKEN_W = 488
export const TOKEN_H = 680

export type TokenSpec = {
  name: string
  /** Linha de tipo sem o "Token" (ex.: "Creature — Cat Soldier") */
  type: string
  /** W U B R G; vazio = incolor, duas ou mais = dourada */
  colors: string[]
  text: string
  power: string
  toughness: string
}

export const TOKEN_COLORS = ['W', 'U', 'B', 'R', 'G'] as const

/** Moldura de cada cor: [clara, escura] */
const FRAME: Record<string, [string, string]> = {
  W: ['#f4eedb', '#d9cda8'],
  U: ['#c3dcf0', '#7fb0da'],
  B: ['#aaa19c', '#6f6560'],
  R: ['#f2b9a1', '#d97b5a'],
  G: ['#bcdab8', '#76ad74'],
  M: ['#efd998', '#cfa94a'],
  C: ['#dad8d3', '#a9a59e'],
}
const INK = '#151515'
const TITLE = "700 {px}px 'Barlow Condensed', 'Arial Narrow', sans-serif"
const BODY = "500 {px}px 'Barlow', system-ui, sans-serif"
const font = (tpl: string, px: number) => tpl.replace('{px}', String(px))

/** Carrega as fontes do site antes de desenhar (senão o canvas usa a padrão) */
export async function loadTokenFonts() {
  try {
    await Promise.all([document.fonts.load(font(TITLE, 30)), document.fonts.load(font(BODY, 22))])
  } catch {
    // sem as fontes, desenha com as de reserva
  }
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** Texto numa linha só, diminuindo a fonte até caber */
function fitLine(ctx: CanvasRenderingContext2D, text: string, tpl: string, px: number, maxW: number) {
  let size = px
  ctx.font = font(tpl, size)
  while (size > 12 && ctx.measureText(text).width > maxW) ctx.font = font(tpl, --size)
}

/** Quebra o texto em linhas que cabem em maxW (respeita as quebras de linha digitadas) */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && ctx.measureText(next).width > maxW) {
        lines.push(line)
        line = word
      } else line = next
    }
    lines.push(line)
  }
  return lines
}

export function drawToken(ctx: CanvasRenderingContext2D, spec: TokenSpec, art: ImageBitmap | null) {
  const W = TOKEN_W
  const H = TOKEN_H
  const key = spec.colors.length === 0 ? 'C' : spec.colors.length > 1 ? 'M' : spec.colors[0]
  const [light, dark] = FRAME[key]
  const text = spec.text.trim()
  const pt = spec.power.trim() || spec.toughness.trim() ? `${spec.power.trim() || '0'}/${spec.toughness.trim() || '0'}` : ''

  ctx.clearRect(0, 0, W, H)
  // Borda preta e moldura
  ctx.fillStyle = INK
  box(ctx, 0, 0, W, H, 26)
  ctx.fill()
  const frame = ctx.createLinearGradient(0, 0, W, H)
  frame.addColorStop(0, light)
  frame.addColorStop(1, dark)
  ctx.fillStyle = frame
  box(ctx, 16, 16, W - 32, H - 32, 14)
  ctx.fill()

  const bar = (y: number, h: number) => {
    ctx.fillStyle = light
    box(ctx, 28, y, W - 56, h, 10)
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = dark
    ctx.stroke()
  }

  // Nome
  bar(28, 48)
  ctx.fillStyle = INK
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  fitLine(ctx, spec.name.trim() || ' ', TITLE, 32, W - 84)
  ctx.fillText(spec.name.trim(), 42, 53)

  // Arte (ocupa mais espaço quando a ficha não tem texto)
  const artTop = 86
  const artBottom = text ? 420 : 540
  const ax = 36
  const aw = W - 72
  const ah = artBottom - artTop
  ctx.save()
  ctx.beginPath()
  ctx.rect(ax, artTop, aw, ah)
  ctx.clip()
  if (art) {
    const scale = Math.max(aw / art.width, ah / art.height)
    const w = art.width * scale
    const h = art.height * scale
    ctx.drawImage(art, ax + (aw - w) / 2, artTop + (ah - h) / 2, w, h)
  } else {
    const bg = ctx.createLinearGradient(0, artTop, 0, artBottom)
    bg.addColorStop(0, dark)
    bg.addColorStop(1, '#2a2a2a')
    ctx.fillStyle = bg
    ctx.fillRect(ax, artTop, aw, ah)
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.textAlign = 'center'
    ctx.font = font(TITLE, Math.round(ah * 0.6))
    ctx.fillText((spec.name.trim()[0] ?? '').toUpperCase(), W / 2, artTop + ah / 2 + 6)
    ctx.textAlign = 'left'
  }
  ctx.restore()
  ctx.lineWidth = 3
  ctx.strokeStyle = INK
  ctx.strokeRect(ax, artTop, aw, ah)

  // Linha de tipo
  const typeY = artBottom + 8
  bar(typeY, 42)
  ctx.fillStyle = INK
  const type = `Token ${spec.type.trim()}`.trim()
  fitLine(ctx, type, TITLE, 26, W - 84)
  ctx.fillText(type, 42, typeY + 22)

  // Texto
  if (text) {
    const top = typeY + 50
    const bottom = H - 62
    ctx.fillStyle = '#f5efe0'
    ctx.fillRect(36, top, W - 72, bottom - top)
    ctx.lineWidth = 2
    ctx.strokeStyle = dark
    ctx.strokeRect(36, top, W - 72, bottom - top)
    ctx.fillStyle = INK
    ctx.textBaseline = 'top'
    let size = 24
    let lines: string[]
    for (;;) {
      ctx.font = font(BODY, size)
      lines = wrap(ctx, text, W - 100)
      if (size <= 13 || lines.length * size * 1.25 <= bottom - top - 24) break
      size--
    }
    const lineH = size * 1.25
    const start = top + Math.max(12, (bottom - top - lines.length * lineH) / 2)
    lines.forEach((l, i) => ctx.fillText(l, 50, start + i * lineH, W - 100))
  }

  // Força/resistência
  if (pt) {
    const w = 104
    const h = 48
    const x = W - 28 - w
    const y = H - 30 - h
    ctx.fillStyle = light
    box(ctx, x, y, w, h, 10)
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = INK
    ctx.stroke()
    ctx.fillStyle = INK
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    fitLine(ctx, pt, TITLE, 34, w - 16)
    ctx.fillText(pt, x + w / 2, y + h / 2 + 1)
    ctx.textAlign = 'left'
  }

  // Rodapé
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.font = font(BODY, 13)
  ctx.fillText('Upkeeper · custom token', 36, H - 30)
}
