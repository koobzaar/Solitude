/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

class FakeRequest {
  readonly url: string
  constructor(input: string | URL | FakeRequest, readonly destination = '') {
    this.url = input instanceof FakeRequest ? input.url : String(input)
  }
}

class FakeResponse {
  readonly ok: boolean
  readonly type: string
  constructor(readonly body = '', options: { status?: number; type?: string } = {}) {
    this.ok = (options.status ?? 200) >= 200 && (options.status ?? 200) < 300
    this.type = options.type ?? 'basic'
  }
  clone() { return new FakeResponse(this.body, { status: this.ok ? 200 : 500, type: this.type }) }
  async json() { return JSON.parse(this.body) as unknown }
  async text() { return this.body }
}

class MemoryCache {
  readonly values = new Map<string, FakeResponse>()
  private key(input: string | FakeRequest) { return typeof input === 'string' ? input : input.url }
  async match(input: string | FakeRequest) { return this.values.get(this.key(input))?.clone() }
  async put(input: string | FakeRequest, response: FakeResponse) { this.values.set(this.key(input), response.clone()) }
  async delete(input: string | FakeRequest) { return this.values.delete(this.key(input)) }
  async keys() { return [...this.values.keys()].map((url) => new FakeRequest(url)) }
}

function workerHarness() {
  const source = readFileSync(resolve(process.cwd(), 'public/cover-sw.js'), 'utf8')
  const listeners = new Map<string, (event: { request: FakeRequest; respondWith: (response: Promise<FakeResponse>) => void; waitUntil: (promise: Promise<unknown>) => void }) => void>()
  const stores = new Map<string, MemoryCache>()
  let now = 1_000
  class FakeDate extends Date { static override now() { return now } }
  const fetchImpl = vi.fn(async () => new FakeResponse('network'))
  const workerSelf = {
    location: { origin: 'https://solitude.test' },
    registration: { scope: 'https://solitude.test/app/' },
    addEventListener: (name: string, listener: (typeof listeners extends Map<string, infer T> ? T : never)) => { listeners.set(name, listener) },
  }
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new MemoryCache())
      return stores.get(name)!
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  }
  runInNewContext(source, { self: workerSelf, caches, fetch: fetchImpl, Request: FakeRequest, Response: FakeResponse, URL, Date: FakeDate, Promise, JSON, encodeURIComponent })

  const requestImage = async (url: string) => {
    let response: Promise<FakeResponse> | undefined
    listeners.get('fetch')?.({
      request: new FakeRequest(url, 'image'),
      respondWith: (value) => { response = value },
      waitUntil: () => undefined,
    })
    if (!response) throw new Error('The image request was not intercepted')
    return response
  }
  return { requestImage, fetchImpl, stores, setNow: (value: number) => { now = value } }
}

describe('cover image service worker', () => {
  it('serves a fresh cache hit without another network request and refreshes after seven days', async () => {
    const worker = workerHarness()
    const url = 'https://example.com/cover.jpg'
    worker.fetchImpl.mockResolvedValueOnce(new FakeResponse('first')).mockResolvedValueOnce(new FakeResponse('refreshed'))
    expect(await (await worker.requestImage(url)).text()).toBe('first')
    expect(await (await worker.requestImage(url)).text()).toBe('first')
    expect(worker.fetchImpl).toHaveBeenCalledTimes(1)
    worker.setNow(1_000 + 7 * 24 * 60 * 60 * 1_000 + 1)
    expect(await (await worker.requestImage(url)).text()).toBe('refreshed')
    expect(worker.fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('serves stale artwork when an expired refresh fails', async () => {
    const worker = workerHarness()
    const url = 'https://example.com/stale.jpg'
    worker.fetchImpl.mockResolvedValueOnce(new FakeResponse('kept')).mockRejectedValueOnce(new TypeError('offline'))
    await worker.requestImage(url)
    worker.setNow(1_000 + 7 * 24 * 60 * 60 * 1_000 + 1)
    expect(await (await worker.requestImage(url)).text()).toBe('kept')
  })

  it('evicts the least-recently-used image above 250 entries', async () => {
    const worker = workerHarness()
    for (let index = 0; index < 251; index += 1) {
      worker.setNow(1_000 + index)
      await worker.requestImage(`https://example.com/${index}.jpg`)
    }
    const imageCache = worker.stores.get('solitude-cover-images-v1')!
    expect(imageCache.values).toHaveLength(250)
    expect(imageCache.values.has('https://example.com/0.jpg')).toBe(false)
    expect(imageCache.values.has('https://example.com/250.jpg')).toBe(true)
  })
})
