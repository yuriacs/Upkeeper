/*
 * Desenho da carta no formato das cartas atuais (moldura M15): borda preta, moldura texturizada na
 * cor da carta, faixa do nome, arte, linha de tipo, caixa de texto, força/resistência e rodapé.
 * Tudo é desenhado aqui (nada de imagens de moldura de terceiros); as medidas são em 488 × 680 e o
 * contexto já vem escalado por quem chama.
 */
import { CARD_H, CARD_W, type ArtFrame, type CardSpec } from './spec'
import { drawSymbol, parseCost } from './symbols'
import { drawText, layoutText } from './text'

/** Fonte do nome, da linha de tipo e da força/resistência (a das cartas, Beleren, não é livre) */
export const TITLE_FONT = "'Spectral', 'Cinzel', Georgia, serif"
const TITLE_CSS = 'https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,700;0,800;1,500&display=swap'

/** Cores de uma moldura: [moldura clara, moldura escura], faixas, caixa de texto, contorno */
type Palette = { frame: [string, string]; bar: [string, string]; box: [string, string]; edge: string }

const PALETTES: Record<string, Palette> = {
  W: { frame: ['#f3eed9', '#cdbf9b'], bar: ['#fbf7ea', '#e4dbc2'], box: ['#f8f4e6', '#e9e1c9'], edge: '#8e8266' },
  U: { frame: ['#2f86c9', '#0c4c86'], bar: ['#d5e6f3', '#a9c8e0'], box: ['#dce9f3', '#bcd3e6'], edge: '#0b3d6b' },
  B: { frame: ['#4a4442', '#1b1817'], bar: ['#d8d1cd', '#b3aaa5'], box: ['#ddd6d2', '#c2b9b4'], edge: '#151212' },
  R: { frame: ['#d9573a', '#8d2615'], bar: ['#f3d6c8', '#e0ad98'], box: ['#f4ddd1', '#e5c0ae'], edge: '#6b1c0f' },
  G: { frame: ['#3c8f55', '#155230'], bar: ['#d9e6d2', '#b2ccaa'], box: ['#dfe9d7', '#c2d6b8'], edge: '#0f3d22' },
  M: { frame: ['#e6c56a', '#a87f26'], bar: ['#f6ebc9', '#e2cd92'], box: ['#f5ecd0', '#e6d6a6'], edge: '#7a5a17' },
  C: { frame: ['#b9c1c5', '#6f7a80'], bar: ['#eef0f1', '#cfd5d8'], box: ['#eceeef', '#d3d8da'], edge: '#4e575c' },
}

function palettes(spec: CardSpec): { frame: Palette; a: Palette; b: Palette } {
  const cs = spec.colors
  if (cs.length === 0) return { frame: PALETTES.C, a: PALETTES.C, b: PALETTES.C }
  if (cs.length === 1) return { frame: PALETTES[cs[0]], a: PALETTES[cs[0]], b: PALETTES[cs[0]] }
  // Duas cores: moldura dourada, faixas e caixa passando de uma cor para a outra; três ou mais: tudo dourado
  if (cs.length === 2) return { frame: PALETTES.M, a: PALETTES[cs[0]], b: PALETTES[cs[1]] }
  return { frame: PALETTES.M, a: PALETTES.M, b: PALETTES.M }
}

/** Carrega as fontes antes de desenhar (senão o canvas usa as de reserva) */
export async function loadCardFonts() {
  if (!document.querySelector(`link[href="${TITLE_CSS}"]`)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = TITLE_CSS
    document.head.appendChild(link)
    await new Promise((ok) => {
      link.onload = ok
      link.onerror = ok
    })
  }
  try {
    await Promise.all([
      document.fonts.load(`800 30px ${TITLE_FONT}`),
      document.fonts.load('20px MPlantin'),
      document.fonts.load('italic 20px MPlantin'),
      document.fonts.load('20px Mana'),
    ])
  } catch {
    // sem as fontes, desenha com as de reserva
  }
}

// ---- texturas ------------------------------------------------------------------------------------

let grain: HTMLCanvasElement | null = null
/** Granulado fixo (sempre o mesmo, para a ficha sair igual toda vez) que dá textura às superfícies */
function grainTile(): HTMLCanvasElement {
  if (grain) return grain
  const c = document.createElement('canvas')
  c.width = c.height = 160
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(160, 160)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (rnd() - 0.5) * 90
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  // Algumas manchas maiores, como o papel/metal das molduras
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
    ctx.beginPath()
    ctx.arc(rnd() * 160, rnd() * 160, 6 + rnd() * 22, 0, Math.PI * 2)
    ctx.fill()
  }
  grain = c
  return c
}

/** Granulado por cima do que já está no caminho atual (clip) */
function texture(ctx: CanvasRenderingContext2D, alpha: number) {
  ctx.save()
  ctx.clip()
  ctx.globalAlpha = alpha
  ctx.globalCompositeOperation = 'overlay'
  ctx.fillStyle = ctx.createPattern(grainTile(), 'repeat')!
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  ctx.restore()
}

// ---- formas --------------------------------------------------------------------------------------

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** Faixa com as pontas chanfradas (nome e linha de tipo) */
function barPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const c = h * 0.32
  ctx.beginPath()
  ctx.moveTo(x + c, y)
  ctx.lineTo(x + w - c, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + c)
  ctx.lineTo(x + w, y + h - c)
  ctx.quadraticCurveTo(x + w, y + h, x + w - c, y + h)
  ctx.lineTo(x + c, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - c)
  ctx.lineTo(x, y + c)
  ctx.quadraticCurveTo(x, y, x + c, y)
  ctx.closePath()
}

/** Gradiente da esquerda para a direita entre duas cores (ou uma só) */
function across(ctx: CanvasRenderingContext2D, x: number, w: number, a: string, b: string) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0)
  g.addColorStop(0, a)
  g.addColorStop(0.35, a)
  g.addColorStop(0.65, b)
  g.addColorStop(1, b)
  return g
}

function bar(ctx: CanvasRenderingContext2D, p: ReturnType<typeof palettes>, x: number, y: number, w: number, h: number) {
  // Sombra embaixo, como se a faixa estivesse por cima da moldura
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 5
  ctx.shadowOffsetY = 2
  barPath(ctx, x, y, w, h)
  ctx.fillStyle = across(ctx, x, w, p.a.bar[0], p.b.bar[0])
  ctx.fill()
  ctx.restore()
  // Volume: mais claro em cima, mais escuro embaixo
  barPath(ctx, x, y, w, h)
  const shade = ctx.createLinearGradient(0, y, 0, y + h)
  shade.addColorStop(0, 'rgba(255,255,255,0.45)')
  shade.addColorStop(0.45, 'rgba(255,255,255,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.22)')
  ctx.fillStyle = shade
  ctx.fill()
  barPath(ctx, x, y, w, h)
  texture(ctx, 0.35)
  barPath(ctx, x, y, w, h)
  ctx.lineWidth = 2
  ctx.strokeStyle = p.frame.edge
  ctx.stroke()
  barPath(ctx, x + 2, y + 2, w - 4, h - 4)
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.stroke()
}

/** Texto numa linha só, diminuindo a fonte até caber; devolve a largura final */
function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, px: number, maxW: number): number {
  let size = px
  ctx.font = `${weight} ${size}px ${TITLE_FONT}`
  while (size > 10 && ctx.measureText(text).width > maxW) ctx.font = `${weight} ${--size}px ${TITLE_FONT}`
  return ctx.measureText(text).width
}

// ---- arte ----------------------------------------------------------------------------------------

/** Desenha a imagem cobrindo (x, y, w, h), com o zoom e o ponto escolhidos pelo jogador */
export function drawArt(
  ctx: CanvasRenderingContext2D,
  art: CanvasImageSource & { width: number; height: number },
  frame: ArtFrame,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.max(w / art.width, h / art.height) * Math.max(1, frame.zoom)
  const dw = art.width * scale
  const dh = art.height * scale
  const clamp = (v: number) => Math.max(-1, Math.min(1, v || 0))
  ctx.drawImage(art, x - ((dw - w) * (clamp(frame.x) + 1)) / 2, y - ((dh - h) * (clamp(frame.y) + 1)) / 2, dw, dh)
}

/** Área da arte de uma carta (para o editor saber onde arrastar) */
export function artBox(spec: CardSpec) {
  const hasText = !!(spec.text.trim() || spec.flavor.trim())
  const top = 80
  const bottom = spec.layout === 'card' ? 376 : hasText ? 404 : 548
  return { x: 35, y: top, w: CARD_W - 70, h: bottom - top }
}

// ---- carta ---------------------------------------------------------------------------------------

export function drawCard(
  ctx: CanvasRenderingContext2D,
  spec: CardSpec,
  art: (CanvasImageSource & { width: number; height: number }) | null,
) {
  const W = CARD_W
  const H = CARD_H
  const p = palettes(spec)
  const ink = '#111'
  const name = spec.name.trim()
  const rules = spec.text.trim()
  const flavor = spec.flavor.trim()
  const hasText = !!(rules || flavor)
  const power = spec.power.trim()
  const tough = spec.toughness.trim()
  const pt = power || tough ? `${power || '0'}/${tough || '0'}` : ''

  ctx.save()
  ctx.clearRect(0, 0, W, H)
  // Borda preta (o servidor tira a transparência: os cantos ficam pretos como a borda)
  ctx.fillStyle = '#0b0b0b'
  ctx.fillRect(0, 0, W, H)

  // Moldura
  const fx = 17
  const fy = 17
  const fw = W - 34
  const fh = H - 52
  rounded(ctx, fx, fy, fw, fh, 10)
  const fg = ctx.createLinearGradient(fx, fy, fx + fw * 0.6, fy + fh)
  fg.addColorStop(0, p.frame.frame[0])
  fg.addColorStop(1, p.frame.frame[1])
  ctx.fillStyle = fg
  ctx.fill()
  rounded(ctx, fx, fy, fw, fh, 10)
  texture(ctx, 0.55)
  // Brilho nas bordas da moldura (relevo)
  rounded(ctx, fx + 1.5, fy + 1.5, fw - 3, fh - 3, 9)
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.stroke()
  rounded(ctx, fx + 5, fy + 5, fw - 10, fh - 10, 7)
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.stroke()

  // Arte
  const box = artBox(spec)
  ctx.save()
  ctx.beginPath()
  ctx.rect(box.x, box.y, box.w, box.h)
  ctx.clip()
  if (art) drawArt(ctx, art, spec.art, box.x, box.y, box.w, box.h)
  else {
    const bg = ctx.createLinearGradient(0, box.y, 0, box.y + box.h)
    bg.addColorStop(0, p.frame.frame[1])
    bg.addColorStop(1, '#1d1d1d')
    ctx.fillStyle = bg
    ctx.fillRect(box.x, box.y, box.w, box.h)
    ctx.fillStyle = 'rgba(255,255,255,0.14)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `800 ${Math.round(box.h * 0.55)}px ${TITLE_FONT}`
    ctx.fillText((name[0] ?? '').toUpperCase(), W / 2, box.y + box.h / 2)
  }
  // Sombra interna, como a arte afundada na moldura
  const inner = ctx.createLinearGradient(0, box.y, 0, box.y + 14)
  inner.addColorStop(0, 'rgba(0,0,0,0.45)')
  inner.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = inner
  ctx.fillRect(box.x, box.y, box.w, 14)
  ctx.restore()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = '#141414'
  ctx.strokeRect(box.x, box.y, box.w, box.h)

  // Faixa do nome
  const nb = { x: 27, y: 27, w: W - 54, h: 42 }
  bar(ctx, p, nb.x, nb.y, nb.w, nb.h)
  ctx.fillStyle = ink
  ctx.textBaseline = 'middle'
  const nameY = nb.y + nb.h / 2 + 1
  if (spec.layout === 'token') {
    fitText(ctx, name, 800, 27, nb.w - 60)
    ctx.textAlign = 'center'
    ctx.fillText(name, W / 2, nameY)
  } else {
    const cost = parseCost(spec.manaCost)
    const d = 21
    const costW = cost.length * (d + 2)
    cost.forEach((c, i) => drawSymbol(ctx, c, nb.x + nb.w - 14 - costW + i * (d + 2) + d / 2, nameY, d))
    fitText(ctx, name, 800, 25, nb.w - 36 - costW)
    ctx.textAlign = 'left'
    ctx.fillStyle = ink
    ctx.fillText(name, nb.x + 16, nameY)
  }

  // Linha de tipo
  const tb = { x: 27, y: box.y + box.h + 5, w: W - 54, h: 38 }
  bar(ctx, p, tb.x, tb.y, tb.w, tb.h)
  const typeRaw = spec.type.trim()
  const type = spec.layout === 'token' && !/^token\b/i.test(typeRaw) ? `Token ${typeRaw}`.trim() : typeRaw
  fitText(ctx, type, 700, 22, tb.w - 36)
  ctx.fillStyle = ink
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(type, tb.x + 16, tb.y + tb.h / 2 + 1)

  // Caixa de texto
  const textTop = tb.y + tb.h + 5
  const textBottom = fy + fh - 12
  if (hasText) {
    const tx = 37
    const tw = W - 74
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 4
    ctx.fillStyle = across(ctx, tx, tw, p.a.box[0], p.b.box[0])
    ctx.fillRect(tx, textTop, tw, textBottom - textTop)
    ctx.restore()
    ctx.beginPath()
    ctx.rect(tx, textTop, tw, textBottom - textTop)
    const tshade = ctx.createLinearGradient(0, textTop, 0, textBottom)
    tshade.addColorStop(0, 'rgba(255,255,255,0.25)')
    tshade.addColorStop(1, 'rgba(0,0,0,0.08)')
    ctx.fillStyle = tshade
    ctx.fill()
    ctx.beginPath()
    ctx.rect(tx, textTop, tw, textBottom - textTop)
    texture(ctx, 0.22)
    ctx.lineWidth = 2
    ctx.strokeStyle = p.frame.edge
    ctx.strokeRect(tx, textTop, tw, textBottom - textTop)

    const padX = 13
    const padTop = 9
    // Espaço da força/resistência embaixo à direita
    const padBottom = pt ? 22 : 9
    const areaH = textBottom - textTop - padTop - padBottom
    const start = 21 * Math.min(1.4, Math.max(0.6, spec.fontScale || 1))
    const layout = layoutText(ctx, rules, flavor, tw - padX * 2, areaH, start)
    // Texto curto fica no meio da caixa, como nas cartas
    const y = textTop + padTop + Math.max(0, (areaH - layout.height) / 2)
    drawText(ctx, layout, tx + padX, y, tw - padX * 2, ink)
  }

  // Força/resistência
  if (pt) {
    const w = 86
    const h = 40
    const x = W - 27 - w
    const y = fy + fh - h + 10
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 5
    ctx.shadowOffsetY = 2
    barPath(ctx, x, y, w, h)
    ctx.fillStyle = p.b.bar[0]
    ctx.fill()
    ctx.restore()
    barPath(ctx, x, y, w, h)
    const shade = ctx.createLinearGradient(0, y, 0, y + h)
    shade.addColorStop(0, 'rgba(255,255,255,0.45)')
    shade.addColorStop(0.5, 'rgba(255,255,255,0)')
    shade.addColorStop(1, 'rgba(0,0,0,0.25)')
    ctx.fillStyle = shade
    ctx.fill()
    barPath(ctx, x, y, w, h)
    texture(ctx, 0.35)
    barPath(ctx, x, y, w, h)
    ctx.lineWidth = 2
    ctx.strokeStyle = p.frame.edge
    ctx.stroke()
    ctx.fillStyle = ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    fitText(ctx, pt, 800, 28, w - 16)
    ctx.fillText(pt, x + w / 2, y + h / 2 + 1)
  }

  // Rodapé na borda preta: ilustrador à esquerda; marca de carta feita no site à direita
  ctx.textBaseline = 'middle'
  const footY = H - 17
  ctx.font = `italic 500 12px ${TITLE_FONT}`
  ctx.textAlign = 'left'
  ctx.fillStyle = '#e8e2d4'
  const artist = spec.artist.trim()
  if (artist) ctx.fillText(`Illus. ${artist}`, 26, footY)
  ctx.font = `500 10px ${TITLE_FONT}`
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(232,226,212,0.6)'
  ctx.fillText(spec.layout === 'token' ? 'Upkeeper · custom token' : 'Upkeeper · custom card', W - 26, footY)
  ctx.restore()
}
