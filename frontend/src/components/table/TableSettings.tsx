import { RotateCcw, X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import type { TableCard } from '../../hooks/useTableSocket'
import { useT } from '../../lib/i18n'
import {
  BOARD_CARD,
  DEFAULT_SETTINGS,
  HAND_CARD,
  resetTableSettings,
  updateTableSettings,
  useTableSettings,
  type PreviewSide,
} from '../../lib/tableSettings'
import { CARD_RATIO } from './tableUtils'

/**
 * Configurações da mesa (deste navegador): tamanho das cartas no campo e na mão, a carta
 * ampliada ao passar o mouse, som, turno automático e acessibilidade. Tudo vale na hora.
 */
export default function TableSettingsDialog({
  sample,
  muted,
  onMuted,
  onClose,
}: {
  /** Carta usada na amostra de tamanho (ex.: o seu comandante) */
  sample: TableCard | null
  muted: boolean
  onMuted: (muted: boolean) => void
  onClose: () => void
}) {
  const t = useT()
  const s = useTableSettings()
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const boardW = Math.round(BOARD_CARD.large * s.boardScale)
  const handW = Math.round(HAND_CARD * s.handScale)
  const pct = (n: number) => `${Math.round(n * 100)}%`

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t('Table settings')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col rounded-xl border border-line bg-ink shadow-2xl shadow-black"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <h2 className="font-display text-2xl">{t('Table settings')}</h2>
          <span className="text-xs text-parchment/40">{t('Saved on this browser')}</span>
          <button
            onClick={onClose}
            aria-label={t('Close')}
            className="ml-auto rounded-md p-1 text-parchment/60 hover:text-gold"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 gap-6 overflow-y-auto p-5 md:grid-cols-[1fr_auto]">
          <div className="space-y-6">
            <Section title={t('Cards')}>
              <Slider
                label={t('Card size on the battlefield')}
                value={s.boardScale}
                min={0.6}
                max={1.6}
                step={0.05}
                shown={`${pct(s.boardScale)} · ${boardW}px`}
                onChange={(v) => updateTableSettings({ boardScale: v })}
              />
              <Slider
                label={t('Card size in your hand')}
                value={s.handScale}
                min={0.7}
                max={1.5}
                step={0.05}
                shown={`${pct(s.handScale)} · ${handW}px`}
                onChange={(v) => updateTableSettings({ handScale: v })}
              />
              <Toggle
                label={t('Show symbols next to cards (flying, deathtouch…)')}
                checked={s.showSymbols}
                onChange={(v) => updateTableSettings({ showSymbols: v })}
              />
              <Toggle
                label={t("Show the player's name in the background of each battlefield")}
                checked={s.showBoardNames}
                onChange={(v) => updateTableSettings({ showBoardNames: v })}
              />
            </Section>

            <Section title={t('Card preview on hover')}>
              <Toggle
                label={t('Show the enlarged card when hovering')}
                checked={s.previewEnabled}
                onChange={(v) => updateTableSettings({ previewEnabled: v })}
              />
              <Slider
                label={t('Preview size')}
                value={s.previewWidth}
                min={180}
                max={440}
                step={10}
                shown={`${s.previewWidth}px`}
                disabled={!s.previewEnabled}
                onChange={(v) => updateTableSettings({ previewWidth: v })}
              />
              <Choice<PreviewSide>
                label={t('Preview position')}
                value={s.previewSide}
                disabled={!s.previewEnabled}
                options={[
                  ['auto', t('Opposite the mouse')],
                  ['left', t('Always left')],
                  ['right', t('Always right')],
                ]}
                onChange={(v) => updateTableSettings({ previewSide: v })}
              />
              <Choice<number>
                label={t('Delay before showing')}
                value={s.previewDelay}
                disabled={!s.previewEnabled}
                options={[
                  [0, t('None')],
                  [150, '0.15 s'],
                  [350, '0.35 s'],
                  [600, '0.6 s'],
                ]}
                onChange={(v) => updateTableSettings({ previewDelay: v })}
              />
            </Section>

            <Section title={t('Game')}>
              <Toggle
                label={t('On my turn, untap everything and draw without asking')}
                checked={s.autoUntap}
                onChange={(v) => updateTableSettings({ autoUntap: v })}
              />
              <Toggle label={t('Sounds')} checked={!muted} onChange={(v) => onMuted(!v)} />
              <Toggle
                label={t('Reduce motion (no shaking or flipping animations)')}
                checked={s.reduceMotion}
                onChange={(v) => updateTableSettings({ reduceMotion: v })}
              />
            </Section>
          </div>

          {/* Amostra: como a carta fica no campo e na mão com o tamanho escolhido */}
          <div className="space-y-3 md:w-52">
            <p className="text-xs tracking-wide text-parchment/50 uppercase">{t('Preview')}</p>
            <div className="grid place-items-center rounded-lg border border-line bg-surface/60 p-3">
              <SampleCard card={sample} width={boardW} />
              <p className="mt-2 text-xs text-parchment/50">{t('Battlefield')}</p>
            </div>
            <div className="grid place-items-center rounded-lg border border-line bg-surface/60 p-3">
              <SampleCard card={sample} width={handW} />
              <p className="mt-2 text-xs text-parchment/50">{t('Hand')}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <button
            onClick={() => resetTableSettings()}
            disabled={JSON.stringify(s) === JSON.stringify(DEFAULT_SETTINGS)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-parchment/70 transition hover:border-parchment/40 disabled:opacity-40"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {t('Restore defaults')}
          </button>
          <button onClick={onClose} className="ml-auto rounded-md bg-gold px-4 py-1.5 text-sm font-semibold text-ink">
            {t('Done')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-gold uppercase">{title}</h3>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  shown,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  shown: string
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <label className={`block ${disabled ? 'opacity-40' : ''}`}>
      <span className="flex items-baseline justify-between gap-3 text-sm">
        {label}
        <span className="text-xs text-parchment/60 tabular-nums">{shown}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-[#e4572e]"
      />
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-gold' : 'bg-parchment/20'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink shadow transition-all ${checked ? 'left-[1.375rem]' : 'left-0.5'}`}
        />
      </button>
    </label>
  )
}

function Choice<T extends string | number>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: T
  options: [T, string][]
  disabled?: boolean
  onChange: (v: T) => void
}) {
  return (
    <div className={disabled ? 'pointer-events-none opacity-40' : ''}>
      <p className="mb-1.5 text-sm">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              value === v
                ? 'border-gold bg-gold/15 text-gold'
                : 'border-line text-parchment/70 hover:border-parchment/40'
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

function SampleCard({ card, width }: { card: TableCard | null; width: number }) {
  return card?.image ? (
    <img
      src={card.image}
      alt={card.name}
      style={{ width, height: width * CARD_RATIO }}
      className="rounded-[6%] object-cover shadow-lg shadow-black/60"
    />
  ) : (
    <div
      style={{ width, height: width * CARD_RATIO }}
      className="rounded-[6%] border border-gold/40 bg-[radial-gradient(circle_at_50%_40%,#2a1810,#0b0b0d_70%)]"
    />
  )
}
