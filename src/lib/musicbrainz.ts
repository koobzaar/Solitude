import { normalizeValue } from './importParser'
import { loadCatalogCache, saveCatalogCache } from './storage'
import type { CatalogCandidate, CatalogCoverResult, CatalogMatchKind, TrackCatalogEntry, TrackEdition, TrackRecording } from './types'

const API_URL = 'https://musicbrainz.org/ws/2/release-group/'
const COVER_URL = 'https://coverartarchive.org/release-group'
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000
const REQUEST_INTERVAL_MS = 1_100
const SEARCH_LIMIT = 20
const RESULT_LIMIT = 5
const EDITION_LIMIT = 10
const COVER_CONCURRENCY = 2

interface MusicBrainzArtistCredit {
  name?: string
  artist?: { name?: string }
  joinphrase?: string
}

interface MusicBrainzReleaseGroup {
  id?: string
  title?: string
  score?: number | string
  'first-release-date'?: string
  'primary-type'?: string
  'artist-credit'?: MusicBrainzArtistCredit[]
}

interface MusicBrainzResponse {
  'release-groups'?: MusicBrainzReleaseGroup[]
}

interface MusicBrainzTrack {
  id?: string
  title?: string
  position?: number
  length?: number
  recording?: { id?: string; title?: string; length?: number }
}

interface MusicBrainzMedium {
  position?: number
  format?: string
  'track-count'?: number
  tracks?: MusicBrainzTrack[]
}

interface MusicBrainzRelease {
  id?: string
  title?: string
  status?: string
  date?: string
  country?: string
  disambiguation?: string
  media?: MusicBrainzMedium[]
}

interface MusicBrainzEditionResponse {
  'release-count'?: number
  'release-offset'?: number
  releases?: MusicBrainzRelease[]
}

interface CoverArtImage {
  approved?: boolean
  front?: boolean
  image?: string
  thumbnails?: Record<string, string | undefined>
}

interface CoverArtResponse {
  images?: CoverArtImage[]
}

class PermanentCatalogError extends Error {}

export interface CoverLookupResult {
  status: 'available' | 'missing' | 'error'
  url?: string
  error?: string
}

export interface MusicBrainzClientOptions {
  fetchImpl?: typeof fetch
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
}

export type SearchStrategy = 'exact' | 'fuzzy' | 'title-only'

const LUCENE_SPECIAL_CHARACTERS = new Set(['+', '-', '&', '|', '!', '(', ')', '{', '}', '[', ']', '^', '"', '~', '*', '?', ':', '\\', '/'])

export function escapeLucene(value: string): string {
  return [...value].map((character) => LUCENE_SPECIAL_CHARACTERS.has(character) ? `\\${character}` : character).join('')
}

function normalizeCatalogValue(value: string): string {
  return normalizeValue(value.replace(/&/g, ' and '))
}

function catalogTokens(value: string): string[] {
  return [...new Set(normalizeCatalogValue(value).split(' ').filter(Boolean))]
}

function fuzzyField(field: 'releasegroup' | 'artistname', value: string): string {
  const terms = catalogTokens(value).map((token) => {
    const escaped = escapeLucene(token)
    return token.length >= 5 ? `${escaped}~1` : escaped
  })
  return `${field}:(${terms.join(' AND ')})`
}

export function coverUrlFor(releaseGroupId: string): string {
  return `${COVER_URL}/${releaseGroupId}/front-500`
}

export function coverMetadataUrlFor(releaseGroupId: string): string {
  return `${COVER_URL}/${releaseGroupId}/`
}

export function buildEditionsUrl(releaseGroupId: string, offset = 0): string {
  const params = new URLSearchParams({
    'release-group': releaseGroupId,
    inc: 'recordings',
    fmt: 'json',
    limit: String(EDITION_LIMIT),
    offset: String(Math.max(0, offset)),
  })
  return `https://musicbrainz.org/ws/2/release?${params.toString()}`
}

function editionMarkerText(edition: TrackEdition): string {
  return `${edition.title} ${edition.disambiguation ?? ''}`.toLowerCase()
}

function hasExpandedEditionMarker(edition: TrackEdition): boolean {
  return /\b(deluxe|bonus|expanded|anniversary|remaster(?:ed)?|special edition|collector'?s)\b/.test(editionMarkerText(edition))
}

export function chooseCanonicalEdition(editions: readonly TrackEdition[]): TrackEdition | undefined {
  if (!editions.length) return undefined
  const frequencies = new Map<number, number>()
  for (const edition of editions) frequencies.set(edition.trackCount, (frequencies.get(edition.trackCount) ?? 0) + 1)
  const modalCount = [...frequencies].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0]
  return [...editions].sort((left, right) => (
    Number(right.status?.toLowerCase() === 'official') - Number(left.status?.toLowerCase() === 'official') ||
    Number(right.trackCount === modalCount) - Number(left.trackCount === modalCount) ||
    Number(hasExpandedEditionMarker(left)) - Number(hasExpandedEditionMarker(right)) ||
    (left.date || '9999-99-99').localeCompare(right.date || '9999-99-99') ||
    left.id.localeCompare(right.id)
  ))[0]
}

export function mapEditionResponse(response: MusicBrainzEditionResponse, releaseGroupId: string): TrackCatalogEntry {
  const mapped: TrackEdition[] = (response.releases ?? []).flatMap((release): TrackEdition[] => {
    if (!release.id || !release.title) return []
    const tracks: TrackRecording[] = (release.media ?? []).flatMap((medium, mediumIndex) => (
      (medium.tracks ?? []).flatMap((track, trackIndex): TrackRecording[] => {
        const title = track.title ?? track.recording?.title
        if (!title) return []
        return [{
          id: track.id ?? track.recording?.id ?? `${release.id}:${medium.position ?? mediumIndex + 1}:${track.position ?? trackIndex + 1}`,
          title,
          position: track.position ?? trackIndex + 1,
          mediumPosition: medium.position ?? mediumIndex + 1,
          lengthMs: track.length ?? track.recording?.length,
        }]
      })
    ))
    if (!tracks.length) return []
    return [{
      id: release.id,
      title: release.title,
      status: release.status,
      date: release.date,
      country: release.country,
      disambiguation: release.disambiguation,
      format: [...new Set((release.media ?? []).map((medium) => medium.format).filter(Boolean))].join(' + ') || undefined,
      trackCount: tracks.length,
      tracks,
    }]
  })

  const distinct = new Map<string, TrackEdition>()
  for (const edition of mapped.sort((left, right) => left.id.localeCompare(right.id))) {
    const signature = edition.tracks.map((track) => normalizeCatalogValue(track.title)).join('\u0000')
    if (!distinct.has(signature)) distinct.set(signature, edition)
  }
  const rawCount = response.releases?.length ?? 0
  const releaseCount = response['release-count'] ?? rawCount
  const nextOffset = (response['release-offset'] ?? 0) + rawCount
  return {
    releaseGroupId,
    editions: [...distinct.values()],
    offset: nextOffset,
    releaseCount,
    hasMore: nextOffset < releaseCount,
  }
}

export function buildSearchUrl(title: string, artist: string, strategy: SearchStrategy = 'exact'): string {
  const unknownArtist = normalizeCatalogValue(artist) === 'unknown artist'
  let query: string
  if (strategy === 'exact') {
    const titleQuery = `releasegroup:"${escapeLucene(title)}"`
    const artistQuery = unknownArtist ? '' : ` AND artist:"${escapeLucene(artist)}"`
    query = `${titleQuery}${artistQuery}`
  } else {
    const titleQuery = fuzzyField('releasegroup', title)
    const artistQuery = strategy === 'title-only' || unknownArtist ? '' : ` AND ${fuzzyField('artistname', artist)}`
    query = `${titleQuery}${artistQuery}`
  }
  const params = new URLSearchParams({ query, fmt: 'json', limit: String(SEARCH_LIMIT) })
  return `${API_URL}?${params.toString()}`
}

function artistName(credit: MusicBrainzArtistCredit[] | undefined): string {
  if (!credit?.length) return 'Unknown artist'
  return credit.map((part) => `${part.name ?? part.artist?.name ?? ''}${part.joinphrase ?? ''}`).join('').trim()
}

function damerauLevenshtein(left: string, right: string): number {
  if (!left.length) return right.length
  if (!right.length) return left.length
  const rows = left.length + 1
  const columns = right.length + 1
  const matrix = Array.from({ length: rows }, () => Array<number>(columns).fill(0))
  for (let row = 0; row < rows; row += 1) matrix[row][0] = row
  for (let column = 0; column < columns; column += 1) matrix[0][column] = column

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost,
      )
      if (
        row > 1 && column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + cost)
      }
    }
  }
  return matrix[left.length][right.length]
}

function tokenDice(left: string, right: string): number {
  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))
  if (!leftTokens.size && !rightTokens.size) return 1
  let intersection = 0
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1
  return (2 * intersection) / (leftTokens.size + rightTokens.size)
}

export function catalogSimilarity(leftValue: string, rightValue: string): number {
  const left = normalizeCatalogValue(leftValue)
  const right = normalizeCatalogValue(rightValue)
  if (left === right) return 1
  const longest = Math.max(left.length, right.length)
  const editSimilarity = longest ? 1 - damerauLevenshtein(left, right) / longest : 1
  return Math.max(0, Math.min(1, Math.max(editSimilarity, tokenDice(left, right))))
}

function candidateSort(left: CatalogCandidate, right: CatalogCandidate): number {
  return (
    right.confidence - left.confidence ||
    Number(right.primaryType === 'Album') - Number(left.primaryType === 'Album') ||
    right.score - left.score ||
    left.title.localeCompare(right.title)
  )
}

export function mapMusicBrainzResults(
  response: MusicBrainzResponse,
  requestedTitle: string,
  requestedArtist: string,
  strategy: SearchStrategy = 'exact',
): CatalogCandidate[] {
  const groups = response['release-groups'] ?? []
  const artistProvided = normalizeCatalogValue(requestedArtist) !== 'unknown artist'
  return groups
    .filter((group): group is MusicBrainzReleaseGroup & { id: string; title: string } => Boolean(group.id && group.title))
    .map((group): CatalogCandidate => {
      const artist = artistName(group['artist-credit'])
      const titleSimilarity = catalogSimilarity(requestedTitle, group.title)
      const artistSimilarity = artistProvided ? catalogSimilarity(requestedArtist, artist) : undefined
      const confidence = artistSimilarity === undefined
        ? titleSimilarity
        : titleSimilarity * 0.65 + artistSimilarity * 0.35
      const matchKind: CatalogMatchKind = titleSimilarity === 1 && artistSimilarity === 1
        ? 'exact'
        : strategy === 'title-only' ? 'title-only' : 'fuzzy'
      const yearText = group['first-release-date']?.slice(0, 4)
      const year = yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : undefined
      return {
        id: group.id,
        title: group.title,
        artist,
        year,
        score: Number(group.score ?? 0),
        confidence,
        titleSimilarity,
        artistSimilarity,
        matchKind,
        primaryType: group['primary-type'],
        coverUrl: coverUrlFor(group.id),
        weak: confidence < 0.9 || titleSimilarity < 0.85 || (artistSimilarity !== undefined && artistSimilarity < 0.8),
      }
    })
    .sort(candidateSort)
}

function mergeCandidates(...candidateGroups: CatalogCandidate[][]): CatalogCandidate[] {
  const merged = new Map<string, CatalogCandidate>()
  for (const candidate of candidateGroups.flat()) {
    const existing = merged.get(candidate.id)
    if (!existing || candidateSort(candidate, existing) < 0) merged.set(candidate.id, candidate)
  }
  return [...merged.values()].sort(candidateSort)
}

export function automaticMatch(candidates: readonly CatalogCandidate[]): CatalogCandidate | undefined {
  const topCandidate = candidates[0]
  if (!topCandidate) return undefined
  if (topCandidate.matchKind === 'exact') return topCandidate

  if (topCandidate.artistSimilarity === undefined) {
    const exactTitleCandidates = candidates.filter((candidate) => candidate.titleSimilarity === 1)
    return exactTitleCandidates.length === 1 ? exactTitleCandidates[0] : undefined
  }

  const runnerUpConfidence = candidates[1]?.confidence ?? 0
  return (
    topCandidate.titleSimilarity >= 0.96 &&
    topCandidate.artistSimilarity >= 0.92 &&
    topCandidate.confidence >= 0.95 &&
    topCandidate.confidence - runnerUpConfidence >= 0.08
  ) ? topCandidate : undefined
}

function hasUsefulArtistResult(candidates: readonly CatalogCandidate[]): boolean {
  const topCandidate = candidates[0]
  return Boolean(
    topCandidate &&
    topCandidate.titleSimilarity >= 0.75 &&
    (topCandidate.artistSimilarity === undefined || topCandidate.artistSimilarity >= 0.7),
  )
}

function httpsCoverUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol === 'http:') url.protocol = 'https:'
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function mapCoverArtResponse(response: CoverArtResponse): CatalogCoverResult {
  const front = response.images?.find((image) => image.front === true && image.approved !== false)
  const url = httpsCoverUrl(front?.thumbnails?.['500'] ?? front?.thumbnails?.large ?? front?.image)
  return url ? { status: 'available', url } : { status: 'missing' }
}

export class MusicBrainzClient {
  private readonly fetchImpl: typeof fetch
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'>
  private readonly now: () => number
  private readonly wait: (milliseconds: number) => Promise<void>
  private nextRequestAt = 0
  private searchTail: Promise<void> = Promise.resolve()
  private activeCoverRequests = 0
  private readonly coverWaiters: Array<() => void> = []

  constructor(options: MusicBrainzClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.storage = options.storage ?? localStorage
    this.now = options.now ?? Date.now
    this.wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  }

  private async throttle(): Promise<void> {
    const delay = Math.max(0, this.nextRequestAt - this.now())
    if (delay) await this.wait(delay)
    this.nextRequestAt = this.now() + REQUEST_INTERVAL_MS
  }

  private async searchRequest(title: string, artist: string, strategy: SearchStrategy): Promise<CatalogCandidate[]> {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.throttle()
        const response = await this.fetchImpl(buildSearchUrl(title, artist, strategy), {
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) throw new Error(`MusicBrainz returned ${response.status}`)
          throw new PermanentCatalogError(`MusicBrainz search failed (${response.status})`)
        }
        return mapMusicBrainzResults((await response.json()) as MusicBrainzResponse, title, artist, strategy)
      } catch (error) {
        lastError = error
        if (error instanceof PermanentCatalogError) throw error
        if (attempt < 2) await this.wait((attempt + 1) * 750)
      }
    }
    throw lastError instanceof Error ? lastError : new Error('MusicBrainz is unavailable right now.')
  }

  private enqueueSearch<T>(task: () => Promise<T>): Promise<T> {
    const result = this.searchTail.then(task, task)
    this.searchTail = result.then(() => undefined, () => undefined)
    return result
  }

  private async editionRequest(releaseGroupId: string, offset: number): Promise<TrackCatalogEntry> {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.throttle()
        const response = await this.fetchImpl(buildEditionsUrl(releaseGroupId, offset), { headers: { Accept: 'application/json' } })
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) throw new Error(`MusicBrainz returned ${response.status}`)
          throw new PermanentCatalogError(`MusicBrainz editions failed (${response.status})`)
        }
        return mapEditionResponse((await response.json()) as MusicBrainzEditionResponse, releaseGroupId)
      } catch (error) {
        lastError = error
        if (error instanceof PermanentCatalogError) throw error
        if (attempt < 2) await this.wait((attempt + 1) * 750)
      }
    }
    throw lastError instanceof Error ? lastError : new Error('MusicBrainz editions are unavailable right now.')
  }

  async editions(releaseGroupId: string, offset = 0, bypassCache = false): Promise<TrackCatalogEntry> {
    const cacheKey = `${releaseGroupId}:${Math.max(0, offset)}`
    const cached = loadCatalogCache(this.storage).tracklists[cacheKey]
    if (!bypassCache && cached && cached.expiresAt > this.now()) return cached.result

    return this.enqueueSearch(async () => {
      const queued = loadCatalogCache(this.storage).tracklists[cacheKey]
      if (!bypassCache && queued && queued.expiresAt > this.now()) return queued.result
      const result = await this.editionRequest(releaseGroupId, offset)
      const latestCache = loadCatalogCache(this.storage)
      latestCache.tracklists[cacheKey] = { expiresAt: this.now() + CACHE_TTL_MS, result }
      saveCatalogCache(latestCache, this.storage)
      return result
    })
  }

  async search(title: string, artist: string, bypassCache = false): Promise<CatalogCandidate[]> {
    const key = `${normalizeCatalogValue(title)}::${normalizeCatalogValue(artist)}`
    const cache = loadCatalogCache(this.storage)
    const cached = cache.entries[key]
    if (!bypassCache && cached && cached.expiresAt > this.now()) return cached.results

    return this.enqueueSearch(async () => {
      const queuedCache = loadCatalogCache(this.storage).entries[key]
      if (!bypassCache && queuedCache && queuedCache.expiresAt > this.now()) return queuedCache.results

      let candidates = await this.searchRequest(title, artist, 'fuzzy')
      if (!automaticMatch(candidates) && !hasUsefulArtistResult(candidates) && normalizeCatalogValue(artist) !== 'unknown artist') {
        try {
          candidates = mergeCandidates(candidates, await this.searchRequest(title, artist, 'title-only'))
        } catch (error) {
          if (!candidates.length) throw error
        }
      }

      const results = candidates.slice(0, RESULT_LIMIT)
      const latestCache = loadCatalogCache(this.storage)
      latestCache.entries[key] = { expiresAt: this.now() + CACHE_TTL_MS, results }
      saveCatalogCache(latestCache, this.storage)
      return results
    })
  }

  private async acquireCoverSlot(): Promise<void> {
    if (this.activeCoverRequests < COVER_CONCURRENCY) {
      this.activeCoverRequests += 1
      return
    }
    await new Promise<void>((resolve) => this.coverWaiters.push(resolve))
    this.activeCoverRequests += 1
  }

  private releaseCoverSlot(): void {
    this.activeCoverRequests -= 1
    this.coverWaiters.shift()?.()
  }

  async resolveCover(releaseGroupId: string, bypassCache = false): Promise<CoverLookupResult> {
    let cache = loadCatalogCache(this.storage)
    const cached = cache.covers[releaseGroupId]
    if (!bypassCache && cached && cached.expiresAt > this.now()) return cached.result

    await this.acquireCoverSlot()
    try {
      cache = loadCatalogCache(this.storage)
      const queuedCache = cache.covers[releaseGroupId]
      if (!bypassCache && queuedCache && queuedCache.expiresAt > this.now()) return queuedCache.result
      let lastError: unknown
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await this.fetchImpl(coverMetadataUrlFor(releaseGroupId), {
            headers: { Accept: 'application/json' },
          })
          if (response.status === 404) {
            const result: CatalogCoverResult = { status: 'missing' }
            const latestCache = loadCatalogCache(this.storage)
            latestCache.covers[releaseGroupId] = { expiresAt: this.now() + CACHE_TTL_MS, result }
            saveCatalogCache(latestCache, this.storage)
            return result
          }
          if (!response.ok) {
            if (response.status === 429 || response.status >= 500) throw new Error(`Cover Art Archive returned ${response.status}`)
            return { status: 'error', error: `Cover check failed (${response.status})` }
          }
          const result = mapCoverArtResponse((await response.json()) as CoverArtResponse)
          const latestCache = loadCatalogCache(this.storage)
          latestCache.covers[releaseGroupId] = { expiresAt: this.now() + CACHE_TTL_MS, result }
          saveCatalogCache(latestCache, this.storage)
          return result
        } catch (error) {
          lastError = error
          if (attempt < 2) await this.wait((attempt + 1) * 500)
        }
      }
      return {
        status: 'error',
        error: lastError instanceof Error ? lastError.message : 'Cover Art Archive is unavailable right now.',
      }
    } finally {
      this.releaseCoverSlot()
    }
  }
}
