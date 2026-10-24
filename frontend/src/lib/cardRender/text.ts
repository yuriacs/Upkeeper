/*
 * Texto da caixa de regras: quebra em linhas com símbolos de mana no meio das palavras ("{T}:"),
 * texto de lembrete (entre parênteses) em itálico, ambientação em itálico separada por um traço,
 * e o tamanho diminui até tudo caber. A fonte é a MPlantin (mana-font), a mesma das cartas.
 */
import { drawSymbol, isSymbol, symbolWidth } from './symbols'

export const RULES_FONT = "MPlantin, 'Crimson Text', Georgia, serif"
const MIN_SIZE = 9

type Piece = { kind: 'word'; text: string; italic: boolean } | { kind: 'sym'; code: string }
/** Pedaços sem espaço entre si (uma quebra de linha só acontece entre segmentos) */
type Segment = { pieces: Piece[]; width: number }
type Line = { segments: Segment[] }
type Paragraph = { lines: Line[]; flavor: boolean }
export type TextLayout = { size: number; paragraphs: Paragraph[]; height: number }

const font = (size: number, italic: boolean) => `${italic ? 'italic ' : ''}${size}px ${RULES_FONT}`

/** Um parágrafo em segmentos (o itálico do lembrete acompanha os parênteses) */
function segments(text: string, italicAll: boolean): Piece[][] {
  const out: Piece[][] = []
  let depth = 0
  for (const chunk of text.split(/\s+/).filter(Boolean)) {
    const pieces: Piece[] = []
    for (const m of chunk.matchAll(/\{([^}]+)\}|[^{]+|\{/g)) {
      if (m[1] !== undefined && isSymbol(m[1])) {
        pieces.push({ kind: 'sym', code: m[1] })
        continue
      }
      const word = m[0]
      const italic = italicAll || depth > 0 || word.includes('(')
      depth = Math.max(0, depth + (word.split('(').length - 1) - (word.split(')').length - 1))
      pieces.push({ kind: 'word', text: word, italic })
    }
    out.push(pieces)
  }
  return out
}

function measure(ctx: CanvasRenderingContext2D, pieces: Piece[], size: number): number {
  let w = 0
  for (const p of pieces) {
    if (p.kind === 'sym') w += symbolWidth(size)
    else {
      ctx.font = font(size, p.italic)
      w += ctx.measureText(p.text).width
    }
  }
  return w
}

function wrap(ctx: CanvasRenderingContext2D, text: string, flavor: boolean, size: number, maxW: number): Paragraph[] {
  return text
    .split('\n')
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => {
      const space = (ctx.font = font(size, flavor), ctx.measureText(' ').width)
      const lines: Line[] = []
      let line: Line = { segments: [] }
      let lineW = 0
      for (const pieces of segments(para, flavor)) {
        const seg = { pieces, width: measure(ctx, pieces, size) }
        const next = line.segments.length ? lineW + space + seg.width : seg.width
        if (line.segments.length && next > maxW) {
          lines.push(line)
          line = { segments: [seg] }
          lineW = seg.width
        } else {
          line.segments.push(seg)
          lineW = next
        }
      }
      if (line.segments.length) lines.push(line)
      return { lines, flavor }
    })
}

const lineHeight = (size: number) => size * 1.17
const paragraphGap = (size: number) => size * 0.4
const flavorGap = (size: number) => size * 0.9

function heightOf(paragraphs: Paragraph[], size: number): number {
  let h = 0
  paragraphs.forEach((p, i) => {
    if (i > 0) h += p.flavor && !paragraphs[i - 1].flavor ? flavorGap(size) : paragraphGap(size)
    h += p.lines.length * lineHeight(size)
  })
  return h
}

/** Maior tamanho (até `start`) em que regras e ambientação cabem em width × height */
export function layoutText(
  ctx: CanvasRenderingContext2D,
  rules: string,
  flavor: string,
  width: number,
  height: number,
  start: number,
): TextLayout {
  let size = start
  for (;;) {
    const paragraphs = [...wrap(ctx, rules, false, size, width), ...wrap(ctx, flavor, true, size, width)]
    const h = heightOf(paragraphs, size)
    if (h <= height || size <= MIN_SIZE) return { size, paragraphs, height: h }
    size = Math.max(MIN_SIZE, size - 0.5)
  }
}

/** Desenha o texto no alto de (x, top); o traço da ambientação vai até `width` */
export function drawText(ctx: CanvasRenderingContext2D, layout: TextLayout, x: number, top: number, width: number, ink: string) {
  const { size, paragraphs } = layout
  const lh = lineHeight(size)
  let y = top
  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  paragraphs.forEach((p, i) => {
    if (i > 0) {
      const flavorStart = p.flavor && !paragraphs[i - 1].flavor
      if (flavorStart) {
        // O traço fino entre as regras e a ambientação
        const mid = y + flavorGap(size) / 2
        const bar = ctx.createLinearGradient(x, 0, x + width, 0)
        bar.addColorStop(0, 'rgba(0,0,0,0)')
        bar.addColorStop(0.5, 'rgba(0,0,0,0.55)')
        bar.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = bar
        ctx.fillRect(x + width * 0.04, mid - 0.6, width * 0.92, 1.2)
      }
      y += flavorStart ? flavorGap(size) : paragraphGap(size)
    }
    for (const line of p.lines) {
      const base = y + size * 0.86
      let cx = x
      ctx.font = font(size, p.flavor)
      const space = ctx.measureText(' ').width
      line.segments.forEach((seg, si) => {
        if (si > 0) cx += space
        for (const piece of seg.pieces) {
          if (piece.kind === 'sym') {
            const w = symbolWidth(size)
            drawSymbol(ctx, piece.code, cx + w / 2, base - size * 0.3, size * 0.86, false)
            cx += w
          } else {
            ctx.font = font(size, piece.italic)
            ctx.fillStyle = ink
            ctx.fillText(piece.text, cx, base)
            cx += ctx.measureText(piece.text).width
          }
        }
      })
      y += lh
    }
  })
  ctx.restore()
}
