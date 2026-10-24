/*
 * Símbolos de mana no canvas com a fonte Mana (mana-font, já carregada no site): o círculo na cor
 * do símbolo, a sombra das cartas impressas e o desenho por cima. Os códigos são os do texto das
 * cartas: {W}, {2}, {X}, {T}, {Q}, {E}, {S}, {C}, {W/U} (híbrido), {2/W}, {W/P} (phyrexiano).
 */

export const MANA_FONT = 'Mana'

const GLYPH: Record<string, string> = {
  W: '',
  U: '',
  B: '',
  R: '',
  G: '',
  C: '',
  X: '',
  Y: '',
  Z: '',
  S: '',
  E: '',
  P: '',
  T: '',
  Q: '',
  '∞': '',
}
// Números: 0–15 seguidos, 16–20 em outro trecho da fonte
for (let n = 0; n <= 20; n++) GLYPH[String(n)] = String.fromCharCode(n <= 15 ? 0xe605 + n : 0xe62a + n - 16)

/** Cor do círculo (as mesmas do mana-font) */
const FILL: Record<string, string> = {
  W: '#fdfbce',
  U: '#bcdaf7',
  B: '#a7999e',
  R: '#f19b79',
  G: '#9fcba6',
  generic: '#d0c6bb',
}
const COLORS = new Set(['W', 'U', 'B', 'R', 'G'])

/** Símbolo conhecido? (o resto do texto entre chaves sai como texto mesmo) */
export function isSymbol(code: string): boolean {
  const parts = code.toUpperCase().split('/')
  if (parts.length === 1) return parts[0] in GLYPH
  if (parts.length !== 2) return false
  const [a, b] = parts
  return (COLORS.has(a) || a === '2' || a === 'C') && (COLORS.has(b) || b === 'P')
}

/** Largura que o símbolo ocupa numa linha de texto de corpo `size` */
export const symbolWidth = (size: number) => size * 0.98

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
}

function glyph(ctx: CanvasRenderingContext2D, ch: string, cx: number, cy: number, px: number, color = '#111') {
  ctx.fillStyle = color
  ctx.font = `${px}px ${MANA_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(ch, cx, cy + px * 0.04)
}

/**
 * Desenha `{code}` com o centro em (cx, cy) e diâmetro `d`. `shadow`: a sombra preta embaixo à
 * esquerda, como no custo de mana das cartas.
 */
export function drawSymbol(ctx: CanvasRenderingContext2D, code: string, cx: number, cy: number, d: number, shadow = true) {
  const parts = code.toUpperCase().split('/')
  const r = d / 2
  ctx.save()
  // Energia é só o desenho, sem círculo
  if (parts[0] === 'E' && parts.length === 1) {
    glyph(ctx, GLYPH.E, cx, cy, d * 0.95)
    ctx.restore()
    return
  }
  if (shadow) {
    ctx.fillStyle = '#111'
    disc(ctx, cx - d * 0.05, cy + d * 0.06, r)
    ctx.fill()
  }
  if (parts.length === 2 && parts[1] !== 'P') {
    // Híbrido: círculo cortado na diagonal, um símbolo pequeno em cada metade
    const [a, b] = parts
    ctx.save()
    disc(ctx, cx, cy, r)
    ctx.clip()
    ctx.fillStyle = FILL[a] ?? FILL.generic
    ctx.fillRect(cx - r, cy - r, d, d)
    ctx.beginPath()
    ctx.moveTo(cx + r, cy - r)
    ctx.lineTo(cx + r, cy + r)
    ctx.lineTo(cx - r, cy + r)
    ctx.closePath()
    ctx.fillStyle = FILL[b] ?? FILL.generic
    ctx.fill()
    ctx.restore()
    glyph(ctx, GLYPH[a] ?? a, cx - r * 0.38, cy - r * 0.36, d * 0.42)
    glyph(ctx, GLYPH[b] ?? b, cx + r * 0.38, cy + r * 0.36, d * 0.42)
  } else {
    const main = parts[0]
    ctx.fillStyle = FILL[main] ?? FILL.generic
    disc(ctx, cx, cy, r)
    ctx.fill()
    // Phyrexiano: o círculo é da cor, o desenho é o Φ
    glyph(ctx, parts[1] === 'P' ? GLYPH.P : (GLYPH[main] ?? main), cx, cy, d * 0.74)
  }
  if (!shadow) {
    // No texto (sem sombra): contorno fino, senão o {U} some numa caixa azul
    disc(ctx, cx, cy, r)
    ctx.lineWidth = Math.max(0.6, d * 0.06)
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.stroke()
  }
  ctx.restore()
}

/** "{2}{U}{U}" → ["2", "U", "U"] */
export const parseCost = (cost: string) =>
  [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).filter((c) => isSymbol(c))
