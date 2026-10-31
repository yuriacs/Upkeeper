/*
 * Campo de cartas do gerador (as que têm de entrar e as que ficam de fora): enquanto a pessoa digita
 * parte do nome, a busca do Scryfall mostra as cartas que cabem nas cores do comandante; a escolhida vira
 * uma etiqueta e o campo fica livre para a próxima.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LoaderCircle, Search, X } from 'lucide-react'
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useDebounce } from '../../hooks/useDebounce'
import { setBuilderHover } from '../../lib/builderHover'
import { NO_PHYREXIAN, searchCards, type BuilderCard } from '../../lib/deckbuilder'
import { MAX_PICKED } from '../../lib/generator'
import { useI18n } from '../../lib/i18n'
import { ManaCost } from '../Mana'

const SHOWN = 8

/** Quem começa com o que foi digitado vem antes; depois quem tem uma palavra começando assim; o resto na ordem de popularidade */
function byPrefix(cards: BuilderCard[], typed: string): BuilderCard[] {
  const q = typed.toLowerCase()
  const rank = (name: string) => {
    const n = name.toLowerCase()
    if (n.startsWith(q)) return 0
    return n.split(/[\s,'/-]+/).some((w) => w.startsWith(q)) ? 1 : 2
  }
  return [...cards].sort((a, b) => rank(a.name) - rank(b.name))
}

export function CardPicker({
  label,
  names,
  onChange,
  identity,
  tone,
}: {
  label: string
  names: string[]
  onChange: (next: string[]) => void
  /** Cores do comandante (WUBRG); null = sem comandante ainda, qualquer carta */
  identity: string[] | null
  /** Etiquetas verdes (entram) ou vermelhas (ficam de fora) */
  tone: 'in' | 'out'
}) {
  const { t } = useI18n()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const typed = useDebounce(text.trim(), 250)
  const words = typed
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, ''))
    .filter(Boolean)
  const colors = identity === null ? '' : ` id<=${identity.join('').toLowerCase() || 'c'}`
  const search = useQuery({
    queryKey: ['gen-card-picker', words.join(' '), colors],
    queryFn: ({ signal }) =>
      searchCards(`${words.map((w) => `name:${w}`).join(' ')} legal:commander game:paper${colors} prefer:usd-low ${NO_PHYREXIAN}`, signal),
    enabled: words.join('').length >= 2,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
  const taken = useMemo(() => new Set(names.map((n) => n.toLowerCase())), [names])
  const options = useMemo(
    () => byPrefix(search.data?.cards ?? [], typed).filter((c) => !taken.has(c.name.toLowerCase())).slice(0, SHOWN),
    [search.data, typed, taken],
  )
  const full = names.length >= MAX_PICKED
  // A lista ainda é da busca anterior (a pessoa continua digitando, ou a resposta não chegou): aparece
  // esmaecida e o Enter não escolhe nada, para não pegar uma carta que não é a que está sendo digitada
  const fresh = typed === text.trim() && !search.isPlaceholderData
  const listOpen = open && !full && text.trim().length >= 2 && words.join('').length >= 2

  const pick = (card: BuilderCard) => {
    if (full || taken.has(card.name.toLowerCase())) return
    onChange([...names, card.name])
    setBuilderHover(null)
    setText('')
    setActive(0)
    input.current?.focus()
  }
  const remove = (name: string) => onChange(names.filter((n) => n !== name))
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      // Enter escolhe a carta marcada na lista (e não envia nada)
      e.preventDefault()
      if (listOpen && fresh && options[active]) pick(options[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'Backspace' && !text && names.length) {
      remove(names[names.length - 1])
    }
  }

  const chip =
    tone === 'in'
      ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100'
      : 'border-red-400/40 bg-red-400/10 text-red-100 line-through decoration-red-300/60'
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-semibold tracking-wide text-gold uppercase">
        {label}
      </label>
      <div className="rounded-lg border border-line bg-surface transition focus-within:border-gold">
        {names.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 px-2 pt-2">
            {names.map((n) => (
              <li key={n} className={`inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 text-xs ${chip}`}>
                <span className="truncate">{n}</span>
                <button
                  type="button"
                  onClick={() => remove(n)}
                  aria-label={t('Remove {name}', { name: n })}
                  title={t('Remove {name}', { name: n })}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-parchment/70 no-underline hover:bg-ink/60 hover:text-parchment"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-parchment/40" aria-hidden />
          <input
            id={id}
            ref={input}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setOpen(true)
              setActive(0)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setOpen(false)
              setBuilderHover(null)
            }}
            onKeyDown={onKeyDown}
            disabled={full}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listOpen}
            aria-controls={`${id}-list`}
            aria-activedescendant={listOpen && options[active] ? `${id}-${active}` : undefined}
            placeholder={full ? t('Limit of {n} cards reached', { n: MAX_PICKED }) : t('Type part of a card name (e.g. Ked)')}
            autoComplete="off"
            className="w-full bg-transparent py-2.5 pr-9 pl-9 text-sm placeholder:text-parchment/35 focus:outline-none disabled:opacity-50"
          />
          {search.isFetching && listOpen && (
            <LoaderCircle className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin text-parchment/40" aria-hidden />
          )}
          {listOpen && (
            <ul
              id={`${id}-list`}
              role="listbox"
              aria-label={label}
              className={`absolute top-full right-0 left-0 z-20 mt-1 max-h-96 overflow-y-auto rounded-lg border border-line bg-ink/95 py-1 shadow-xl shadow-black/60 backdrop-blur-md transition-opacity ${
                fresh ? '' : 'opacity-60'
              }`}
            >
              {options.map((c, i) => (
                <li
                  key={c.id}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  // mousedown (e não click): escolhe antes de o campo perder o foco e a lista fechar
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(c)
                  }}
                  onMouseEnter={() => {
                    setActive(i)
                    setBuilderHover(c)
                  }}
                  onMouseLeave={() => setBuilderHover(null)}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm ${
                    i === active ? 'bg-gold/15 text-gold' : 'text-parchment/85'
                  }`}
                >
                  <img src={c.small} alt="" loading="lazy" className="h-10 w-7 shrink-0 rounded-sm bg-surface object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{c.name}</span>
                    <span className="block truncate text-xs text-parchment/45">{c.typeLine}</span>
                  </span>
                  <ManaCost cost={c.manaCost} />
                </li>
              ))}
              {!options.length && (
                <li className="px-3 py-2 text-sm text-parchment/50">
                  {fresh && !search.isFetching ? t('No cards found.') : t('Loading…')}
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
