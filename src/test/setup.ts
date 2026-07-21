import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import i18n from '../i18n'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  Object.defineProperty(navigator, 'languages', { configurable: true, value: ['en-US'] })
  Object.defineProperty(navigator, 'language', { configurable: true, value: 'en-US' })
  void i18n.changeLanguage('en')
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: class IntersectionObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(() => cleanup())
