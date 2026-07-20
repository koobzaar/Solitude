import { normalizeValue } from './importParser'
import type {
  Album,
  AlbumTrackProfile,
  ManualTrackSummary,
  TrackAnalysisSnapshot,
  TrackProfileSnapshot,
} from './types'

export const DEFAULT_HEART_WEIGHT = 0.75

export function albumProfileKey(album: Pick<Album, 'releaseGroupId' | 'title' | 'artist'>): string {
  return album.releaseGroupId
    ? `mb:${album.releaseGroupId}`
    : `manual:${normalizeValue(album.title)}::${normalizeValue(album.artist)}`
}

export function validateManualSummary(summary: ManualTrackSummary): string | undefined {
  const values = [summary.trackCount, summary.likedCount]
  if (values.some((value) => !Number.isInteger(value) || value < 0)) return 'Use whole numbers of zero or more.'
  if (summary.trackCount < 1) return 'Enter at least one track.'
  if (summary.likedCount > summary.trackCount) return 'Liked tracks cannot exceed the track total.'
  return undefined
}

export function snapshotProfile(albumId: string, profile: AlbumTrackProfile): TrackProfileSnapshot {
  if (profile.reviewState === 'skipped') {
    return {
      albumId,
      reviewState: 'skipped',
      source: 'skipped',
      trackCount: 0,
      likedCount: 0,
      successes: 0,
    }
  }

  if (profile.manualSummary) {
    const { trackCount, likedCount } = profile.manualSummary
    return {
      albumId,
      reviewState: 'reviewed',
      source: 'manual',
      trackCount,
      likedCount,
      successes: likedCount,
    }
  }

  const trackIds = new Set(profile.tracks.map((track) => track.id))
  const likedCount = new Set(profile.likedTrackIds.filter((trackId) => trackIds.has(trackId))).size
  return {
    albumId,
    reviewState: 'reviewed',
    source: 'catalog',
    editionId: profile.editionId,
    editionTitle: profile.editionTitle,
    trackCount: profile.tracks.length,
    likedCount,
    successes: likedCount,
  }
}

export function buildTrackAnalysisSnapshot(
  albums: readonly Album[],
  profiles: Readonly<Record<string, AlbumTrackProfile>>,
  createdAt = new Date().toISOString(),
): TrackAnalysisSnapshot {
  const snapshots: Record<string, TrackProfileSnapshot> = {}
  for (const album of albums) {
    const profile = profiles[albumProfileKey(album)]
    if (profile) snapshots[album.id] = snapshotProfile(album.id, profile)
  }

  const reviewed = Object.values(snapshots).filter((profile) => profile.reviewState === 'reviewed' && profile.trackCount > 0)
  const totalSuccesses = reviewed.reduce((sum, profile) => sum + profile.successes, 0)
  const totalTracks = reviewed.reduce((sum, profile) => sum + profile.trackCount, 0)
  const collectionMean = (totalSuccesses + 4) / (totalTracks + 8)
  const recordScores: Record<string, number> = {}
  for (const profile of reviewed) {
    recordScores[profile.albumId] = (profile.successes + 8 * collectionMean) / (profile.trackCount + 8)
  }
  return { createdAt, profiles: snapshots, collectionMean, recordScores }
}

export function standardizeScores(
  ids: readonly string[],
  scores: Readonly<Record<string, number>>,
): Record<string, number> {
  const present = ids.filter((id) => Number.isFinite(scores[id]))
  if (!present.length) return Object.fromEntries(ids.map((id) => [id, 0]))
  const mean = present.reduce((sum, id) => sum + scores[id], 0) / present.length
  const variance = present.reduce((sum, id) => sum + (scores[id] - mean) ** 2, 0) / present.length
  const deviation = Math.sqrt(variance)
  return Object.fromEntries(ids.map((id) => [id, deviation > 1e-12 && Number.isFinite(scores[id]) ? (scores[id] - mean) / deviation : 0]))
}

export function blendedScores(
  albumIds: readonly string[],
  heartScores: Readonly<Record<string, number>>,
  recordScores: Readonly<Record<string, number>>,
  heartWeight = DEFAULT_HEART_WEIGHT,
): Record<string, number> {
  const weight = Math.min(1, Math.max(0, heartWeight))
  const heartZ = standardizeScores(albumIds, heartScores)
  const reviewedIds = albumIds.filter((id) => Number.isFinite(recordScores[id]))
  const recordZ = standardizeScores(reviewedIds, recordScores)
  return Object.fromEntries(albumIds.map((id) => [id, weight * heartZ[id] + (1 - weight) * (recordZ[id] ?? 0)]))
}

export interface DisagreementAlert {
  firstId: string
  secondId: string
  heartHigherId: string
  trackHigherId: string
  strength: number
}

export function findDisagreements(
  albumIds: readonly string[],
  heartScores: Readonly<Record<string, number>>,
  recordScores: Readonly<Record<string, number>>,
  limit = 5,
): DisagreementAlert[] {
  const reviewedIds = albumIds.filter((id) => Number.isFinite(recordScores[id]))
  const heartZ = standardizeScores(albumIds, heartScores)
  const recordZ = standardizeScores(reviewedIds, recordScores)
  const alerts: DisagreementAlert[] = []
  for (let first = 0; first < reviewedIds.length; first += 1) {
    for (let second = first + 1; second < reviewedIds.length; second += 1) {
      const firstId = reviewedIds[first]
      const secondId = reviewedIds[second]
      const heartGap = heartZ[firstId] - heartZ[secondId]
      const trackGap = recordZ[firstId] - recordZ[secondId]
      if (heartGap * trackGap >= 0 || Math.abs(heartGap) < 0.75 || Math.abs(trackGap) < 0.75) continue
      alerts.push({
        firstId,
        secondId,
        heartHigherId: heartGap > 0 ? firstId : secondId,
        trackHigherId: trackGap > 0 ? firstId : secondId,
        strength: Math.min(Math.abs(heartGap), Math.abs(trackGap)),
      })
    }
  }
  return alerts.sort((left, right) => right.strength - left.strength || left.firstId.localeCompare(right.firstId) || left.secondId.localeCompare(right.secondId)).slice(0, limit)
}
