import { useEffect } from 'react'

const BASE = 'Choose at random'

/** Título da aba: "Página · Choose at random" (ou só a marca). */
export function useTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${BASE}` : `${BASE} — sorteio de precons de Commander`
  }, [title])
}
