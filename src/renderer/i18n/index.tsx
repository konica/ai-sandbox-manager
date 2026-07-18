import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { en, type Dict } from './en'
import { de } from './de'

export type Lang = 'en' | 'de'

export const DICTS: Record<Lang, Dict> = { en, de }
export const LANG_NAMES: Record<Lang, string> = { en: 'English', de: 'Deutsch' }

function lookup(dict: unknown, key: string): string | undefined {
  const val = key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), dict)
  return typeof val === 'string' ? val : undefined
}

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`))
}

// Pure translation: resolve from the language dict, fall back to English, then
// to the key itself; then interpolate {var} placeholders.
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const hit = lookup(DICTS[lang], key) ?? lookup(en, key) ?? key
  return interpolate(hit, vars)
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string

interface I18nValue { lang: Lang; setLang: (l: Lang) => void; t: TFn }

// Default to English with a no-op setter so components (and tests) work even
// without a provider; a real LanguageProvider overrides this.
const defaultValue: I18nValue = { lang: 'en', setLang: () => {}, t: (key, vars) => translate('en', key, vars) }
const I18nContext = createContext<I18nValue>(defaultValue)

const STORAGE_KEY = 'sbx-lang'

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'en' || v === 'de') return v
  } catch { /* ignore */ }
  return 'en'
}

export function LanguageProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { localStorage.setItem(STORAGE_KEY, l) } catch { /* ignore */ }
  }, [])
  const t = useCallback<TFn>((key, vars) => translate(lang, key, vars), [lang])
  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}

// Convenience: just the translate function.
export function useT(): TFn {
  return useI18n().t
}
