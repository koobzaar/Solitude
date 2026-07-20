import type { ReactNode } from 'react'

interface HeaderProps {
  onHome: () => void
  trailing?: ReactNode
}

export function Header({ onHome, trailing }: HeaderProps) {
  return (
    <header className="site-header">
      <button className="wordmark" type="button" onClick={onHome} aria-label="Return to collection library">
        <span className="wordmark-mark" aria-hidden="true"><i /></span>
        <span>Solitude</span>
      </button>
      {trailing && <div className="header-trailing">{trailing}</div>}
    </header>
  )
}

export function Footer() {
  return (
    <footer className="site-footer">
      <p>Made for considered listening. Your library stays in this browser.</p>
      <p>
        Metadata by <a href="https://musicbrainz.org" target="_blank" rel="noreferrer">MusicBrainz</a>
        {' · '}Cover art by <a href="https://coverartarchive.org" target="_blank" rel="noreferrer">Cover Art Archive</a>
      </p>
    </footer>
  )
}
