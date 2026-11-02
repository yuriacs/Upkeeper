import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { ZoneName } from '../../hooks/useTableSocket'

/**
 * Arraste das cartas com pointer events (sem o drag-and-drop nativo do HTML5).
 *
 * O arraste nativo do Chrome/Edge no Windows pode travar a sessão de arraste do navegador
 * (por exemplo quando a carta de origem some do DOM no meio do arraste, por uma atualização
 * do servidor): daí nenhuma carta arrasta mais até fechar e abrir o navegador. Aqui o arraste
 * é só JS: uma cópia da carta segue o mouse e, ao soltar, o alvo é achado pelo ponto.
 */

export type DragCard = { id: string; from: ZoneName; attach?: string | null; name?: string }
/** Onde a carta foi solta (o mesmo formato que os alvos liam do DragEvent) */
export type DropPoint = { clientX: number; clientY: number; currentTarget: HTMLElement }

export type DropTarget = {
  /** Aceita esta carta? (senão o alvo de fora tenta) */
  accepts: (card: DragCard) => boolean
  /** Carta passando por cima (null: saiu) */
  over?: (p: DropPoint | null) => void
  drop: (card: DragCard, p: DropPoint) => void
}

// Onde o mouse pegou a carta (para soltar no campo no mesmo ponto), guardado durante o arraste
export const dragInfo = { dx: 0, dy: 0, w: 1 }

const targets = new Map<HTMLElement, { current: DropTarget | null }>()

type Active = {
  card: DragCard
  ghost: HTMLElement
  offX: number
  offY: number
  over: HTMLElement | null
}
let active: Active | null = null
let cleanup: (() => void) | null = null

/** Tem uma carta sendo arrastada (a prévia ao passar o mouse fica quieta) */
export const isDragging = () => active !== null

/** Alvo sob o ponto: o mais de dentro que aceita a carta (como o evento que sobe) */
function targetAt(x: number, y: number, card: DragCard): HTMLElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    let node: HTMLElement | null = el as HTMLElement
    while (node) {
      const t = targets.get(node)?.current
      if (t && t.accepts(card)) return node
      node = node.parentElement
    }
    // Só o elemento de cima conta (como o mouse): o que está por baixo de um diálogo não recebe
    return null
  }
  return null
}

const point = (e: { clientX: number; clientY: number }, el: HTMLElement): DropPoint => ({
  clientX: e.clientX,
  clientY: e.clientY,
  currentTarget: el,
})

function setOver(el: HTMLElement | null, e: { clientX: number; clientY: number }) {
  if (!active) return
  if (active.over && active.over !== el) targets.get(active.over)?.current?.over?.(null)
  active.over = el
  if (el) targets.get(el)?.current?.over?.(point(e, el))
}

function end(drop: { clientX: number; clientY: number } | null) {
  const a = active
  cleanup?.()
  cleanup = null
  active = null
  if (!a) return
  a.ghost.remove()
  document.documentElement.classList.remove('card-dragging')
  if (a.over) targets.get(a.over)?.current?.over?.(null)
  if (!drop) return
  const el = targetAt(drop.clientX, drop.clientY, a.card)
  if (el) targets.get(el)?.current?.drop(a.card, point(drop, el))
}

/** O clique que vem depois de soltar não conta (não limpa a seleção nem abre menu) */
function eatClick() {
  const eat = (c: MouseEvent) => {
    c.stopPropagation()
    c.preventDefault()
  }
  window.addEventListener('click', eat, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 0)
}

/** Cancela um arraste em andamento (Esc, janela perdeu o foco...) */
export const cancelDrag = () => end(null)

/**
 * pointerdown numa carta arrastável: o arraste só começa depois de o mouse andar alguns pixels,
 * para clique, duplo clique e menu continuarem funcionando.
 */
export function startCardDrag(e: ReactPointerEvent<HTMLElement>, card: DragCard, onStart?: () => void) {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return
  end(null) // qualquer resto de um arraste anterior
  const src = e.currentTarget
  const x0 = e.clientX
  const y0 = e.clientY
  const id = e.pointerId
  let started = false

  const begin = (ev: PointerEvent) => {
    started = true
    const r = src.getBoundingClientRect()
    Object.assign(dragInfo, { dx: x0 - r.left, dy: y0 - r.top, w: r.width })
    // Cópia da carta que segue o mouse (independente do React: a original pode sumir)
    const ghost = src.cloneNode(true) as HTMLElement
    ghost.removeAttribute('data-card-id')
    // A cópia está sem rotação na caixa; a carta virada (90°) ocupa a caixa girada
    const offX = x0 - r.left - (r.width - src.offsetWidth) / 2
    const offY = y0 - r.top - (r.height - src.offsetHeight) / 2
    Object.assign(ghost.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      margin: '0',
      zIndex: '1000',
      pointerEvents: 'none',
      opacity: '0.85',
      transition: 'none',
    })
    document.body.appendChild(ghost)
    document.documentElement.classList.add('card-dragging')
    window.getSelection()?.removeAllRanges()
    active = { card, ghost, offX, offY, over: null }
    onStart?.()
    move(ev)
  }

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    if (!started) {
      if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return
      begin(ev)
      return
    }
    if (!active) return
    const a = active
    // left/top (não transform): a carta virada gira pela classe, e um translate giraria junto
    a.ghost.style.left = `${ev.clientX - a.offX}px`
    a.ghost.style.top = `${ev.clientY - a.offY}px`
    setOver(targetAt(ev.clientX, ev.clientY, a.card), ev)
  }

  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    if (!started) {
      stop()
      return
    }
    eatClick()
    end(ev)
  }
  const cancel = () => (started ? end(null) : stop())
  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && started) {
      ev.stopPropagation()
      end(null)
      // O botão ainda está apertado: o soltar depois do Esc também não vira clique
      window.addEventListener('pointerup', eatClick, { once: true })
    }
  }
  const hidden = () => document.hidden && cancel()

  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('blur', cancel)
    window.removeEventListener('keydown', key, true)
    document.removeEventListener('visibilitychange', hidden)
    if (cleanup === stop) cleanup = null
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('blur', cancel)
  window.addEventListener('keydown', key, true)
  document.addEventListener('visibilitychange', hidden)
  cleanup = stop
}

/** Registra o elemento como alvo de soltar cartas (o alvo é lido sempre atualizado) */
export function useDropTarget(ref: RefObject<HTMLElement | null>, target: DropTarget | null) {
  const latest = useRef(target)
  latest.current = target
  useEffect(() => {
    const el = ref.current
    if (!el) return
    targets.set(el, latest)
    return () => {
      if (targets.get(el) === latest) targets.delete(el)
      if (active?.over === el) active.over = null
    }
  }, [ref])
}
