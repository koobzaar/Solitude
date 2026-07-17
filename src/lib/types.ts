export const STORAGE_VERSION = 1 as const

export type MatchStatus = 'pending' | 'matched' | 'weak' | 'manual' | 'error'
export type CatalogMatchKind = 'exact' | 'fuzzy' | 'title-only'
export type CoverStatus = 'checking' | 'available' | 'missing' | 'error' | 'custom'

export interface Album {
  id: string
  title: string
  artist: string
  year?: number
  coverUrl?: string
  releaseGroupId?: string
  sourceText: string
  matchStatus: MatchStatus
  matchConfidence?: number
  matchKind?: CatalogMatchKind
  automaticMatch?: boolean
  coverStatus?: CoverStatus
}

export interface CatalogCandidate {
  id: string
  title: string
  artist: string
  year?: number
  score: number
  confidence: number
  titleSimilarity: number
  artistSimilarity?: number
  matchKind: CatalogMatchKind
  primaryType?: string
  coverUrl?: string
  weak: boolean
}

export type RankingMode = 'quick' | 'balanced' | 'thorough'

export interface BattleDecision {
  winnerId: string
  loserId: string
  chosenAt: string
  durationMs: number
}

export interface BattleRun {
  id: string
  mode: RankingMode
  seed: number
  decisions: BattleDecision[]
  status: 'active' | 'completed'
  createdAt: string
  updatedAt: string
  completedAt?: string
  paceSamples: number[]
  finalRanking?: string[]
  albumSnapshot?: Album[]
}

export interface Collection {
  id: string
  name: string
  vibe?: string
  note?: string
  albums: Album[]
  createdAt: string
  updatedAt: string
  activeRun?: BattleRun
  completedRuns: BattleRun[]
}

export interface StoredStateV1 {
  version: typeof STORAGE_VERSION
  collections: Collection[]
  currentCollectionId?: string
  learnedPaceSamples: number[]
}

export interface CatalogCacheEntry {
  expiresAt: number
  results: CatalogCandidate[]
}

export interface CatalogCoverResult {
  status: 'available' | 'missing'
  url?: string
}

export interface CatalogCoverCacheEntry {
  expiresAt: number
  result: CatalogCoverResult
}

export interface CatalogCacheV2 {
  version: 2
  entries: Record<string, CatalogCacheEntry>
  covers: Record<string, CatalogCoverCacheEntry>
}
