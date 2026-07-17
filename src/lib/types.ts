export const STORAGE_VERSION = 2 as const
export const BATTLE_ALGORITHM_VERSION = 'bt-v1' as const

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

export type PositiveTrackRating = 'like' | 'love'
export type TrackReviewState = 'reviewed' | 'skipped'

export interface TrackRecording {
  id: string
  title: string
  position: number
  mediumPosition: number
  lengthMs?: number
}

export interface TrackEdition {
  id: string
  title: string
  status?: string
  date?: string
  country?: string
  disambiguation?: string
  format?: string
  trackCount: number
  tracks: TrackRecording[]
}

export interface TrackCatalogEntry {
  releaseGroupId: string
  editions: TrackEdition[]
  offset: number
  releaseCount: number
  hasMore: boolean
}

export interface ManualTrackSummary {
  trackCount: number
  likedCount: number
  lovedCount: number
}

export interface AlbumTrackProfile {
  albumKey: string
  releaseGroupId?: string
  editionId?: string
  editionTitle?: string
  tracks: TrackRecording[]
  ratings: Record<string, PositiveTrackRating>
  manualSummary?: ManualTrackSummary
  reviewState: TrackReviewState
  updatedAt: string
}

export interface TrackProfileSnapshot {
  albumId: string
  reviewState: TrackReviewState
  source: 'catalog' | 'manual' | 'skipped'
  editionId?: string
  editionTitle?: string
  trackCount: number
  likedCount: number
  lovedCount: number
  successes: number
}

export interface TrackAnalysisSnapshot {
  createdAt: string
  profiles: Record<string, TrackProfileSnapshot>
  collectionMean: number
  recordScores: Record<string, number>
}

export interface BattleRun {
  id: string
  mode: RankingMode
  seed: number
  algorithmVersion?: typeof BATTLE_ALGORITHM_VERSION
  decisions: BattleDecision[]
  status: 'active' | 'completed'
  createdAt: string
  updatedAt: string
  completedAt?: string
  paceSamples: number[]
  finalRanking?: string[]
  heartScores?: Record<string, number>
  sliderWeight?: number
  trackAnalysis?: TrackAnalysisSnapshot
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
  version: 1
  collections: Collection[]
  currentCollectionId?: string
  learnedPaceSamples: number[]
}

export interface StoredStateV2 {
  version: typeof STORAGE_VERSION
  collections: Collection[]
  currentCollectionId?: string
  learnedPaceSamples: number[]
  trackProfiles: Record<string, AlbumTrackProfile>
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

export interface TrackCatalogCacheEntry {
  expiresAt: number
  result: TrackCatalogEntry
}

export interface CatalogCacheV2 {
  version: 2
  entries: Record<string, CatalogCacheEntry>
  covers: Record<string, CatalogCoverCacheEntry>
}

export interface CatalogCacheV3 {
  version: 3
  entries: Record<string, CatalogCacheEntry>
  covers: Record<string, CatalogCoverCacheEntry>
  tracklists: Record<string, TrackCatalogCacheEntry>
}
