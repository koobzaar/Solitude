import type { CatalogCacheV2, StoredStateV1 } from './types'
import { STORAGE_VERSION } from './types'

export const DATA_STORAGE_KEY = 'solitude:data:v1'
export const CATALOG_STORAGE_KEY = 'solitude:catalog:v2'

export interface LoadResult {
  state: StoredStateV1
  recovered: boolean
}

export interface SaveResult {
  ok: boolean
  error?: string
}

export function createInitialState(): StoredStateV1 {
  return {
    version: STORAGE_VERSION,
    collections: [],
    learnedPaceSamples: [],
  }
}

function isStoredState(value: unknown): value is StoredStateV1 {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredStateV1>
  return (
    candidate.version === STORAGE_VERSION &&
    Array.isArray(candidate.collections) &&
    candidate.collections.every(
      (collection) =>
        collection &&
        typeof collection.id === 'string' &&
        typeof collection.name === 'string' &&
        Array.isArray(collection.albums) &&
        Array.isArray(collection.completedRuns),
    ) &&
    Array.isArray(candidate.learnedPaceSamples)
  )
}

export function loadState(storage: Pick<Storage, 'getItem'> = localStorage): LoadResult {
  try {
    const raw = storage.getItem(DATA_STORAGE_KEY)
    if (!raw) return { state: createInitialState(), recovered: false }
    const parsed: unknown = JSON.parse(raw)
    if (!isStoredState(parsed)) return { state: createInitialState(), recovered: true }
    return { state: parsed, recovered: false }
  } catch {
    return { state: createInitialState(), recovered: true }
  }
}

export function saveState(
  state: StoredStateV1,
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

export function loadCatalogCache(storage: Pick<Storage, 'getItem'> = localStorage): CatalogCacheV2 {
  try {
    const raw = storage.getItem(CATALOG_STORAGE_KEY)
    if (!raw) return { version: 2, entries: {}, covers: {} }
    const parsed = JSON.parse(raw) as Partial<CatalogCacheV2>
    if (parsed.version !== 2 || !parsed.entries || typeof parsed.entries !== 'object') {
      return { version: 2, entries: {}, covers: {} }
    }
    return {
      version: 2,
      entries: parsed.entries,
      covers: parsed.covers && typeof parsed.covers === 'object' ? parsed.covers : {},
    }
  } catch {
    return { version: 2, entries: {}, covers: {} }
  }
}

export function saveCatalogCache(
  cache: CatalogCacheV2,
  storage: Pick<Storage, 'setItem'> = localStorage,
): SaveResult {
  try {
    storage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(cache))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Catalog cache could not be saved.' }
  }
}
