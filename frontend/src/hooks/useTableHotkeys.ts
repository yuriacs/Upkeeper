import { useEffect, useRef } from 'react'
import { pointer, type HoverTarget, type PickMode } from '../components/table/tableUtils'
import type { EachAction, TableAction, TableCard, TablePlayer, ZoneName } from './useTableSocket'

type Handlers = {
  send: (a: TableAction) => void
  me: TablePlayer | null
  hovered: () => HoverTarget | null
  /** A carta saiu de baixo do mouse (foi movida): o próximo atalho não deve mirar nela */
  clearHover: () => void
  openTokens: () => void
  openHelp: () => void
  peek: (n: number | null) => void
  startPick: (mode: PickMode, card: TableCard) => void
  /** Cartas selecionadas e o que fazer com elas */
  selection: () => string[]
  onSelection: (action: 'tap' | ZoneName, position?: 'top' | 'bottom') => void
  clearSelection: () => void
  /** Abre o menu da carta já no campo da nota */
  openNote: (card: TableCard) => void
  /** Passar a vez (mostra antes os lembretes da etapa final, se houver) */
  passTurn: () => void
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

const FIELD_KEYS = ['Space', 'KeyH', 'KeyI', 'KeyJ', 'KeyL', 'KeyK', 'KeyO', 'KeyU', 'KeyN']
const fieldKey = (e: KeyboardEvent) => FIELD_KEYS.includes(e.code) || (!!MOVE_KEYS[e.code] && !e.shiftKey)

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
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
      // Ctrl+Z (Cmd+Z no Mac): desfazer a sua última ação (os outros jogadores aprovam)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyZ') {
        if (!document.querySelector('[role="dialog"]') && ref.current.me) {
          e.preventDefault()
          ref.current.send({ type: 'undo' })
        }
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      // Com uma janela aberta, o teclado é dela. Nas de cartas (cemitério, exílio, grimório), os
      // atalhos de mover valem para a carta sob o mouse lá dentro
      const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      const inZone = dialogs.length > 0 && dialogs.every((d) => d.hasAttribute('data-card-keys'))
      if (dialogs.length && !inZone) return
      const h = ref.current
      if (inZone) {
        // Confere a carta sob o mouse agora (ela pode ter deslizado para lá sem o mouse se mexer)
        document
          .elementFromPoint(pointer.x, pointer.y)
          ?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: pointer.x, clientY: pointer.y }))
        const hover = h.hovered()
        const key = e.code === 'Space' || (!!MOVE_KEYS[e.code] && !e.shiftKey) || (e.code === 'KeyE' && e.shiftKey)
        if (!h.me || !hover?.mine || hover.zone === 'battlefield' || !key) return
      }
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

      // Várias cartas selecionadas (e o mouse sobre uma delas, ou sobre nada): o atalho vale para todas
      const selection = h.selection()
      if (selection.length && (!card || selection.includes(card.card.id))) {
        const move = MOVE_KEYS[e.code]
        const each = (action: EachAction) => send({ type: 'each', cards: selection, action })
        if (e.code === 'Escape') h.clearSelection()
        else if (e.code === 'Space') h.onSelection('tap')
        else if (move && !e.shiftKey) h.onSelection(move.to, move.position)
        else if (e.code === 'KeyH') each({ type: e.shiftKey ? 'highlight' : 'shake' })
        else if (e.code === 'KeyI') each({ type: 'invert' })
        else if (e.code === 'KeyJ') each({ type: 'face_down' })
        else if (e.code === 'KeyL') each({ type: 'flip' })
        else if (e.code === 'KeyK') each({ type: 'clone' })
        else if (e.code === 'KeyU') each({ type: 'counter', kind: '+1/+1', delta: e.shiftKey ? -1 : 1 })
        else handled = false
        if (handled) {
          e.preventDefault()
          return
        }
        handled = true
      }
      // Carta do campo sob o mouse: os atalhos valem para qualquer carta, sua ou de um oponente
      if (card?.zone === 'battlefield' && fieldKey(e)) {
        const id = card.card.id
        if (e.code === 'Space') send({ type: 'tap', card: id })
        else if (e.code === 'KeyH') send({ type: e.shiftKey ? 'highlight' : 'shake', card: id })
        else if (e.code === 'KeyI') send({ type: 'invert', card: id })
        else if (e.code === 'KeyJ') send({ type: 'face_down', card: id })
        else if (e.code === 'KeyL') send({ type: 'flip', card: id })
        else if (e.code === 'KeyK') send({ type: 'clone', card: id })
        else if (e.code === 'KeyO') h.startPick('target', card.card)
        else if (e.code === 'KeyN') h.openNote(card.card)
        // marcadores: só nas cartas que você controla
        else if (e.code === 'KeyU') {
          if (card.mine) send({ type: 'counter', card: id, kind: '+1/+1', delta: e.shiftKey ? -1 : 1 })
        } else if (MOVE_KEYS[e.code]) {
          const { to, position } = MOVE_KEYS[e.code]
          send({ type: 'move', card: id, to, position })
          h.clearHover()
        }
        e.preventDefault()
        return
      }
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
            send({ type: 'move', card: id, to: 'battlefield' }) // sem ponto: o servidor acha um espaço livre
            h.clearHover()
            if (card.card.attach) h.startPick('attach', card.card) // equipamento/aura: onde prender?
          }
        } else if (MOVE_KEYS[e.code]) {
          const { to, position } = MOVE_KEYS[e.code]
          if (to !== card.zone || to === 'library') send({ type: 'move', card: id, to, position })
          h.clearHover()
        } else if (e.code === 'KeyK' && card.zone === 'battlefield') send({ type: 'clone', card: id })
        else if (e.code === 'KeyU' && card.zone === 'battlefield')
          send({ type: 'counter', card: id, kind: '+1/+1', delta: e.shiftKey ? -1 : 1 })
        else if (e.code === 'KeyE' && card.zone !== 'battlefield') send({ type: 'reveal', card: id })
      } else if (e.code === 'KeyE' && !e.shiftKey) h.passTurn()
      else if (e.code === 'KeyX' && hasDeck) {
        send({ type: 'untap_all' })
        if (e.shiftKey) send({ type: 'draw', n: 1 })
      } else if (e.code === 'KeyA' && hasDeck) send({ type: 'arrange' })
      else if (e.code === 'KeyC' && e.shiftKey) send({ type: 'roll', sides: 2 })
      else if (e.code === 'KeyC' && hasDeck) send({ type: 'draw', n: n ?? 1 })
      else if (e.code === 'KeyV' && hasDeck) send({ type: 'shuffle' })
      else if (e.code === 'KeyM' && hasDeck && h.me?.opening) send({ type: 'mulligan' })
      else if (e.code === 'KeyB') document.getElementById('table-chat')?.focus()
      else if (e.code === 'KeyW') h.openTokens()
      else if (e.code === 'KeyF' && hasDeck) h.peek(null)
      else if (e.code === 'KeyG' && hasDeck) h.peek(n ?? 3)
      else if (e.code === 'Backquote') send({ type: 'roll', sides: e.shiftKey ? 20 : 6 })
      // Do topo do grimório (sem carta sob o mouse): T revela, D mói, S exila, P pilha virada, Z joga
      // T: vira/desvira o topo do grimório (fica revelado até desvirar); com número, revela N uma vez
      else if (e.code === 'KeyT' && hasDeck) send(n ? { type: 'reveal_top', n } : { type: 'top_revealed' })
      else if (e.code === 'KeyD' && hasDeck) send({ type: 'draw_to', n: n ?? 1, to: 'graveyard' })
      else if (e.code === 'KeyS' && hasDeck) send({ type: 'draw_to', n: n ?? 1, to: 'exile' })
      else if (e.code === 'KeyP' && hasDeck)
        send({ type: 'draw_to', n: n ?? 1, to: e.shiftKey ? 'battlefield_down' : 'facedown' })
      else if (e.code === 'KeyZ' && hasDeck) send({ type: 'draw_to', n: n ?? 1, to: 'battlefield' })
      else handled = false
      if (handled) e.preventDefault()
    }
    const track = (e: MouseEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousemove', track, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousemove', track)
    }
  }, [])
}
