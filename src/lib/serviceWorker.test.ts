import { describe, expect, it, vi } from 'vitest'
import { registerCoverServiceWorker } from './serviceWorker'

describe('cover service worker registration', () => {
  it('registers at the current relative deployment scope and tolerates rejection', async () => {
    const register = vi.fn().mockRejectedValue(new DOMException('blocked'))
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
    expect(() => registerCoverServiceWorker()).not.toThrow()
    expect(register).toHaveBeenCalledWith(
      expect.stringMatching(/cover-sw\.js$/),
      expect.objectContaining({ scope: '/' }),
    )
    await Promise.resolve()
  })
})
