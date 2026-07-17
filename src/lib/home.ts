import { coverUrlFor } from './musicbrainz'
import type { Album, Collection } from './types'

export function albumCoverUrl(album: Album): string | undefined {
  if (album.coverStatus === 'missing' || album.coverStatus === 'error') return undefined
  if (album.coverUrl?.startsWith('https://')) return album.coverUrl
  return album.releaseGroupId ? coverUrlFor(album.releaseGroupId) : undefined
}

export function firstCollectionAlbums(collection: Collection, count: number): Album[] {
  return collection.albums.slice(0, Math.max(0, count))
}

export function firstLibraryAlbums(collections: readonly Collection[], count: number): Album[] {
  if (count <= 0) return []
  const albums: Album[] = []
  for (const collection of collections) {
    for (const album of collection.albums) {
      albums.push(album)
      if (albums.length === count) return albums
    }
  }
  return albums
}
