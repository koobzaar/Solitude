import { describe, expect, it } from 'vitest'
import type { Album, AlbumTrackProfile } from './types'
import { albumProfileKey, blendedScores, buildTrackAnalysisSnapshot, findDisagreements, standardizeScores, validateManualSummary } from './trackAnalysis'

const albums: Album[] = [
  { id: 'a', title: 'A', artist: 'Artist', sourceText: 'A', matchStatus: 'manual' },
  { id: 'b', title: 'B', artist: 'Artist', sourceText: 'B', matchStatus: 'manual' },
  { id: 'c', title: 'C', artist: 'Artist', sourceText: 'C', matchStatus: 'manual' },
]

function manual(album: Album, trackCount: number, likedCount: number): AlbumTrackProfile {
  return {
    albumKey: albumProfileKey(album), tracks: [], likedTrackIds: [], reviewState: 'reviewed', updatedAt: '2026-01-01',
    manualSummary: { trackCount, likedCount },
  }
}

describe('track analysis', () => {
  it('validates manual like counts', () => {
    expect(validateManualSummary({ trackCount: 10, likedCount: 4 })).toBeUndefined()
    expect(validateManualSummary({ trackCount: 5, likedCount: 6 })).toMatch(/cannot exceed/i)
    expect(validateManualSummary({ trackCount: 4.5, likedCount: 1 })).toMatch(/whole numbers/i)
  })

  it('counts each Like as one success and applies eight-track shrinkage', () => {
    const profiles = {
      [albumProfileKey(albums[0])]: manual(albums[0], 10, 4),
      [albumProfileKey(albums[1])]: manual(albums[1], 10, 1),
      [albumProfileKey(albums[2])]: { ...manual(albums[2], 10, 0), reviewState: 'skipped' as const },
    }
    const snapshot = buildTrackAnalysisSnapshot(albums, profiles, 'now')
    expect(snapshot.profiles.a.successes).toBe(4)
    expect(snapshot.collectionMean).toBeCloseTo(9 / 28)
    expect(snapshot.recordScores.a).toBeCloseTo((4 + 8 * (9 / 28)) / 18)
    expect(snapshot.recordScores.b).toBeCloseTo((1 + 8 * (9 / 28)) / 18)
    expect(snapshot.recordScores.c).toBeUndefined()
  })

  it('counts only unique liked tracks from the selected catalog edition', () => {
    const profile: AlbumTrackProfile = {
      albumKey: albumProfileKey(albums[0]),
      tracks: [
        { id: 'track-1', title: 'One', position: 1, mediumPosition: 1 },
        { id: 'track-2', title: 'Two', position: 2, mediumPosition: 1 },
      ],
      likedTrackIds: ['track-1', 'track-1', 'missing'],
      reviewState: 'reviewed',
      updatedAt: '2026-01-01',
    }
    expect(buildTrackAnalysisSnapshot([albums[0]], { [albumProfileKey(albums[0])]: profile }).profiles.a).toMatchObject({ likedCount: 1, successes: 1 })
  })

  it('handles zero variance, neutral unreviewed albums, slider endpoints, and disagreements', () => {
    expect(standardizeScores(['a', 'b'], { a: 3, b: 3 })).toEqual({ a: 0, b: 0 })
    const heart = { a: 2, b: 0, c: -2 }
    const tracks = { a: 0.1, b: 0.5 }
    expect(blendedScores(['a', 'b', 'c'], heart, tracks, 1)).toEqual(standardizeScores(['a', 'b', 'c'], heart))
    const songsOnly = blendedScores(['a', 'b', 'c'], heart, tracks, 0)
    expect(songsOnly.c).toBe(0)
    expect(findDisagreements(['a', 'b', 'c'], heart, tracks)).toMatchObject([{ heartHigherId: 'a', trackHigherId: 'b' }])
  })
})
