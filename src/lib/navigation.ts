import type { RankingMode, StoredStateV3 } from './types'

export const NAVIGATION_STORAGE_KEY = 'solitude:navigation:v1'

export type Screen = 'library' | 'import' | 'review' | 'mode' | 'battle' | 'results' | 'track-review'

export interface NavigationStateV1 {
  version: 1
  screen: Screen
  collectionId?: string
  runId?: string
  importDraft?: string
  swapColumns?: boolean
  selectedMode?: RankingMode
  trackReviewAlbumId?: string
}

export interface NavigationLoadResult {
  navigation: NavigationStateV1
  invalid: boolean
}

export function libraryNavigation(): NavigationStateV1 {
  return { version: 1, screen: 'library' }
}

function isMode(value: unknown): value is RankingMode {
  return value === 'quick' || value === 'balanced' || value === 'thorough'
}

function parseNavigation(value: unknown): NavigationStateV1 | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<NavigationStateV1>
  const screens: Screen[] = ['library', 'import', 'review', 'mode', 'battle', 'results', 'track-review']
  if (candidate.version !== 1 || !candidate.screen || !screens.includes(candidate.screen)) return undefined
  if (candidate.collectionId !== undefined && typeof candidate.collectionId !== 'string') return undefined
  if (candidate.runId !== undefined && typeof candidate.runId !== 'string') return undefined
  if (candidate.importDraft !== undefined && typeof candidate.importDraft !== 'string') return undefined
  if (candidate.swapColumns !== undefined && typeof candidate.swapColumns !== 'boolean') return undefined
  if (candidate.selectedMode !== undefined && !isMode(candidate.selectedMode)) return undefined
  if (candidate.trackReviewAlbumId !== undefined && typeof candidate.trackReviewAlbumId !== 'string') return undefined
  return candidate as NavigationStateV1
}

export function validateNavigation(navigation: NavigationStateV1, state: StoredStateV3): boolean {
  if (navigation.screen === 'library') return true
  const collection = state.collections.find((candidate) => candidate.id === navigation.collectionId)
  if (!collection) return false
  if (navigation.screen === 'import' || navigation.screen === 'review' || navigation.screen === 'mode') return true
  if (navigation.screen === 'battle') return Boolean(collection.activeRun && collection.activeRun.id === navigation.runId)
  const run = collection.completedRuns.find((candidate) => candidate.id === navigation.runId)
  if (!run) return false
  if (navigation.screen === 'track-review' && navigation.trackReviewAlbumId) {
    const albums = run.albumSnapshot ?? collection.albums
    return albums.some((album) => album.id === navigation.trackReviewAlbumId)
  }
  return true
}

export function loadNavigation(
  state: StoredStateV3,
  storage: Pick<Storage, 'getItem'> = sessionStorage,
): NavigationLoadResult {
  try {
    const raw = storage.getItem(NAVIGATION_STORAGE_KEY)
    if (!raw) return { navigation: libraryNavigation(), invalid: false }
    const parsed = parseNavigation(JSON.parse(raw))
    if (!parsed || !validateNavigation(parsed, state)) return { navigation: libraryNavigation(), invalid: true }
    return { navigation: parsed, invalid: false }
  } catch {
    return { navigation: libraryNavigation(), invalid: true }
  }
}

export function saveNavigation(
  navigation: NavigationStateV1,
  storage: Pick<Storage, 'setItem'> = sessionStorage,
): boolean {
  try {
    storage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify(navigation))
    return true
  } catch {
    return false
  }
}
