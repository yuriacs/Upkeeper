import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Images, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, isTransient } from '../../lib/api'
import { matchArtFiles, splitCopies, type ArtMatch } from '../../lib/batchArts'
import type { BuilderDeck } from '../../lib/deckbuilder'
import { useT } from '../../lib/i18n'
import type { DeckArts } from '../../lib/types'

type Use = { file: File; asked: number; copies: number }
/** `back`: imagem do verso (cartas de duas faces), se veio uma com [verso] no nome */
type Plan = ArtMatch & { uses: Use[]; back?: File }
type Failure = { name: string; message: string }
type Progress = { sent: number; total: number; card: string; wait: number; cards: number; failures: Failure[] }

/** Espera do limite de envios (429): o DRF diz quantos segundos faltam na mensagem */
const waitSeconds = (err: ApiError) => Math.min(3600, Number(err.message.match(/(\d+)/)?.[1] ?? 60) + 1)

type Hooks = {
  stopped: () => boolean
  stop: () => void
  progress: (patch: Partial<Progress>) => void
  errorText: (err: unknown) => string
  onCard: (res: DeckArts) => void
}

/** Tenta de novo quando o servidor pede para esperar (429) ou está fora do ar por um momento */
async function retrying<T>(fn: () => Promise<T>, hooks: Hooks): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (hooks.stopped() || !isTransient(err) || attempt >= 20) throw err
      const apiErr = err as ApiError
      const wait = apiErr.status === 429 ? waitSeconds(apiErr) : Math.min(60, 5 * (attempt + 1))
      for (let s = wait; s > 0 && !hooks.stopped(); s--) {
        hooks.progress({ wait: s })
        await new Promise((r) => setTimeout(r, 1000))
      }
      hooks.progress({ wait: 0 })
      if (hooks.stopped()) throw err
    }
  }
}

/**
 * Envia as imagens de cada carta, uma por vez, e grava as artes da carta no deck (uma por grupo de
 * cópias) assim que as dela terminam: se parar no meio, o que já foi fica no deck.
 */
async function sendPlan(plan: Plan[], deckId: string, hooks: Hooks): Promise<void> {
  const failures: Failure[] = []
  let sent = 0
  let cards = 0
  const fail = (name: string, err: unknown) => {
    failures.push({ name, message: hooks.errorText(err) })
    hooks.progress({ failures: [...failures] })
  }
  for (const p of plan) {
    if (hooks.stopped()) break
    const arts: { art: string; copies: number }[] = []
    for (const u of p.uses) {
      if (hooks.stopped()) break
      hooks.progress({ card: p.card.name })
      try {
        const art = await retrying(() => api.uploadCardArt(u.file, p.card.oracleId), hooks)
        arts.push({ art: art.id, copies: u.asked })
      } catch (err) {
        fail(u.file.name, err)
        const code = err instanceof ApiError ? err.message : ''
        if (code === 'too_many' || code === 'uploads_blocked') hooks.stop()
      }
      sent += 1
      hooks.progress({ sent })
    }
    if (arts.length) {
      try {
        hooks.onCard(await retrying(() => api.setDeckCardArts(deckId, p.card.oracleId, arts), hooks))
        cards += 1
        hooks.progress({ cards })
      } catch (err) {
        fail(p.card.name, err)
      }
    }
    // Verso da carta de duas faces: uma arte só
    const backFile = p.back
    if (!backFile || hooks.stopped()) continue
    try {
      const art = await retrying(() => api.uploadCardArt(backFile, p.card.oracleId, 'back'), hooks)
      hooks.onCard(await retrying(() => api.setDeckCardArt(deckId, p.card.oracleId, art.id, 'back'), hooks))
      if (!arts.length) {
        cards += 1
        hooks.progress({ cards })
      }
    } catch (err) {
      fail(backFile.name, err)
    }
    sent += 1
    hooks.progress({ sent })
  }
}

/**
 * Artes em lote: escolhe várias imagens (uma pasta inteira) e cada uma vira a arte personalizada da
 * carta do deck com o mesmo nome (lib/batchArts.ts). Uma carta com várias imagens ganha uma arte por
 * cópia ("[x3]" no nome diz quantas cópias). Envia uma imagem por vez, esperando quando o servidor
 * pede (limite de envios por hora) e tentando de novo se o servidor estiver acordando.
 */
export default function BatchArtDialog({
  deckId,
  deck,
  onDone,
  onClose,
}: {
  deckId: string
  deck: BuilderDeck
  onDone: (res: DeckArts) => void
  onClose: () => void
}) {
  const t = useT()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const stop = useRef(false)
  const [picked, setPicked] = useState<{ matches: ArtMatch[]; unmatched: File[] } | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [finished, setFinished] = useState(false)
  const [dragging, setDragging] = useState(false)
  const quota = useQuery({ queryKey: ['my-card-arts'], queryFn: api.myCardArts })
  const running = !!progress && !finished

  // Quantas cópias cada imagem ganha; imagens além das cópias do deck ficam de fora
  const plan: Plan[] = useMemo(
    () =>
      (picked?.matches ?? []).map((m) => {
        const fronts = m.files.filter((f) => f.face === 'front')
        const asked = fronts.map((f) => f.copies ?? 1)
        const got = splitCopies(asked, m.qty)
        const uses = fronts.map((f, i) => ({ file: f.file, asked: asked[i], copies: got[i] })).filter((u) => u.copies > 0)
        return { ...m, uses, back: m.files.find((f) => f.face === 'back')?.file }
      }),
    [picked],
  )
  const total = plan.reduce((n, p) => n + p.uses.length + (p.back ? 1 : 0), 0)
  const left = quota.data ? Math.max(0, quota.data.max - quota.data.arts.length) : null
  const thumbs = useMemo(
    () => new Map(plan.flatMap((p) => [...p.uses.map((u) => u.file), ...(p.back ? [p.back] : [])].map((f) => [f, URL.createObjectURL(f)] as const))),
    [plan],
  )
  useEffect(() => () => thumbs.forEach((url) => URL.revokeObjectURL(url)), [thumbs])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !running && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose, running])
  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  const pick = (files: FileList | File[] | null) => {
    const images = [...(files ?? [])].filter((f) => f.type.startsWith('image/'))
    if (images.length) setPicked(matchArtFiles(images, deck))
  }

  const errorText = (err: unknown) => {
    const code = err instanceof ApiError ? err.message : ''
    return (
      {
        not_image: t('That file is not an image we can use (JPG, PNG, WebP or GIF).'),
        too_big: t('Image too large (up to 6 MB).'),
        too_many: t('You reached the limit of uploaded arts. Delete one to send another.'),
        uploads_blocked: t('An admin blocked image uploads from this account after a report.'),
      } as Record<string, string>
    )[code] ?? (err instanceof Error ? err.message : String(err))
  }

  const send = async () => {
    stop.current = false
    setProgress({ sent: 0, total, card: '', wait: 0, cards: 0, failures: [] })
    await sendPlan(plan, deckId, {
      stopped: () => stop.current,
      stop: () => (stop.current = true),
      progress: (patch) => setProgress((p) => p && { ...p, ...patch }),
      errorText,
      onCard: onDone,
    })
    queryClient.invalidateQueries({ queryKey: ['card-arts'] })
    queryClient.invalidateQueries({ queryKey: ['my-card-arts'] })
    setFinished(true)
  }

  const cardsWithout = deck.commanders.length + deck.cards.length - plan.length

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={() => !running && onClose()}>
      <div
        role="dialog"
        aria-label={t('Arts in batch')}
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          if (progress) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (progress) return
          e.preventDefault()
          setDragging(false)
          pick(e.dataTransfer.files)
        }}
        className={`flex max-h-[90dvh] w-full max-w-3xl flex-col rounded-xl border bg-ink ${dragging ? 'border-gold' : 'border-line'}`}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-2xl">{t('Arts in batch')}</h2>
          <button
            onClick={() => (running ? (stop.current = true) : onClose())}
            aria-label={running ? t('Stop') : t('Close')}
            title={running ? t('Stop after the current image') : t('Close')}
            className="ml-auto rounded p-1 text-parchment/60 hover:text-parchment"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 space-y-4 overflow-y-auto p-4">
          <input
            ref={input}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              pick(e.target.files)
              e.target.value = ''
            }}
          />

          {!progress && (
            <>
              <p className="text-sm text-parchment/70">
                {t('Pick many images at once (a whole folder, Ctrl+A). Each one becomes the custom art of the card with the same name in the file: “001 - Sol Ring (Behelit).png” goes on Sol Ring.')}{' '}
                {t('Several images of the same card become one art per copy; “[x3]” in the name says how many copies get it.')}{' '}
                {t('For the back of a double-faced card, put “[verso]” in the name.')}
              </p>
              <button
                onClick={() => input.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-ink hover:brightness-110"
              >
                <Images className="h-4 w-4" aria-hidden />
                {picked ? t('Choose other images') : t('Choose images')}
              </button>
              {!picked && <p className="text-xs text-parchment/45">{t('You can also drop the images here.')}</p>}
            </>
          )}

          {picked && !progress && (
            <div className="space-y-3">
              <p className="text-sm">
                {t('{images} images for {cards} cards of the deck.', { images: total, cards: plan.length })}{' '}
                <span className="text-parchment/55">{t('Cards that already have custom art get these instead.')}</span>
              </p>
              {left !== null && total > left && (
                <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-2 text-xs text-amber-200">
                  {t('Your account can still upload {left} arts (limit {max}): the rest will be left out.', { left, max: quota.data!.max })}
                </p>
              )}
              <ul className="divide-y divide-line rounded-lg border border-line">
                {plan.map((p) => (
                  <li key={p.card.oracleId} className="flex items-center gap-3 px-2 py-1.5">
                    <div className="flex shrink-0 -space-x-5">
                      {[...p.uses.map((u) => u.file), ...(p.back ? [p.back] : [])].slice(0, 6).map((f) => (
                        <img key={f.name} src={thumbs.get(f)} alt="" className="h-12 w-[2.15rem] rounded object-cover ring-1 ring-ink" />
                      ))}
                    </div>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {p.card.name}
                      {p.back && <span className="ml-1.5 text-xs text-gold">{p.uses.length ? t('+ back') : t('back')}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-parchment/55 tabular-nums">
                      {p.uses.length > 1
                        ? t('{n} arts: {split}', { n: p.uses.length, split: p.uses.map((u) => u.copies).join(' + ') })
                        : p.qty > 1
                          ? t('{n} copies', { n: p.qty })
                          : ''}
                    </span>
                  </li>
                ))}
              </ul>
              {picked.unmatched.length > 0 && (
                <details className="text-xs text-parchment/60">
                  <summary className="cursor-pointer">
                    {t('{n} images without a card in this deck (left out)', { n: picked.unmatched.length })}
                  </summary>
                  <ul className="mt-1 list-inside list-disc text-parchment/45">
                    {picked.unmatched.map((f) => (
                      <li key={f.name}>{f.name}</li>
                    ))}
                  </ul>
                </details>
              )}
              {cardsWithout > 0 && plan.length > 0 && (
                <p className="text-xs text-parchment/45">{t('{n} cards of the deck have no image here and stay as they are.', { n: cardsWithout })}</p>
              )}
              <button
                onClick={send}
                disabled={!total}
                className="font-display w-full rounded-md btn-ember px-5 py-2.5 text-xl tracking-wide text-ink transition hover:brightness-110 disabled:opacity-40"
              >
                {t('Send {n} images', { n: total })}
              </button>
              <p className="text-xs text-parchment/45">{t('Arts you upload stay available to everyone for this card.')}</p>
            </div>
          )}

          {progress && (
            <div className="space-y-3">
              <div className="h-2 overflow-hidden rounded-full bg-surface">
                <div className="h-full bg-gold transition-all" style={{ width: `${(100 * progress.sent) / Math.max(1, progress.total)}%` }} />
              </div>
              <p className="text-sm tabular-nums">
                {finished
                  ? t('Done: {cards} cards with new art.', { cards: progress.cards })
                  : t('Sending {sent} of {total}… {card}', { sent: Math.min(progress.sent + 1, progress.total), total: progress.total, card: progress.card })}
              </p>
              {!finished && progress.wait > 0 && (
                <p className="text-xs text-amber-200">{t('The server asked to wait (upload limit): continuing in {s} s.', { s: progress.wait })}</p>
              )}
              {!finished && <p className="text-xs text-parchment/45">{t('Keep this page open until it finishes.')}</p>}
              {progress.failures.length > 0 && (
                <ul className="space-y-0.5 rounded-lg border border-red-400/30 bg-red-400/5 p-2 text-xs text-red-300">
                  {progress.failures.map((f, i) => (
                    <li key={i}>
                      {f.name}: {f.message}
                    </li>
                  ))}
                </ul>
              )}
              {running ? (
                <button
                  onClick={() => (stop.current = true)}
                  className="rounded-md border border-line px-3 py-1.5 text-sm text-parchment/80 hover:border-parchment/40"
                >
                  {t('Stop after the current image')}
                </button>
              ) : (
                <button onClick={onClose} className="rounded-md bg-gold px-4 py-1.5 text-sm font-semibold text-ink hover:brightness-110">
                  {t('Close')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
