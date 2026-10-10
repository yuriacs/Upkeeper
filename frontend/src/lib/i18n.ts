/**
 * Idiomas do site: inglês (padrão) e português.
 *
 * Estilo gettext: o texto em inglês no código É a chave. Ex.: t('Deal decks') ou
 * t('{n} players', { n }). O português fica em src/i18n/pt/*.ts (inglês → português);
 * o que não estiver traduzido aparece em inglês. O provedor fica em components/LanguageProvider.
 */
import { createContext, useCallback, useContext } from 'react'
import { pt } from '../i18n/pt'
import { readJSON, writeJSON } from './storage'

export type Lang = 'en' | 'pt'
export type Vars = Record<string, string | number>

const KEY = 'choose-at-random:lang'
let current: Lang = readJSON<string>(KEY, 'en') === 'pt' ? 'pt' : 'en'

/** Idioma atual fora do React (ex.: cabeçalho Accept-Language nas chamadas à API). */
export const getLang = (): Lang => current
export const localeFor = (lang: Lang) => (lang === 'pt' ? 'pt-BR' : 'en-US')

export function applyLang(lang: Lang) {
  current = lang
  writeJSON(KEY, lang)
  document.documentElement.lang = localeFor(lang)
}
document.documentElement.lang = localeFor(current)

const warned = new Set<string>()

export function translate(lang: Lang, text: string, vars?: Vars): string {
  let out = text
  if (lang === 'pt') {
    const hit = pt[text]
    if (hit !== undefined) out = hit
    else if (import.meta.env.DEV && !warned.has(text)) {
      warned.add(text)
      console.warn(`[i18n] sem tradução: ${JSON.stringify(text)}`)
    }
  }
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
  return out
}

export type LangCtx = { lang: Lang; setLang: (lang: Lang) => void }
export const LangContext = createContext<LangCtx>({ lang: current, setLang: () => undefined })

export function useI18n() {
  const { lang, setLang } = useContext(LangContext)
  const t = useCallback((text: string, vars?: Vars) => translate(lang, text, vars), [lang])
  return { lang, setLang, t, locale: localeFor(lang) }
}

/** Atalho: const t = useT(); t('Deal decks') */
export const useT = () => useI18n().t
