import type { CatalogCacheV3, Collection, StoredStateV3 } from './types'
import { STORAGE_VERSION } from './types'

export const DATA_STORAGE_KEY = 'solitude:data:v3'
// The cache key stays stable so v2 search and cover metadata can migrate in place.
export const CATALOG_STORAGE_KEY = 'solitude:catalog:v2'

export type PersistenceNoticeCode = 'recovered' | 'saveFailed' | 'invalidNavigation'
export type StorageErrorCode = 'unavailable'

export interface LoadResult {
  state: StoredStateV3
  recovered: boolean
  notice?: PersistenceNoticeCode
}

export interface SaveResult {
  ok: boolean
  error?: StorageErrorCode
}

export function createInitialState(): StoredStateV3 {
  return {
    version: STORAGE_VERSION,
    collections: [],
    learnedPaceSamples: [],
    trackProfiles: {},
  }
}

function hasValidCollections(value: unknown): value is Collection[] {
  return Array.isArray(value) && value.every(
    (collection) =>
      collection &&
      typeof collection.id === 'string' &&
      typeof collection.name === 'string' &&
      Array.isArray(collection.albums) &&
      Array.isArray(collection.completedRuns),
  )
}

function isStoredStateV3(value: unknown): value is StoredStateV3 {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredStateV3>
  return (
    candidate.version === STORAGE_VERSION &&
    hasValidCollections(candidate.collections) &&
    Array.isArray(candidate.learnedPaceSamples) &&
    Boolean(candidate.trackProfiles) &&
    typeof candidate.trackProfiles === 'object'
  )
}

function parseState(raw: string): LoadResult | undefined {
  const parsed: unknown = JSON.parse(raw)
  if (!isStoredStateV3(parsed)) return undefined
  return { state: parsed, recovered: false }
}

export function loadState(storage: Pick<Storage, 'getItem'> = localStorage): LoadResult {
  try {
    const current = storage.getItem(DATA_STORAGE_KEY)
    if (!current) return { state: createInitialState(), recovered: false }
    const loaded = parseState(current)
    return loaded ?? { state: createInitialState(), recovered: true }
  } catch {
    return { state: createInitialState(), recovered: true }
  }
}

export function saveState(
  state: StoredStateV3,
  storage: Pick<Storage, 'setItem'> = localStorage,
): SaveResult {
  try {
    storage.setItem(DATA_STORAGE_KEY, JSON.stringify(state))
    return { ok: true }
  } catch {
    return { ok: false, error: 'unavailable' }
  }
}

function emptyCatalogCache(): CatalogCacheV3 {
  return { version: 3, entries: {}, covers: {}, tracklists: {} }
}

export function loadCatalogCache(storage: Pick<Storage, 'getItem'> = localStorage): CatalogCacheV3 {
  try {
    const raw = storage.getItem(CATALOG_STORAGE_KEY)
    if (!raw) return emptyCatalogCache()
    const parsed = JSON.parse(raw) as {
      version?: number
      entries?: CatalogCacheV3['entries']
      covers?: CatalogCacheV3['covers']
      tracklists?: CatalogCacheV3['tracklists']
    }
    if (!parsed.entries || typeof parsed.entries !== 'object') return emptyCatalogCache()
    if (parsed.version !== 2 && parsed.version !== 3) return emptyCatalogCache()
    return {
      version: 3,
      entries: parsed.entries,
      covers: parsed.covers && typeof parsed.covers === 'object' ? parsed.covers : {},
      tracklists: parsed.version === 3 && parsed.tracklists && typeof parsed.tracklists === 'object' ? parsed.tracklists : {},
    }
  } catch {
    return emptyCatalogCache()
  }
}

export function saveCatalogCache(
  cache: CatalogCacheV3,
  storage: Pick<Storage, 'setItem'> = localStorage,
): SaveResult {
  try {
    storage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(cache))
    return { ok: true }
  } catch {
    return { ok: false, error: 'unavailable' }
  }
}
