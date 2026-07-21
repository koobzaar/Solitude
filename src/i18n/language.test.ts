import { describe, expect, it, vi } from 'vitest'
import { LANGUAGE_STORAGE_KEY, detectAppLanguage, mapBrowserLanguage, persistAppLanguage } from './language'

describe('application language detection', () => {
  const emptyStorage = { getItem: () => null }

  it('gives a valid saved override precedence over browser preferences', () => {
    const storage = { getItem: (key: string) => key === LANGUAGE_STORAGE_KEY ? 'en' : null }
    expect(detectAppLanguage({ storage, languages: ['pt-BR'] })).toBe('en')
  })

  it.each(['pt', 'pt-BR', 'pt-PT', 'PT-ao'])('maps the Portuguese locale %s to Brazilian Portuguese', (language) => {
    expect(mapBrowserLanguage(language)).toBe('pt-BR')
    expect(detectAppLanguage({ storage: emptyStorage, languages: [language] })).toBe('pt-BR')
  })

  it.each(['en', 'en-US', 'en-GB', 'EN-ca'])('maps the English locale %s to English', (language) => {
    expect(mapBrowserLanguage(language)).toBe('en')
  })

  it('checks browser preferences in order until it finds a supported language', () => {
    expect(detectAppLanguage({ storage: emptyStorage, languages: ['fr-FR', 'de-DE', 'pt-PT', 'en-US'] })).toBe('pt-BR')
  })

  it('ignores invalid saved values, unsupported and malformed locales, then falls back to English', () => {
    const invalidStorage = { getItem: () => 'pt_PT' }
    expect(detectAppLanguage({ storage: invalidStorage, languages: ['es-419', '', 42, null] })).toBe('en')
  })

  it('continues safely when storage access fails', () => {
    const storage = { getItem: () => { throw new DOMException('Denied', 'SecurityError') } }
    expect(detectAppLanguage({ storage, languages: ['pt-MZ'] })).toBe('pt-BR')
  })

  it('persists a manual selection and ignores write failures', () => {
    const setItem = vi.fn()
    persistAppLanguage('pt-BR', { setItem })
    expect(setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'pt-BR')
    expect(() => persistAppLanguage('en', { setItem: () => { throw new DOMException('Denied') } })).not.toThrow()
  })
})
