export type AppLanguage = 'en' | 'pt-BR'

export const LANGUAGE_STORAGE_KEY = 'solitude:language:v1'

const SUPPORTED_LANGUAGES = new Set<AppLanguage>(['en', 'pt-BR'])

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.has(value as AppLanguage)
}

export function mapBrowserLanguage(value: unknown): AppLanguage | undefined {
  if (typeof value !== 'string') return undefined
  const language = value.trim()
  if (/^pt(?:-|$)/i.test(language)) return 'pt-BR'
  if (/^en(?:-|$)/i.test(language)) return 'en'
  return undefined
}

interface LanguageEnvironment {
  storage?: Pick<Storage, 'getItem'>
  languages?: readonly unknown[]
}

export function detectAppLanguage(environment: LanguageEnvironment = {}): AppLanguage {
  const storage = environment.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
  try {
    const saved = storage?.getItem(LANGUAGE_STORAGE_KEY)
    if (isAppLanguage(saved)) return saved
  } catch {
    // Browser storage can be disabled. Browser preferences still provide a safe fallback.
  }

  let languages = environment.languages
  if (!languages && typeof navigator !== 'undefined') {
    try {
      languages = navigator.languages?.length ? navigator.languages : [navigator.language]
    } catch {
      languages = []
    }
  }

  for (const language of languages ?? []) {
    const mapped = mapBrowserLanguage(language)
    if (mapped) return mapped
  }
  return 'en'
}

export function persistAppLanguage(
  language: AppLanguage,
  storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): void {
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // The UI can still switch for this session when persistence is unavailable.
  }
}
