import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AudioLines, Headphones, Search, Star, Volume2, VolumeX } from 'lucide-react'
import type { LogItem } from '../../hooks/useTableSocket'
import { api, apiUrl } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { readJSON, writeJSON } from '../../lib/storage'
import { isMuted } from '../../lib/tableSounds'
import { updateTableSettings, useTableSettings } from '../../lib/tableSettings'
import type { SoundClip } from '../../lib/types'
import { useTable } from './tableUtils'

/*
 * Soundboard da mesa (como o do Discord): os sons são fixos, enviados pelo admin. Clicar toca para
 * a mesa toda (ação "sound", que vai para o registro); o fone toca só para você. Cada um muta ou
 * baixa o volume no próprio navegador (configurações da mesa), sem afetar os outros.
 */

const FAV_KEY = 'upkeeper:sound-favorites'
const COOLDOWN = 2000 // o servidor recusa mais de um som a cada 2 s por jogador

const audioCache = new Map<string, HTMLAudioElement>()

/** Toca um som do soundboard aqui (respeitando o mudo e o volume deste navegador) */
export function playClip(url: string, volume: number) {
  try {
    let base = audioCache.get(url)
    if (!base) {
      base = new Audio(apiUrl(url))
      base.preload = 'auto'
      audioCache.set(url, base)
    }
    // Uma cópia por toque: o mesmo som pode tocar por cima dele mesmo
    const a = base.cloneNode(true) as HTMLAudioElement
    a.volume = Math.max(0, Math.min(1, volume))
    void a.play().catch(() => undefined)
  } catch {
    /* navegador sem áudio */
  }
}

export function useSounds() {
  return useQuery({ queryKey: ['sounds'], queryFn: api.sounds, staleTime: 10 * 60_000 })
}

/** Toca os sons do soundboard que chegam pelo registro (de qualquer jogador, inclusive você) */
export function SoundboardPlayer({ log, start }: { log: LogItem[]; start: number | null }) {
  const settings = useTableSettings()
  const sounds = useSounds().data?.sounds
  const last = useRef<number | null>(null)
  useEffect(() => {
    if (start === null) return
    last.current ??= start
    for (const e of log) {
      if ((e.id ?? 0) <= last.current || e.kind !== 'sound') continue
      if (settings.soundboardMuted || isMuted()) continue
      const clip = sounds?.find((s) => s.id === e.sound)
      playClip(clip?.url ?? `/api/sounds/${e.sound}/`, settings.soundboardVolume)
    }
    last.current = Math.max(last.current, log.at(-1)?.id ?? 0)
  }, [log, start, settings.soundboardMuted, settings.soundboardVolume, sounds])
  return null
}

/** Botão da faixa de ferramentas e o painel com os sons */
export function SoundboardButton({ disabled }: { disabled?: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const settings = useTableSettings()
  const wrap = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const muted = settings.soundboardMuted
  return (
    <span ref={wrap} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={open}
        aria-label={t('Soundboard')}
        title={muted ? t('Soundboard (muted for you)') : t('Soundboard')}
        onClick={() => setOpen(!open)}
        className={`relative grid h-8 min-w-8 place-items-center rounded-md border transition disabled:opacity-35 ${
          open ? 'border-gold bg-gold/15 text-gold' : 'border-line text-parchment/80 enabled:hover:border-parchment/40 enabled:hover:bg-parchment/10'
        }`}
      >
        <AudioLines className="h-4 w-4" aria-hidden />
        {muted && <VolumeX className="absolute -right-1 -bottom-1 h-3 w-3 rounded-full bg-ink text-red-300" aria-hidden />}
      </button>
      {open && <SoundboardPanel onPlayed={() => undefined} />}
    </span>
  )
}

function SoundboardPanel({ onPlayed }: { onPlayed: () => void }) {
  const t = useT()
  const { send } = useTable()
  const settings = useTableSettings()
  const { data, isPending, isError } = useSounds()
  const [query, setQuery] = useState('')
  const [favs, setFavs] = useState<string[]>(() => readJSON<string[]>(FAV_KEY, []))
  const [waitUntil, setWaitUntil] = useState(0)
  const [, setTick] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    if (!waitUntil) return
    const id = window.setTimeout(() => setTick((n) => n + 1), Math.max(0, waitUntil - Date.now()) + 20)
    return () => clearTimeout(id)
  }, [waitUntil])
  const cooling = waitUntil > Date.now()
  const sounds = useMemo(() => data?.sounds ?? [], [data])
  const q = query.trim().toLocaleLowerCase()
  const shown = q ? sounds.filter((s) => s.name.toLocaleLowerCase().includes(q)) : sounds
  const favList = q ? [] : sounds.filter((s) => favs.includes(s.id))
  const toggleFav = (id: string) => {
    const next = favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id]
    setFavs(next)
    writeJSON(FAV_KEY, next)
  }
  const play = (s: SoundClip) => {
    if (cooling) return
    send({ type: 'sound', sound: s.id })
    setWaitUntil(Date.now() + COOLDOWN)
    onPlayed()
  }
  const muted = settings.soundboardMuted
  const grid = (list: SoundClip[]) => (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {list.map((s) => (
        <SoundTile
          key={s.id}
          sound={s}
          fav={favs.includes(s.id)}
          cooling={cooling}
          onPlay={() => play(s)}
          onPreview={() => playClip(s.url, settings.soundboardVolume || 0.6)}
          onFav={() => toggleFav(s.id)}
        />
      ))}
    </div>
  )
  return (
    <div
      role="dialog"
      aria-label={t('Soundboard')}
      className="absolute bottom-full left-0 z-[60] mb-2 flex max-h-[min(28rem,70dvh)] w-[min(30rem,calc(100vw-2rem))] flex-col rounded-xl border border-line bg-surface shadow-2xl shadow-black"
    >
      <div className="flex items-center gap-2 border-b border-line p-2.5">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-gold/40 bg-ink px-2.5 py-1.5 focus-within:border-gold">
          <Search className="h-4 w-4 shrink-0 text-parchment/50" aria-hidden />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Find a sound')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-parchment/40"
          />
        </label>
        <button
          type="button"
          onClick={() => updateTableSettings({ soundboardMuted: !muted })}
          aria-pressed={muted}
          title={muted ? t('Unmute the soundboard (only for you)') : t('Mute the soundboard (only for you)')}
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-md border transition ${
            muted ? 'border-red-400/60 bg-red-500/15 text-red-300' : 'border-line text-parchment/80 hover:border-parchment/40'
          }`}
        >
          {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.soundboardVolume}
          disabled={muted}
          onChange={(e) => updateTableSettings({ soundboardVolume: Number(e.target.value) })}
          aria-label={t('Soundboard volume')}
          className="w-20 shrink-0 accent-gold disabled:opacity-40"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
        {muted && (
          <p className="rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200">
            {t('Muted: you don’t hear the sounds, but you can still play them for the others.')}
          </p>
        )}
        {isPending ? (
          <p className="py-6 text-center text-sm text-parchment/50">{t('Loading…')}</p>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-parchment/50">{t('Could not load the sounds.')}</p>
        ) : !sounds.length ? (
          <p className="py-6 text-center text-sm text-parchment/50">{t('No sounds yet.')}</p>
        ) : (
          <>
            {favList.length > 0 && (
              <section>
                <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-parchment/70">
                  <Star className="h-3.5 w-3.5" aria-hidden />
                  {t('Favorites')}
                </p>
                {grid(favList)}
              </section>
            )}
            <section>
              {favList.length > 0 && (
                <p className="mb-1.5 text-xs font-semibold text-parchment/70">{t('All sounds')}</p>
              )}
              {shown.length ? grid(shown) : <p className="py-4 text-center text-sm text-parchment/50">{t('No sound with that name.')}</p>}
            </section>
          </>
        )}
      </div>
      <p className="border-t border-line px-2.5 py-1.5 text-[0.7rem] text-parchment/45">
        {t('Click: plays for the whole table. Headphones: only for you.')}
      </p>
    </div>
  )
}

function SoundTile({
  sound,
  fav,
  cooling,
  onPlay,
  onPreview,
  onFav,
}: {
  sound: SoundClip
  fav: boolean
  cooling: boolean
  onPlay: () => void
  onPreview: () => void
  onFav: () => void
}) {
  const t = useT()
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onPlay}
        disabled={cooling}
        title={sound.name}
        className="flex h-11 w-full items-center justify-center gap-1.5 rounded-md bg-parchment/[0.07] px-2 text-sm font-semibold transition enabled:hover:bg-gold/20 enabled:hover:text-gold disabled:opacity-50"
      >
        {sound.emoji && <span className="shrink-0 text-base leading-none">{sound.emoji}</span>}
        <span className="line-clamp-2 min-w-0 text-left leading-tight break-words">{sound.name}</span>
      </button>
      <span className="absolute top-0.5 right-0.5 hidden gap-0.5 group-focus-within:flex group-hover:flex">
        <button
          type="button"
          onClick={onPreview}
          title={t('Listen only for you')}
          aria-label={t('Listen only for you')}
          className="grid h-5 w-5 place-items-center rounded bg-ink/90 text-parchment/70 hover:text-gold"
        >
          <Headphones className="h-3 w-3" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onFav}
          title={fav ? t('Remove from favorites') : t('Add to favorites')}
          aria-label={fav ? t('Remove from favorites') : t('Add to favorites')}
          className={`grid h-5 w-5 place-items-center rounded bg-ink/90 hover:text-gold ${fav ? 'text-gold' : 'text-parchment/70'}`}
        >
          <Star className="h-3 w-3" fill={fav ? 'currentColor' : 'none'} aria-hidden />
        </button>
      </span>
    </div>
  )
}
