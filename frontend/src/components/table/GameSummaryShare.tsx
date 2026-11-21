import { useEffect, useState } from 'react'
import { Copy, Download, Share2, X } from 'lucide-react'
import type { GameSummary } from '../../hooks/useTableSocket'
import { useT } from '../../lib/i18n'

/*
 * Resumo da partida para compartilhar (Discord, Instagram): uma imagem quadrada de 1080 px feita
 * no navegador com o resumo que o servidor monta ao encerrar (Table._summary): comandantes, vida
 * final, vencedor, turnos, duração e a jogada decisiva. Arte que o navegador não pode ler (outro
 * site sem CORS) vira um quadro com o nome, para a imagem não ficar "suja" e poder ser salva.
 */

const SIZE = 1080
const GOLD = '#e8c76a'
const INK = '#14110d'
const PARCHMENT = '#efe6d2'

type Labels = {
  title: string
  won: string
  noWinner: string
  turns: string
  decisive: string
  damage: string
  life: string
  date: string
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
    setTimeout(() => resolve(null), 8000)
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** Carta (ou o quadro com o nome, sem a arte) com cantos arredondados */
function drawCard(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, name: string, x: number, y: number, w: number) {
  const h = Math.round(w * 1.395)
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,.6)'
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 10
  roundRect(ctx, x, y, w, h, w * 0.045)
  ctx.fillStyle = '#2a2219'
  ctx.fill()
  ctx.restore()
  ctx.save()
  roundRect(ctx, x, y, w, h, w * 0.045)
  ctx.clip()
  if (img) ctx.drawImage(img, x, y, w, h)
  else {
    const g = ctx.createLinearGradient(x, y, x, y + h)
    g.addColorStop(0, '#3a2e20')
    g.addColorStop(1, '#1b150f')
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = PARCHMENT
    ctx.textAlign = 'center'
    ctx.font = `600 ${Math.round(w / 9)}px Barlow, sans-serif`
    wrap(ctx, name, x + w / 2, y + h / 2, w - 24, Math.round(w / 8))
  }
  ctx.restore()
  return h
}

function wrap(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, max: number, line: number) {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (ctx.measureText(next).width > max && cur) {
      lines.push(cur)
      cur = w
    } else cur = next
  }
  if (cur) lines.push(cur)
  lines.slice(0, 4).forEach((l, i) => ctx.fillText(l, cx, cy + (i - (Math.min(lines.length, 4) - 1) / 2) * line))
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1)
  return `${s}…`
}

function duration(seconds: number | null): string {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

export async function renderSummary(summary: GameSummary, winner: string | null, labels: Labels): Promise<Blob> {
  await document.fonts?.ready
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  // Fundo
  const bg = ctx.createRadialGradient(SIZE / 2, SIZE * 0.3, 80, SIZE / 2, SIZE / 2, SIZE * 0.85)
  bg.addColorStop(0, '#3a2a16')
  bg.addColorStop(1, INK)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.strokeStyle = 'rgba(232,199,106,.55)'
  ctx.lineWidth = 3
  roundRect(ctx, 24, 24, SIZE - 48, SIZE - 48, 28)
  ctx.stroke()

  const champion = summary.players.find((p) => p.name === winner) ?? null
  const others = summary.players.filter((p) => p !== champion)
  const images = await Promise.all(
    summary.players.map((p) => loadImage(p.commanders[0]?.image ?? '')),
  )
  const imageOf = (p: GameSummary['players'][number]) => images[summary.players.indexOf(p)]
  const decisiveImg = summary.decisive?.image ? await loadImage(summary.decisive.image) : null
  let logo: HTMLImageElement | null = null
  try {
    logo = await loadImage('/logo-mark.webp')
  } catch {
    logo = null
  }

  // Cabeçalho
  ctx.textAlign = 'left'
  if (logo) ctx.drawImage(logo, 64, 58, 56, 56)
  ctx.fillStyle = GOLD
  ctx.font = '700 40px Cinzel, Georgia, serif'
  ctx.fillText('UPKEEPER', logo ? 134 : 64, 100)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(239,230,210,.7)'
  ctx.font = '500 28px Barlow, sans-serif'
  ctx.fillText(`${labels.title} · ${labels.date}`, SIZE - 64, 98)

  // Vencedor
  const cardW = 300
  let y = 150
  if (champion) {
    drawCard(ctx, imageOf(champion), champion.commanders[0]?.name ?? champion.deck, 64, y, cardW)
    ctx.textAlign = 'left'
    const x = 64 + cardW + 48
    ctx.fillStyle = GOLD
    ctx.font = '700 34px Barlow, sans-serif'
    ctx.fillText(`♛ ${labels.won.toUpperCase()}`, x, y + 50)
    ctx.font = '700 92px "Barlow Condensed", sans-serif'
    ctx.fillText(fit(ctx, champion.name, SIZE - x - 64), x, y + 145)
    ctx.fillStyle = PARCHMENT
    ctx.font = '500 34px Barlow, sans-serif'
    const cmd = champion.commanders.map((c) => c.name).join(' + ') || champion.deck
    ctx.fillText(fit(ctx, cmd, SIZE - x - 64), x, y + 200)
    ctx.fillStyle = 'rgba(239,230,210,.75)'
    ctx.font = '500 30px Barlow, sans-serif'
    ctx.fillText(`${labels.life}: ${champion.life}`, x, y + 250)
    const stats = [labels.turns, duration(summary.seconds)].filter(Boolean).join(' · ')
    ctx.fillText(stats, x, y + 295)
    // Jogada decisiva
    if (summary.decisive && (summary.decisive.card || summary.decisive.damage)) {
      const dy = y + 330
      ctx.fillStyle = 'rgba(232,199,106,.12)'
      roundRect(ctx, x - 16, dy, SIZE - x - 48, 116, 16)
      ctx.fill()
      let tx = x
      if (decisiveImg) {
        ctx.save()
        roundRect(ctx, x, dy + 12, 66, 92, 5)
        ctx.clip()
        ctx.drawImage(decisiveImg, x, dy + 12, 66, 92)
        ctx.restore()
        tx = x + 82
      }
      const max = SIZE - tx - 72
      ctx.fillStyle = GOLD
      ctx.font = '700 22px Barlow, sans-serif'
      ctx.fillText(labels.decisive.toUpperCase(), tx, dy + 36)
      // Carta numa linha, dano na outra (sem carta: só o dano, em destaque)
      const [first, second] = summary.decisive.card
        ? [summary.decisive.card, summary.decisive.damage ? labels.damage : '']
        : [labels.damage, '']
      ctx.fillStyle = PARCHMENT
      ctx.font = '600 32px Barlow, sans-serif'
      ctx.fillText(fit(ctx, first, max), tx, dy + 72)
      if (second) {
        ctx.fillStyle = 'rgba(239,230,210,.75)'
        ctx.font = '500 26px Barlow, sans-serif'
        ctx.fillText(fit(ctx, second, max), tx, dy + 102)
      }
    }
    y += Math.round(cardW * 1.395) + 50
  } else {
    ctx.textAlign = 'center'
    ctx.fillStyle = GOLD
    ctx.font = '700 80px "Barlow Condensed", sans-serif'
    ctx.fillText(labels.noWinner, SIZE / 2, y + 120)
    y += 190
  }

  // Os outros jogadores
  const list = champion ? others : summary.players
  if (list.length) {
    const gap = 28
    const w = Math.min(190, Math.floor((SIZE - 128 - gap * (list.length - 1)) / list.length))
    const total = list.length * w + (list.length - 1) * gap
    let x = (SIZE - total) / 2
    const room = SIZE - 70 - y - 80
    const cw = Math.min(w, Math.floor(room / 1.395))
    for (const p of list) {
      const offset = (w - cw) / 2
      const h = drawCard(ctx, imageOf(p), p.commanders[0]?.name ?? p.deck, x + offset, y, cw)
      ctx.textAlign = 'center'
      ctx.fillStyle = PARCHMENT
      ctx.font = '600 28px Barlow, sans-serif'
      ctx.fillText(fit(ctx, p.name, w + gap - 8), x + w / 2, y + h + 36)
      ctx.fillStyle = 'rgba(239,230,210,.65)'
      ctx.font = '500 24px Barlow, sans-serif'
      ctx.fillText(`${labels.life}: ${p.life}`, x + w / 2, y + h + 66)
      x += w + gap
    }
  }

  // Rodapé
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(232,199,106,.8)'
  ctx.font = '600 26px Barlow, sans-serif'
  ctx.fillText('upkeeper.online', SIZE / 2, SIZE - 50)

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/png'))
}

/** Janela com a imagem pronta: baixar, copiar ou compartilhar (celular) */
export default function GameSummaryShare({
  summary,
  winner,
  onClose,
}: {
  summary: GameSummary
  winner: string | null
  onClose: () => void
}) {
  const t = useT()
  const [blob, setBlob] = useState<Blob | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const champion = summary.players.find((p) => p.name === winner)
  const labels: Labels = {
    title: t('Game summary'),
    won: t('Winner'),
    noWinner: t('No winner'),
    turns: t('{n} turns', { n: summary.turns }),
    decisive: t('Decisive play'),
    damage: t('{n} damage in the last turn', { n: summary.decisive?.damage ?? 0 }),
    life: t('Life'),
    date: new Date().toLocaleDateString(),
  }
  const key = JSON.stringify([summary, winner, labels])
  useEffect(() => {
    let alive = true
    let made: string | null = null
    renderSummary(summary, champion ? winner : null, labels).then((b) => {
      if (!alive) return
      made = URL.createObjectURL(b)
      setBlob(b)
      setUrl(made)
    })
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const file = () => new File([blob!], 'upkeeper-partida.png', { type: 'image/png' })
  const canShare = !!blob && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file()] })
  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob! })])
      setNote(t('Image copied: paste it on Discord'))
    } catch {
      setNote(t('Could not copy here: download the image instead'))
    }
  }
  const share = async () => {
    try {
      await navigator.share({ files: [file()], text: 'upkeeper.online' })
    } catch {
      /* cancelou */
    }
  }
  const button = 'inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition hover:border-gold hover:text-gold disabled:opacity-40'
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('Game summary')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-lg flex-col rounded-2xl border border-gold/50 bg-ink p-4 shadow-2xl shadow-black"
      >
        <div className="mb-3 flex items-center">
          <p className="font-semibold text-gold">{t('Share the game summary')}</p>
          <button onClick={onClose} className="ml-auto text-parchment/60 hover:text-gold" aria-label={t('Close')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg bg-black/40">
          {url ? (
            <img src={url} alt={t('Game summary')} className="max-h-[60dvh] w-full object-contain" />
          ) : (
            <p className="py-24 text-sm text-parchment/60">{t('Making the image…')}</p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <a
            href={url ?? undefined}
            download="upkeeper-partida.png"
            className={`${button} ${url ? '' : 'pointer-events-none opacity-40'}`}
          >
            <Download className="h-4 w-4" aria-hidden />
            {t('Download')}
          </a>
          {'ClipboardItem' in window && (
            <button onClick={copy} disabled={!blob} className={button}>
              <Copy className="h-4 w-4" aria-hidden />
              {t('Copy image')}
            </button>
          )}
          {canShare && (
            <button onClick={share} className={button}>
              <Share2 className="h-4 w-4" aria-hidden />
              {t('Share')}
            </button>
          )}
        </div>
        {note && <p className="mt-2 text-center text-xs text-parchment/60">{note}</p>}
      </div>
    </div>
  )
}
