import { useEffect, useState } from 'react'

interface AlbumArtProps {
  src?: string
  title: string
  artist: string
  className?: string
  fallback?: 'record' | 'artist'
}

function artistInitials(artist: string): string {
  const words = artist.split(/\s+/).filter((word) => word && !['the', 'and', '&'].includes(word.toLowerCase()))
  return (words.length > 1 ? `${words[0][0]}${words.at(-1)?.[0] ?? ''}` : words[0]?.slice(0, 2) ?? '?').toUpperCase()
}

export function AlbumArt({ src, title, artist, className = '', fallback = 'record' }: AlbumArtProps) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setFailed(false)
    setLoaded(false)
  }, [src])

  if (!src || failed) {
    return (
      <div className={`album-art album-art--placeholder album-art--${fallback} ${className}`} role="img" aria-label={`No cover for ${title} by ${artist}`}>
        {fallback === 'artist' ? (
          <><span className="artist-portrait" aria-hidden="true" /><span className="artist-initials" aria-hidden="true">{artistInitials(artist)}</span></>
        ) : (
          <><span className="placeholder-record" aria-hidden="true" /><span>{title.slice(0, 1) || 'S'}</span></>
        )}
      </div>
    )
  }

  return (
    <div
      className={`album-art album-art--remote ${loaded ? 'album-art--loaded' : 'album-art--loading'} ${className}`}
      role="img"
      aria-label={`${title} — ${artist} cover`}
      aria-busy={!loaded}
    >
      {!loaded && <span className="artwork-skeleton" aria-hidden="true"><i /><i /><i /></span>}
      <img
        className="album-art__image"
        src={src}
        alt=""
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  )
}
