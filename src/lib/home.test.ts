import { describe, expect, it } from 'vitest'
import type { Album, Collection } from './types'
import { albumCoverUrl, firstCollectionAlbums, firstLibraryAlbums } from './home'

function album(id: string, update: Partial<Album> = {}): Album {
  return { id, title: `Album ${id}`, artist: `Artist ${id}`, sourceText: id, matchStatus: 'manual', ...update }
}

function collection(id: string, albums: Album[]): Collection {
  return {
    id,
    name: `Collection ${id}`,
    albums,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    completedRuns: [],
  }
}

describe('home cover selection', () => {
  it('selects the deterministic first N albums without skipping placeholders', () => {
    const albums = [album('first'), album('second', { coverUrl: 'https://example.com/second.jpg' }), album('third')]
    const shelf = collection('one', albums)
    expect(firstCollectionAlbums(shelf, 2).map((item) => item.id)).toEqual(['first', 'second'])
    expect(firstCollectionAlbums(shelf, 2).map((item) => item.id)).toEqual(['first', 'second'])
  })

  it('selects hero albums in stable collection and album order', () => {
    const collections = [collection('one', [album('a'), album('b')]), collection('two', [album('c'), album('d')])]
    expect(firstLibraryAlbums(collections, 3).map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(firstLibraryAlbums(collections, 0)).toEqual([])
  })

  it('uses stored HTTPS art, derives legacy release-group art, and preserves missing placeholders', () => {
    expect(albumCoverUrl(album('custom', { coverUrl: 'https://example.com/custom.jpg', coverStatus: 'custom' })))
      .toBe('https://example.com/custom.jpg')
    expect(albumCoverUrl(album('legacy', { releaseGroupId: 'release-group-id' })))
      .toBe('https://coverartarchive.org/release-group/release-group-id/front-500')
    expect(albumCoverUrl(album('missing', { releaseGroupId: 'release-group-id', coverStatus: 'missing' }))).toBeUndefined()
    expect(albumCoverUrl(album('unsafe', { coverUrl: 'http://example.com/unsafe.jpg' }))).toBeUndefined()
  })
})
