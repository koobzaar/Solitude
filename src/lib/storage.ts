import type { CatalogCacheV3, Collection, StoredStateV1, StoredStateV2 } from './types'
import { BATTLE_ALGORITHM_VERSION, STORAGE_VERSION } from './types'

export const DATA_STORAGE_KEY = 'solitude:data:v2'
export const LEGACY_DATA_STORAGE_KEY = 'solitude:data:v1'
// The cache key stays stable so v2 search and cover metadata can migrate in place.
export const CATALOG_STORAGE_KEY = 'solitude:catalog:v2'

export interface LoadResult {
  state: StoredStateV2
  recovered: boolean
  notice?: string
}

export interface SaveResult {
  ok: boolean
  error?: string
}

export function createInitialState(): StoredStateV2 {
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

function isStoredStateV2(value: unknown): value is StoredStateV2 {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredStateV2>
  return (
    candidate.version === STORAGE_VERSION &&
    hasValidCollections(candidate.collections) &&
    Array.isArray(candidate.learnedPaceSamples) &&
    Boolean(candidate.trackProfiles) &&
    typeof candidate.trackProfiles === 'object'
  )
}

function isStoredStateV1(value: unknown): value is StoredStateV1 {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredStateV1>
  return candidate.version === 1 && hasValidCollections(candidate.collections) && Array.isArray(candidate.learnedPaceSamples)
}

function clearLegacyActiveRuns(collections: readonly Collection[]): { collections: Collection[]; cleared: boolean } {
  let cleared = false
  return {
    collections: collections.map((collection) => {
      if (!collection.activeRun || collection.activeRun.algorithmVersion === BATTLE_ALGORITHM_VERSION) return collection
      cleared = true
      return { ...collection, activeRun: undefined }
    }),
    cleared,
  }
}

function migrateV1(state: StoredStateV1): LoadResult {
  const migrated = clearLegacyActiveRuns(state.collections)
  return {
    state: {
      version: STORAGE_VERSION,
      collections: migrated.collections,
      currentCollectionId: state.currentCollectionId,
      learnedPaceSamples: state.learnedPaceSamples,
      trackProfiles: {},
    },
    recovered: false,
    notice: migrated.cleared
      ? 'Solitude upgraded its ranking model. One unfinished legacy battle was cleared; completed rankings are still in your history.'
      : undefined,
  }
}

function parseState(raw: string): LoadResult | undefined {
  const parsed: unknown = JSON.parse(raw)
  if (isStoredStateV1(parsed)) return migrateV1(parsed)
  if (!isStoredStateV2(parsed)) return undefined
  const normalized = clearLegacyActiveRuns(parsed.collections)
  return {
    state: normalized.cleared ? { ...parsed, collections: normalized.collections } : parsed,
    recovered: false,
    notice: normalized.cleared
      ? 'Solitude upgraded its ranking model. One unfinished legacy battle was cleared; completed rankings are still in your history.'
      : undefined,
  }
}

export function loadState(storage: Pick<Storage, 'getItem'> = localStorage): LoadResult {
  try {
    const current = storage.getItem(DATA_STORAGE_KEY)
    if (current) {
      const loaded = parseState(current)
      return loaded ?? { state: createInitialState(), recovered: true }
    }
    const legacy = storage.getItem(LEGACY_DATA_STORAGE_KEY)
    if (!legacy) return { state: createInitialState(), recovered: false }
    const loaded = parseState(legacy)
    return loaded ?? { state: createInitialState(), recovered: true }
  } catch {
    return { state: createInitialState(), recovered: true }
  }
}

export function saveState(
  state: StoredStateV2,
  storage: Pick<Storage, 'setItem'> = localStorage,
): SaveResult {
  try {
    storage.setItem(DATA_STORAGE_KEY, JSON.stringify(state))
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Browser storage is unavailable.',
    }
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
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Catalog cache could not be saved.' }
  }
}
