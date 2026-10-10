import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { applyLang, getLang, LangContext, type Lang } from '../lib/i18n'

/** Guarda o idioma escolhido (inglês por padrão) e avisa o site inteiro quando ele muda. */
export default function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(getLang)
  const setLang = useCallback((next: Lang) => {
    applyLang(next)
    setState(next)
  }, [])
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}
