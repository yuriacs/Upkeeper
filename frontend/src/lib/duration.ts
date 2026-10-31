/*
 * Tempos da mesa: relógio do turno ("2:13", "1:05:09") e horas jogadas ("12 h 30 min").
 * "h" e "min" valem em português e em inglês.
 */

/** Segundos como relógio: m:ss, ou h:mm:ss a partir de uma hora */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Segundos como horas jogadas: "12 h 30 min", "45 min", "0 min" */
export function fmtPlayed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds / 60))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

/** "outubro de 2026" (o mês vem como AAAA-MM-01) */
export function monthLabel(month: string, locale: string) {
  return new Date(`${month}T12:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}
