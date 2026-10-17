/*
 * Nome de carta no log e no chat como link: ao passar o mouse, a carta aparece na prévia da mesa e
 * fica destacada onde estiver no campo (como no untap.in). O destaque é uma classe posta direto
 * nos elementos (data-card-id), sem redesenhar a mesa.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import type { LogItem } from '../../hooks/useTableSocket'
import type { CardLookup } from './cardLookup'
import { setHoverPreview } from '../../lib/hoverPreview'

/** Imagem de uma carta pelo nome, direto do Scryfall (carta que não está mais à vista na mesa) */
const scryfallImage = (name: string) =>
  `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`

const PINGED = 'card-pinged'

export function CardLink({ name, refId, lookup }: { name: string; refId?: string; lookup: CardLookup }) {
  const lit = useRef<Element[]>([])
  const clear = () => {
    lit.current.forEach((el) => el.classList.remove(PINGED))
    lit.current = []
  }
  // Saiu da tela com o mouse em cima: nada fica destacado
  useEffect(() => () => lit.current.forEach((el) => el.classList.remove(PINGED)), [])
  const enter = () => {
    const same = lookup.byName.get(name.toLowerCase()) ?? []
    const exact = refId ? lookup.byId.get(refId) : undefined
    const card = exact ?? same[0] ?? { id: `link:${name}`, name, image: scryfallImage(name), back: '' }
    setHoverPreview({ card, side: 'left' })
    // A carta exata do registro; sem ela (chat), todas as cópias com esse nome
    const ids = exact ? [exact.id] : same.map((c) => c.id)
    clear()
    lit.current = ids.flatMap((id) => [...document.querySelectorAll(`[data-card-id="${CSS.escape(id)}"]`)])
    lit.current.forEach((el) => el.classList.add(PINGED))
  }
  const leave = () => {
    clear()
    setHoverPreview(null)
  }
  return (
    <span
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      tabIndex={0}
      className="cursor-help font-semibold text-sky-300 underline decoration-sky-300/40 decoration-dotted underline-offset-2 hover:text-sky-200 focus:outline-none"
    >
      {name}
    </span>
  )
}

/** Frase do log com o nome da carta (o primeiro que aparecer) virando link */
export function LogText({ text, e, lookup }: { text: string; e: LogItem; lookup: CardLookup }): ReactNode {
  const name = e.card
  const at = name ? text.indexOf(name) : -1
  if (!name || at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <CardLink name={name} refId={e.ref} lookup={lookup} />
      {text.slice(at + name.length)}
    </>
  )
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Mensagem do chat com links: [[Nome da carta]] (qualquer carta) e o nome de cartas que estão à
 * vista na mesa (com pelo menos 4 letras, para "Ox" não virar link no meio de uma palavra).
 */
export function ChatText({ text, lookup }: { text: string; lookup: CardLookup }): ReactNode {
  const names = [...lookup.byName.values()]
    .map((cards) => cards[0].name)
    .filter((n) => n.length >= 4)
    .sort((a, b) => b.length - a.length)
  const parts = [String.raw`\[\[([^\]]{2,80})\]\]`, ...names.map((n) => `(?<![\\w'])${escapeRe(n)}(?![\\w'])`)]
  const re = new RegExp(parts.join('|'), 'gi')
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const bracket = m[1]
    const name = bracket ? bracket.trim() : (names.find((n) => n.toLowerCase() === m[0].toLowerCase()) ?? m[0])
    out.push(<CardLink key={at} name={name} lookup={lookup} />)
    last = at + m[0].length
  }
  if (!out.length) return text
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}
