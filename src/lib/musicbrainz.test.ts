import { describe, expect, it, vi } from 'vitest'
import {
  MusicBrainzClient,
  automaticMatch,
  buildSearchUrl,
  catalogSimilarity,
  coverMetadataUrlFor,
  coverUrlFor,
  escapeLucene,
  mapCoverArtResponse,
  mapMusicBrainzResults,
} from './musicbrainz'

const exactPayload = {
  'release-groups': [
    {
      id: 'strong-id', title: 'Blue Train', score: 100, 'first-release-date': '1957-09-15', 'primary-type': 'Album',
      'artist-credit': [{ name: 'John Coltrane' }],
    },
    {
      id: 'weak-id', title: 'Blue Train Sessions', score: 88, 'primary-type': 'Album',
      'artist-credit': [{ name: 'Someone Else' }],
    },
    {
      id: 'single-id', title: 'Blue Train', score: 100, 'primary-type': 'Single',
      'artist-credit': [{ name: 'John Coltrane' }],
    },
  ],
}

const neighbourhoodPayload = {
  'release-groups': [{
    id: '3227286b-8f17-4a94-96f6-18c644d4a1aa',
    title: 'I Love You.',
    score: 100,
    'primary-type': 'Album',
    'artist-credit': [{ name: 'The Neighbourhood' }],
  }],
}

const kooksPayload = {
  'release-groups': [{
    id: '955f4066-9dfd-3363-b10f-1c9a67903faa',
    title: 'Inside In/Inside Out',
    score: 100,
    'primary-type': 'Album',
    'artist-credit': [{ name: 'The Kooks' }],
  }],
}

function response(data: unknown = exactPayload, ok = true, status = 200): Response {
  return { ok, status, json: async () => data } as Response
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('MusicBrainz catalog', () => {
  it('binds the native fetch implementation to the browser global', async () => {
    const originalFetch = globalThis.fetch
    const brandCheckedFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('fetch called with the wrong receiver')
      return Promise.resolve(response())
    }) as unknown as typeof fetch
    globalThis.fetch = brandCheckedFetch

    try {
      const client = new MusicBrainzClient({ storage: memoryStorage(), now: () => 0, wait: async () => {} })
      await expect(client.search('Blue Train', 'John Coltrane', true)).resolves.toHaveLength(3)
      expect(brandCheckedFetch).toHaveBeenCalledOnce()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('escapes strict queries and builds AND-token fuzzy fallbacks', () => {
    expect(escapeLucene('AC/DC: Live!')).toBe('AC\\/DC\\: Live\\!')
    const exact = new URL(buildSearchUrl('AC/DC', 'Artist + Co'))
    expect(exact.searchParams.get('fmt')).toBe('json')
    expect(exact.searchParams.get('limit')).toBe('20')
    expect(exact.searchParams.get('query')).toContain('AC\\/DC')

    const punctuationFallback = new URL(buildSearchUrl('Inside In / Inside Out', 'The Kooks', 'fuzzy'))
    expect(punctuationFallback.searchParams.get('query')).toBe(
      'releasegroup:(inside~1 AND in AND out) AND artistname:(the AND kooks~1)',
    )
    const typoFallback = new URL(buildSearchUrl('I love you.', 'The neighborhood', 'fuzzy'))
    expect(typoFallback.searchParams.get('query')).toContain('neighborhood~1')
    expect(new URL(buildSearchUrl('Album', 'Wrong Artist', 'title-only')).searchParams.get('query')).not.toContain('artistname')
  })

  it('normalizes punctuation, diacritics, ampersands, and small spelling mistakes', () => {
    expect(catalogSimilarity('Inside In / Inside Out', 'Inside In/Inside Out')).toBe(1)
    expect(catalogSimilarity('Beyoncé & Jay-Z', 'Beyonce and Jay Z')).toBe(1)
    expect(catalogSimilarity('The neighborhood', 'The Neighbourhood')).toBeGreaterThan(0.93)
  })

  it('ranks locally, prefers albums on ties, and keeps source scores separate', () => {
    const results = mapMusicBrainzResults(exactPayload, 'Blue Train', 'John Coltrane')
    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({
      id: 'strong-id', year: 1957, confidence: 1, matchKind: 'exact', weak: false, coverUrl: coverUrlFor('strong-id'),
    })
    expect(results[1].id).toBe('single-id')
    expect(results[2]).toMatchObject({ id: 'weak-id', weak: true, score: 88 })
  })

  it('automatically accepts exact and clearly leading fuzzy matches but not ambiguity', () => {
    const exact = mapMusicBrainzResults(exactPayload, 'Blue Train', 'John Coltrane')
    expect(automaticMatch(exact)?.id).toBe('strong-id')

    const fuzzy = mapMusicBrainzResults(neighbourhoodPayload, 'I love you.', 'The neighborhood', 'fuzzy')
    expect(fuzzy[0].confidence).toBeGreaterThan(0.95)
    expect(automaticMatch(fuzzy)?.id).toBe('3227286b-8f17-4a94-96f6-18c644d4a1aa')
    expect(automaticMatch([fuzzy[0], { ...fuzzy[0], id: 'runner-up', confidence: fuzzy[0].confidence - 0.04 }])).toBeUndefined()
  })

  it('requires a unique exact title before auto-matching an unknown artist', () => {
    const one = mapMusicBrainzResults(neighbourhoodPayload, 'I love you.', 'Unknown artist', 'title-only')
    expect(automaticMatch(one)?.id).toBe('3227286b-8f17-4a94-96f6-18c644d4a1aa')
    expect(automaticMatch([one[0], { ...one[0], id: 'another' }])).toBeUndefined()
  })

  it('widens a punctuation-sensitive search and finds Inside In/Inside Out', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ 'release-groups': [] }))
      .mockResolvedValueOnce(response(kooksPayload))
    const fetchImpl = fetchMock as unknown as typeof fetch
    const client = new MusicBrainzClient({ fetchImpl, storage: memoryStorage(), now: () => 0, wait: async () => {} })
    const results = await client.search('Inside In / Inside Out', 'The Kooks', true)
    expect(results[0]).toMatchObject({ id: '955f4066-9dfd-3363-b10f-1c9a67903faa', confidence: 1 })
    expect(automaticMatch(results)?.id).toBe('955f4066-9dfd-3363-b10f-1c9a67903faa')
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('query')).toContain('releasegroup:(inside~1 AND in AND out)')
  })

  it('widens an artist typo and automatically corrects The Neighbourhood', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(neighbourhoodPayload)) as unknown as typeof fetch
    const client = new MusicBrainzClient({ fetchImpl, storage: memoryStorage(), now: () => 0, wait: async () => {} })
    const results = await client.search('I love you.', 'The neighborhood', true)
    expect(automaticMatch(results)).toMatchObject({
      id: '3227286b-8f17-4a94-96f6-18c644d4a1aa', artist: 'The Neighbourhood', matchKind: 'fuzzy',
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('uses title-only search only when artist-assisted candidates are not useful', async () => {
    const unrelated = {
      'release-groups': [{ id: 'wrong', title: 'Something Else', score: 90, 'artist-credit': [{ name: 'Another Person' }] }],
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(unrelated))
      .mockResolvedValueOnce(response(kooksPayload))
    const fetchImpl = fetchMock as unknown as typeof fetch
    const client = new MusicBrainzClient({ fetchImpl, storage: memoryStorage(), now: () => 0, wait: async () => {} })
    const results = await client.search('Inside In / Inside Out', 'Completely Wrong', true)
    expect(results[0].id).toBe('955f4066-9dfd-3363-b10f-1c9a67903faa')
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('query')).not.toContain('artistname')
  })

  it('caches the final progressive result for later calls', async () => {
    const fetchImpl = vi.fn(async () => response()) as unknown as typeof fetch
    const client = new MusicBrainzClient({ fetchImpl, storage: memoryStorage(), now: () => 1_000, wait: async () => {} })
    await client.search('Blue Train', 'John Coltrane')
    await client.search('Blue Train', 'John Coltrane')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent uncached MusicBrainz requests at least 1.1 seconds apart', async () => {
    let clock = 0
    const waits: number[] = []
    const fetchImpl = vi.fn(async () => response()) as unknown as typeof fetch
    const client = new MusicBrainzClient({
      fetchImpl,
      storage: memoryStorage(),
      now: () => clock,
      wait: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds },
    })
    await Promise.all([
      client.search('Blue Train', 'John Coltrane', true),
      client.search('Blue Train', 'John Coltrane', true),
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(waits).toContain(1_100)
  })

  it('retries transient failures up to three times with increasing delays', async () => {
    let clock = 0
    const waits: number[] = []
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(exactPayload, false, 503))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(response()) as unknown as typeof fetch
    const client = new MusicBrainzClient({
      fetchImpl,
      storage: memoryStorage(),
      now: () => clock,
      wait: async (milliseconds) => { waits.push(milliseconds); clock += milliseconds },
    })
    const results = await client.search('Blue Train', 'John Coltrane', true)
    expect(results[0].id).toBe('strong-id')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(waits).toContain(750)
    expect(waits).toContain(1_500)
  })

  it('surfaces final errors and does not retry permanent client errors', async () => {
    let clock = 0
    const transient = vi.fn(async () => response(exactPayload, false, 429)) as unknown as typeof fetch
    const transientClient = new MusicBrainzClient({ fetchImpl: transient, storage: memoryStorage(), now: () => clock, wait: async (ms) => { clock += ms } })
    await expect(transientClient.search('Bad', 'Query', true)).rejects.toThrow('429')
    expect(transient).toHaveBeenCalledTimes(3)

    const permanent = vi.fn(async () => response(exactPayload, false, 400)) as unknown as typeof fetch
    const permanentClient = new MusicBrainzClient({ fetchImpl: permanent, storage: memoryStorage(), now: () => 0, wait: async () => {} })
    await expect(permanentClient.search('Bad', 'Query', true)).rejects.toThrow('400')
    expect(permanent).toHaveBeenCalledTimes(1)
  })
})

describe('Cover Art Archive', () => {
  it('selects an approved front 500px thumbnail and upgrades it to HTTPS', () => {
    expect(mapCoverArtResponse({ images: [
      { front: false, approved: true, thumbnails: { '500': 'http://example.com/back.jpg' } },
      { front: true, approved: true, thumbnails: { '500': 'http://coverartarchive.org/front.jpg' } },
    ] })).toEqual({ status: 'available', url: 'https://coverartarchive.org/front.jpg' })
  })

  it('falls back to large/original art and reports a genuinely missing front', () => {
    expect(mapCoverArtResponse({ images: [{ front: true, thumbnails: { large: 'https://example.com/large.jpg' } }] }))
      .toEqual({ status: 'available', url: 'https://example.com/large.jpg' })
    expect(mapCoverArtResponse({ images: [{ front: false, image: 'https://example.com/back.jpg' }] }))
      .toEqual({ status: 'missing' })
  })

  it('resolves and caches cover metadata separately from searches', async () => {
    const fetchImpl = vi.fn(async () => response({
      images: [{ front: true, approved: true, thumbnails: { '500': 'https://example.com/front.jpg' } }],
    })) as unknown as typeof fetch
    const client = new MusicBrainzClient({ fetchImpl, storage: memoryStorage(), now: () => 1_000, wait: async () => {} })
    await expect(client.resolveCover('release-group')).resolves.toEqual({ status: 'available', url: 'https://example.com/front.jpg' })
    await expect(client.resolveCover('release-group')).resolves.toEqual({ status: 'available', url: 'https://example.com/front.jpg' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(coverMetadataUrlFor('release-group'), expect.any(Object))
  })

  it('preserves every entry when cover lookups finish concurrently', async () => {
    const storage = memoryStorage()
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const id = String(input).includes('/first/') ? 'first' : 'second'
      return response({ images: [{ front: true, thumbnails: { '500': `https://example.com/${id}.jpg` } }] })
    }) as unknown as typeof fetch
    const client = new MusicBrainzClient({ fetchImpl, storage, now: () => 0, wait: async () => {} })
    await Promise.all([client.resolveCover('first'), client.resolveCover('second')])
    await Promise.all([client.resolveCover('first'), client.resolveCover('second')])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('caches a 404 as missing and retries transient cover failures', async () => {
    const missingFetch = vi.fn(async () => response({}, false, 404)) as unknown as typeof fetch
    const missingClient = new MusicBrainzClient({ fetchImpl: missingFetch, storage: memoryStorage(), now: () => 0, wait: async () => {} })
    await expect(missingClient.resolveCover('missing')).resolves.toEqual({ status: 'missing' })
    await expect(missingClient.resolveCover('missing')).resolves.toEqual({ status: 'missing' })
    expect(missingFetch).toHaveBeenCalledOnce()

    const retryFetch = vi.fn()
      .mockResolvedValueOnce(response({}, false, 503))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(response({ images: [] })) as unknown as typeof fetch
    const retryClient = new MusicBrainzClient({ fetchImpl: retryFetch, storage: memoryStorage(), now: () => 0, wait: async () => {} })
    await expect(retryClient.resolveCover('eventual')).resolves.toEqual({ status: 'missing' })
    expect(retryFetch).toHaveBeenCalledTimes(3)
  })

  it('distinguishes exhausted cover errors from a missing cover', async () => {
    const fetchImpl = vi.fn(async () => response({}, false, 500)) as unknown as typeof fetch
    const client = new MusicBrainzClient({ fetchImpl, storage: memoryStorage(), now: () => 0, wait: async () => {} })
    await expect(client.resolveCover('broken')).resolves.toMatchObject({ status: 'error', error: expect.stringContaining('500') })
  })
})
