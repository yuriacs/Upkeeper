import { useEffect, useRef } from 'react'
import type { HoverTarget } from '../components/table/tableUtils'
import type { TableAction, TablePlayer, ZoneName } from './useTableSocket'

type Handlers = {
  send: (a: TableAction) => void
  me: TablePlayer | null
  hovered: () => HoverTarget | null
  /** A carta saiu de baixo do mouse (foi movida): o próximo atalho não deve mirar nela */
  clearHover: () => void
  openTokens: () => void
  openHelp: () => void
  peek: (n: number | null) => void
}

// Atalho com a carta sob o mouse → zona de destino
type Move = { to: ZoneName; position?: 'top' | 'bottom' }
const MOVE_KEYS: Record<string, Move> = {
  KeyD: { to: 'graveyard' },
  KeyS: { to: 'exile' },
  KeyP: { to: 'facedown' },
  KeyR: { to: 'hand' },
  KeyT: { to: 'library', position: 'top' },
  KeyY: { to: 'library', position: 'bottom' },
}

/**
 * Atalhos de teclado da mesa (no estilo do untap.in). Usa `event.code`, então funciona igual em
 * teclado ABNT2 e americano. Um número digitado antes vale como quantidade (3 e C compra 3).
 */
export function useTableHotkeys(handlers: Handlers) {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })

  useEffect(() => {
    let digits = ''
    let digitsAt = 0
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
      if (document.querySelector('[role="dialog"]')) return // com uma janela aberta, o teclado é dela
      const h = ref.current
      if (e.key === '?') {
        h.openHelp()
        return
      }
      if (/^Digit\d$/.test(e.code) && !e.shiftKey) {
        digits = (Date.now() - digitsAt < 1500 ? digits : '') + e.code.slice(5)
        digitsAt = Date.now()
        return
      }
      const n = digits && Date.now() - digitsAt < 1500 ? Math.max(1, Math.min(20, Number(digits))) : null
      digits = ''
      if (!h.me) return
      const hasDeck = !!h.me.deck
      const card = h.hovered()
      const send = h.send
      let handled = true

      if (
        card?.mine &&
        (e.code === 'Space' ||
          MOVE_KEYS[e.code] ||
          ['KeyK', 'KeyU'].includes(e.code) ||
          (e.code === 'KeyE' && e.shiftKey))
      ) {
        const id = card.card.id
        if (e.code === 'Space') {
          if (card.zone === 'battlefield') send({ type: 'tap', card: id })
          else {
            send({ type: 'move', card: id, to: 'battlefield', x: 0.3 + Math.random() * 0.4, y: 0.55 })
            h.clearHover()
          }
        } else if (MOVE_KEYS[e.code]) {
          const { to, position } = MOVE_KEYS[e.code]
          if (to !== card.zone || to === 'library') send({ type: 'move', card: id, to, position })
          h.clearHover()
        } else if (e.code === 'KeyK' && card.zone === 'battlefield') send({ type: 'clone', card: id })
        else if (e.code === 'KeyU' && card.zone === 'battlefield')
          send({ type: 'counter', card: id, kind: '+1/+1', delta: e.shiftKey ? -1 : 1 })
        else if (e.code === 'KeyE' && card.zone !== 'battlefield') send({ type: 'reveal', card: id })
      } else if (e.code === 'KeyE' && !e.shiftKey) send({ type: 'pass_turn' })
      else if (e.code === 'KeyX' && hasDeck) {
        send({ type: 'untap_all' })
        if (e.shiftKey) send({ type: 'draw', n: 1 })
      } else if (e.code === 'KeyC' && e.shiftKey) send({ type: 'roll', sides: 2 })
      else if (e.code === 'KeyC' && hasDeck) send({ type: 'draw', n: n ?? 1 })
      else if (e.code === 'KeyV' && hasDeck) send({ type: 'shuffle' })
      else if (e.code === 'KeyM' && hasDeck) send({ type: 'mulligan' })
      else if (e.code === 'KeyB') document.getElementById('table-chat')?.focus()
      else if (e.code === 'KeyW') h.openTokens()
      else if (e.code === 'KeyF' && hasDeck) h.peek(null)
      else if (e.code === 'KeyG' && hasDeck) h.peek(n ?? 3)
      else if (e.code === 'Backquote') send({ type: 'roll', sides: e.shiftKey ? 20 : 6 })
      else handled = false
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
