import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import ptBR from './locales/pt-BR'
import { detectAppLanguage, isAppLanguage, persistAppLanguage } from './language'
import type { AppLanguage } from './language'

export { LANGUAGE_STORAGE_KEY, detectAppLanguage, isAppLanguage, mapBrowserLanguage, persistAppLanguage } from './language'
export type { AppLanguage } from './language'

export const resources = {
  en: { translation: en },
  'pt-BR': { translation: ptBR },
} as const

function currentLanguage(language = i18n.resolvedLanguage ?? i18n.language): AppLanguage {
  return isAppLanguage(language) ? language : 'en'
}

export function syncDocumentLanguage(language = currentLanguage()): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language
  document.documentElement.dir = i18n.dir(language)
  document.title = i18n.t('meta.title', { lng: language })
  let description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
  if (!description) {
    description = document.createElement('meta')
    description.name = 'description'
    document.head.append(description)
  }
  description.content = i18n.t('meta.description', { lng: language })
}

void i18n.use(initReactI18next).init({
  lng: detectAppLanguage(),
  fallbackLng: 'en',
  supportedLngs: ['en', 'pt-BR'],
  resources,
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})

i18n.on('languageChanged', (language) => syncDocumentLanguage(isAppLanguage(language) ? language : 'en'))
syncDocumentLanguage()

export function changeAppLanguage(language: AppLanguage): void {
  persistAppLanguage(language)
  void i18n.changeLanguage(language)
}

export function getAppLanguage(): AppLanguage {
  return currentLanguage()
}

export default i18n
