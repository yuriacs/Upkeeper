import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../lib/i18n'
import { readJSON, writeJSON } from '../../lib/storage'
import type { Playstyle } from '../../lib/types'
import { PLAYSTYLES, playstyleLabel, playstyleText } from '../../lib/playstyles'

/** O que vai para o servidor ao abrir a mesa (backend: tables/state.py, table_setup) */
export type TableSetup = {
  title: string
  style: Playstyle
  players: 2 | 4
  friends_only: boolean
  allow_watch: boolean
}

const KEY = 'precon-draft:new-table'
const DEFAULT: TableSetup = { title: '', style: 'relaxed', players: 4, friends_only: false, allow_watch: true }
/**
 * Nova mesa (no estilo do untap.in, mais simples): título, estilo de jogo, um contra um ou
 * 3 ou mais jogadores, só amigos e espectadores. As escolhas ficam guardadas neste navegador.
 */
export default function NewTableDialog({
  onStart,
  onClose,
}: {
  onStart: (setup: TableSetup) => void
  onClose: () => void
}) {
  const t = useT()
  const [setup, setSetup] = useState<TableSetup>(() => {
    const saved = readJSON<Partial<TableSetup>>(KEY, {})
    return {
      ...DEFAULT,
      ...saved,
      title: '',
      style: PLAYSTYLES.includes(saved.style as Playstyle) ? (saved.style as Playstyle) : DEFAULT.style,
      players: saved.players === 2 ? 2 : 4,
    }
  })
  const set = (patch: Partial<TableSetup>) => setSetup((s) => ({ ...s, ...patch }))
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const start = () => {
    writeJSON(KEY, { ...setup, title: '' })
    onStart({ ...setup, title: setup.title.trim() })
  }
  const seg = (active: boolean) =>
    `flex-1 px-3 py-2 text-sm font-semibold transition ${
      active ? 'bg-gold text-ink' : 'text-parchment/70 hover:bg-parchment/10 hover:text-parchment'
    }`
  const label = 'text-xs font-semibold tracking-wide text-parchment/60 uppercase'

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-label={t('New table')}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          start()
        }}
        className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-y-auto rounded-xl border border-line bg-ink"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 className="font-display text-3xl">{t('New table')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-parchment/60 hover:text-gold"
            aria-label={t('Close')}
          >
            ✕
          </button>
        </div>

        <div className="space-y-6 px-5 py-5">
          <label className="block space-y-1.5">
            <span className={label}>{t('Table name (optional)')}</span>
            <input
              autoFocus
              value={setup.title}
              onChange={(e) => set({ title: e.target.value.slice(0, 60) })}
              maxLength={60}
              placeholder={t('e.g. Friday night Commander')}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 focus:border-gold focus:outline-none"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className={label}>{t('Playstyle')}</legend>
            <div className="flex flex-wrap overflow-hidden rounded-md border border-line sm:flex-nowrap">
              {PLAYSTYLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={setup.style === s}
                  onClick={() => set({ style: s })}
                  className={seg(setup.style === s)}
                >
                  {playstyleLabel(t, s)}
                </button>
              ))}
            </div>
            <p className="text-sm text-parchment/60">{playstyleText(t, setup.style)}</p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className={label}>{t('Players')}</legend>
            <div className="flex overflow-hidden rounded-md border border-line">
              <button type="button" aria-pressed={setup.players === 2} onClick={() => set({ players: 2 })} className={seg(setup.players === 2)}>
                2
              </button>
              <button type="button" aria-pressed={setup.players === 4} onClick={() => set({ players: 4 })} className={seg(setup.players === 4)}>
                3+
              </button>
            </div>
            <p className="text-sm text-parchment/60">
              {setup.players === 2
                ? t('One against one.')
                : t('Up to 4. The game starts with whoever is seated: no need to wait for a 4th player.')}{' '}
              {t('After the first turn, newcomers can only watch.')}
            </p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className={label}>{t('Options')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <Switch
                label={t('Friends only')}
                checked={setup.friends_only}
                onChange={(v) => set({ friends_only: v })}
              />
              <Switch
                label={t('Allow spectators')}
                checked={setup.allow_watch}
                onChange={(v) => set({ allow_watch: v })}
              />
            </div>
            {setup.friends_only && (
              <p className="text-sm text-parchment/60">
                {t(
                  'Only your friends can sit down. Friends of any player at the table can watch, and the table is hidden from everyone else.',
                )}{' '}
                <Link to="/amigos" className="text-gold underline hover:brightness-110">
                  {t('Manage friends')}
                </Link>
              </p>
            )}
          </fieldset>
        </div>

        <div className="border-t border-line px-5 py-4">
          <button className="font-display w-full rounded-md bg-gold px-5 py-3 text-xl tracking-wide text-ink transition hover:brightness-110">
            {t('Open table')}
          </button>
        </div>
      </form>
    </div>
  )
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-sm transition hover:border-parchment/30"
    >
      <span>{label}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-gold' : 'bg-parchment/20'}`}>
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink transition-all ${checked ? 'left-[1.125rem]' : 'left-0.5'}`}
        />
      </span>
    </button>
  )
}
