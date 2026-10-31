import { useState } from 'react'
import { Search } from 'lucide-react'
import { useAuthDialog } from '../auth/AuthDialog'
import { queueLabel, useMatchQueue } from '../../hooks/useMatchQueue'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import { PLAYSTYLES, playstyleLabel } from '../../lib/playstyles'
import type { Playstyle, QueuePick } from '../../lib/types'

/**
 * "Achar partida" na tela das mesas: escolhe o tamanho, o bracket e o estilo e entra na fila. A
 * mesa abre sozinha quando juntam jogadores compatíveis (o aviso no canto leva até ela).
 */
export default function FindMatch() {
  const t = useT()
  const { user } = useAuth()
  const { openAuth } = useAuthDialog()
  const { status, join, leave } = useMatchQueue()
  const [pick, setPick] = useState<QueuePick>({ size: 4, bracket: null, style: null })
  const select = 'rounded-md border border-line bg-ink px-2 py-1.5 text-sm'
  const waiting = (status?.waiting ?? []).reduce((n, w) => n + w.count, 0)
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gold/40 bg-gold/[0.04] p-4">
      <div className="min-w-48 flex-1">
        <p className="font-display text-xl text-parchment">{t('Find a game')}</p>
        <p className="text-xs text-parchment/55">
          {t('Join the queue and the table opens by itself when enough players match.')}
          {waiting > 0 && <> {t('{n} waiting now.', { n: waiting })}</>}
        </p>
      </div>
      {status?.mine ? (
        <>
          <p className="text-sm text-parchment/70">{t('In the queue: {what}', { what: queueLabel(t, status.mine) })}</p>
          <button
            onClick={() => leave.mutate()}
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-parchment/40"
          >
            {t('Leave queue')}
          </button>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs text-parchment/60">
            {t('Players')}
            <select
              value={pick.size}
              onChange={(e) => setPick({ ...pick, size: Number(e.target.value) as 2 | 4 })}
              className={select}
            >
              <option value={4}>{t('{n} players', { n: 4 })}</option>
              <option value={2}>{t('{n} players', { n: 2 })}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-parchment/60">
            {t('Bracket')}
            <select
              value={pick.bracket ?? ''}
              onChange={(e) => setPick({ ...pick, bracket: e.target.value ? Number(e.target.value) : null })}
              className={select}
            >
              <option value="">{t('Any')}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-parchment/60">
            {t('Play style')}
            <select
              value={pick.style ?? ''}
              onChange={(e) => setPick({ ...pick, style: (e.target.value || null) as Playstyle | null })}
              className={select}
            >
              <option value="">{t('Any')}</option>
              {PLAYSTYLES.map((s) => (
                <option key={s} value={s}>
                  {playstyleLabel(t, s)}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => (user ? join.mutate(pick) : openAuth('login', { onClose: (ok) => ok && join.mutate(pick) }))}
            disabled={join.isPending}
            className="inline-flex items-center gap-2 rounded-md btn-ember px-4 py-2 font-semibold text-ink hover:brightness-110 disabled:opacity-60"
          >
            <Search className="h-4 w-4" aria-hidden />
            {t('Find a game')}
          </button>
        </>
      )}
    </div>
  )
}
