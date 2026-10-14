import { useEffect } from 'react'
import { useI18n } from '../lib/i18n'

const BASE = 'Upkeeper'

/** Título da aba: "Página · Upkeeper" (ou só a marca). Quem chama já passa o título traduzido. */
export function useTitle(title?: string | null) {
  const { t } = useI18n()
  const fallback = `${BASE} — ${t('Play Commander online')}`
  useEffect(() => {
    document.title = title ? `${title} · ${BASE}` : fallback
  }, [title, fallback])
}
