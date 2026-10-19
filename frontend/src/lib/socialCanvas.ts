/*
 * Imagens dos posts das redes (painel /painel/social), desenhadas num <canvas> no navegador e
 * exportadas em PNG: carrossel do Instagram (1080×1350) e imagem do X (1200×675). O servidor guarda
 * só a especificação (modelo + dados, backend social/drafts.py); aqui vira imagem, no visual do
 * site: fundo escuro, títulos em Cinzel dourado, arte do comandante e o logo.
 */

export type SlideFormat = 'instagram' | 'x'
export type Slide = { t: string } & Record<string, unknown>

const SIZE: Record<SlideFormat, [number, number]> = { instagram: [1080, 1350], x: [1200, 675] }
const INK = '#09090b'
const GOLD = '#ecb93f'
const TEXT = '#f2f2f0'
const DIM = 'rgba(242,242,240,0.65)'

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

const images = new Map<string, Promise<HTMLImageElement | null>>()
/** Imagem com CORS (para o canvas poder exportar); null se não carregar */
function load(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null)
  if (!images.has(src))
    images.set(
      src,
      new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = src
      }),
    )
  return images.get(src)!
}

async function fonts() {
  await Promise.all(
    ['600 60px Cinzel', '500 30px Barlow', '700 40px "Barlow Condensed"'].map((f) => document.fonts.load(f).catch(() => null)),
  )
}

/** Imagem cobrindo a área (como object-fit: cover) */
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height)
  const sw = w / s
  const sh = h / s
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h)
}

/** Texto quebrado em linhas dentro da largura; devolve o y depois da última linha */
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineH: number, max = 4) {
  const words = text.split(/\s+/)
  let line = ''
  let lines = 0
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > width && line) {
      ctx.fillText(line, x, y)
      y += lineH
      line = w
      if (++lines >= max - 1) break
    } else line = test
  }
  if (line) {
    ctx.fillText(line, x, y)
    y += lineH
  }
  return y
}

/** Texto numa linha só, cortado com "…" se não couber */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1)
  return `${t}…`
}

async function background(ctx: CanvasRenderingContext2D, w: number, h: number, art: string, strength = 0.55) {
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, w, h)
  const img = await load(art)
  if (img) {
    cover(ctx, img, 0, 0, w, h)
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, `rgba(9,9,11,${strength})`)
    g.addColorStop(0.45, `rgba(9,9,11,${strength + 0.1})`)
    g.addColorStop(1, 'rgba(9,9,11,0.97)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
}

async function header(ctx: CanvasRenderingContext2D, w: number, pad: number, kicker: string) {
  const logo = await load('/logo.webp')
  if (logo) {
    const lh = Math.round(w * 0.05)
    ctx.drawImage(logo, pad, pad, (logo.width / logo.height) * lh, lh)
  }
  if (kicker) {
    ctx.font = `600 ${Math.round(w * 0.018)}px Barlow`
    ctx.fillStyle = GOLD
    ctx.textAlign = 'right'
    ctx.fillText(kicker.toUpperCase().split('').join(' '), w - pad, pad + Math.round(w * 0.032))
    ctx.textAlign = 'left'
  }
}

function footer(ctx: CanvasRenderingContext2D, w: number, h: number, pad: number) {
  ctx.font = `600 ${Math.round(w * 0.017)}px Barlow`
  ctx.fillStyle = DIM
  ctx.fillText('UPKEEPER.ONLINE', pad, h - pad)
}

function title(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, width: number) {
  ctx.font = `600 ${size}px Cinzel`
  const g = ctx.createLinearGradient(0, y - size, 0, y)
  g.addColorStop(0, '#ffe39a')
  g.addColorStop(0.6, GOLD)
  g.addColorStop(1, '#b8801c')
  ctx.fillStyle = g
  return wrap(ctx, text.toUpperCase(), x, y, width, size * 1.08, 3)
}

const MANA: Record<string, string> = { W: '#f6e7b0', U: '#3fa2ff', B: '#a070e0', R: '#ff5631', G: '#37c06a', C: '#b9b9c4' }

/** Desenha um slide e devolve o canvas */
export async function renderSlide(slide: Slide, format: SlideFormat): Promise<HTMLCanvasElement> {
  await fonts()
  const [w, h] = SIZE[format]
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const pad = Math.round(w * 0.06)
  const wide = format === 'x'
  const kicker = str(slide.kicker)

  if (slide.t === 'list') {
    ctx.fillStyle = INK
    ctx.fillRect(0, 0, w, h)
    await header(ctx, w, pad, kicker || 'Upkeeper')
    let y = title(ctx, str(slide.title), pad, pad + w * 0.16, Math.round(w * 0.055), w - pad * 2) + w * 0.02
    const rows = (Array.isArray(slide.rows) ? slide.rows : []) as { name: string; image: string; value: string }[]
    const rowH = Math.min((h - y - pad * 1.6) / Math.max(rows.length, 1), w * 0.17)
    for (const [i, r] of rows.entries()) {
      const img = await load(r.image)
      const iw = rowH * 1.35
      ctx.fillStyle = 'rgba(242,242,240,0.05)'
      ctx.fillRect(pad, y, w - pad * 2, rowH - 14)
      if (img) cover(ctx, img, pad, y, iw, rowH - 14)
      ctx.fillStyle = GOLD
      ctx.font = `700 ${Math.round(rowH * 0.42)}px "Barlow Condensed"`
      ctx.fillText(`${i + 1}`, pad + iw + 24, y + rowH * 0.58)
      ctx.fillStyle = TEXT
      ctx.font = `600 ${Math.round(rowH * 0.24)}px Barlow`
      const tx = pad + iw + 24 + rowH * 0.42
      ctx.fillText(fit(ctx, r.name, w - tx - pad - 16), tx, y + rowH * 0.42)
      ctx.fillStyle = DIM
      ctx.font = `500 ${Math.round(rowH * 0.18)}px Barlow`
      ctx.fillText(r.value, tx, y + rowH * 0.7)
      y += rowH
    }
    footer(ctx, w, h, pad)
    return canvas
  }

  if (slide.t === 'precon') {
    await background(ctx, w, h, str(slide.art), 0.35)
    await header(ctx, w, pad, kicker)
    const textW = wide ? w * 0.55 : w - pad * 2
    let y = wide ? h * 0.42 : h * 0.47
    y = title(ctx, str(slide.name), pad, y, Math.round(w * (wide ? 0.05 : 0.07)), textW)
    ctx.font = `500 ${Math.round(w * (wide ? 0.022 : 0.03))}px Barlow`
    ctx.fillStyle = TEXT
    ctx.fillText(fit(ctx, str(slide.commander), textW), pad, y)
    y += w * (wide ? 0.04 : 0.055)
    // Cores, bracket, valor e edição
    let x = pad
    for (const c of str(slide.colors) || 'C') {
      ctx.beginPath()
      ctx.arc(x + 16, y - 10, 16, 0, Math.PI * 2)
      ctx.fillStyle = MANA[c] ?? MANA.C
      ctx.fill()
      x += 42
    }
    ctx.font = `700 ${Math.round(w * (wide ? 0.026 : 0.034))}px "Barlow Condensed"`
    const facts = [slide.bracket ? `B${slide.bracket}` : '', slide.price_usd ? `US$ ${slide.price_usd}` : '', str(slide.edition)]
      .filter(Boolean)
      .join('  ·  ')
    ctx.fillStyle = GOLD
    ctx.fillText(fit(ctx, facts, textW - (x - pad)), x + 10, y)
    // As cartas mais valiosas, em pé
    const cards = (Array.isArray(slide.top_cards) ? slide.top_cards : []) as { name: string; image: string }[]
    const cw = wide ? w * 0.12 : w * 0.26
    const ch = cw * (680 / 488)
    const cy = wide ? h - ch - pad : h - ch - pad * 1.5
    for (const [i, c] of cards.entries()) {
      const img = await load(c.image.replace('/small/', '/normal/'))
      const cx = wide ? w - pad - (cards.length - i) * (cw + 14) : pad + i * (cw + 24)
      if (img) {
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.7)'
        ctx.shadowBlur = 24
        ctx.drawImage(img, cx, cy, cw, ch)
        ctx.restore()
      }
    }
    if (!wide) footer(ctx, w, h, pad * 0.6)
    return canvas
  }

  if (slide.t === 'numbers') {
    await background(ctx, w, h, str(slide.art), 0.7)
    await header(ctx, w, pad, kicker)
    let y = title(ctx, str(slide.title), pad, wide ? h * 0.36 : h * 0.3, Math.round(w * (wide ? 0.05 : 0.07)), w - pad * 2)
    const stats = (Array.isArray(slide.stats) ? slide.stats : []) as { value: number; label: string }[]
    const colW = (w - pad * 2) / Math.max(stats.length, 1)
    y += wide ? h * 0.08 : h * 0.06
    for (const [i, s] of stats.entries()) {
      const x = pad + i * colW
      ctx.fillStyle = TEXT
      ctx.font = `700 ${Math.round(w * (wide ? 0.08 : 0.12))}px "Barlow Condensed"`
      ctx.fillText(String(s.value), x, y)
      ctx.fillStyle = DIM
      ctx.font = `500 ${Math.round(w * (wide ? 0.022 : 0.03))}px Barlow`
      ctx.fillText(s.label, x, y + w * (wide ? 0.035 : 0.05))
    }
    if (slide.highlight) {
      ctx.fillStyle = GOLD
      ctx.font = `600 ${Math.round(w * (wide ? 0.022 : 0.03))}px Barlow`
      ctx.fillText(fit(ctx, `★ ${str(slide.highlight)}`, w - pad * 2), pad, h - pad * (wide ? 1 : 1.8))
    }
    if (!wide) footer(ctx, w, h, pad * 0.6)
    return canvas
  }

  if (slide.t === 'news') {
    ctx.fillStyle = INK
    ctx.fillRect(0, 0, w, h)
    await header(ctx, w, pad, kicker || 'Upkeeper')
    let y = title(ctx, str(slide.title), pad, pad + w * (wide ? 0.13 : 0.18), Math.round(w * (wide ? 0.045 : 0.06)), w - pad * 2)
    y += w * 0.02
    const items = (Array.isArray(slide.items) ? slide.items : []) as string[]
    ctx.font = `500 ${Math.round(w * (wide ? 0.02 : 0.03))}px Barlow`
    const lineH = w * (wide ? 0.03 : 0.043)
    for (const it of items) {
      if (y > h - pad * 2) break
      ctx.fillStyle = GOLD
      ctx.fillText('◆', pad, y)
      ctx.fillStyle = TEXT
      y = wrap(ctx, it, pad + lineH * 0.9, y, w - pad * 2 - lineH, lineH, wide ? 2 : 4) + lineH * 0.4
    }
    footer(ctx, w, h, pad * 0.6)
    return canvas
  }

  // "cover" (e qualquer modelo desconhecido): arte de fundo, título e subtítulo
  await background(ctx, w, h, str(slide.art), 0.45)
  await header(ctx, w, pad, kicker)
  const y = title(ctx, str(slide.title), pad, h * (wide ? 0.55 : 0.62), Math.round(w * (wide ? 0.06 : 0.085)), w - pad * 2)
  ctx.fillStyle = TEXT
  ctx.font = `500 ${Math.round(w * (wide ? 0.024 : 0.034))}px Barlow`
  wrap(ctx, str(slide.subtitle), pad, y + w * 0.01, w - pad * 2, w * (wide ? 0.034 : 0.046), 3)
  footer(ctx, w, h, pad * 0.6)
  return canvas
}

/** PNG do slide para baixar */
export async function slidePng(slide: Slide, format: SlideFormat): Promise<Blob | null> {
  const canvas = await renderSlide(slide, format)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
