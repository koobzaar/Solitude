import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AlbumArt } from './AlbumArt'

describe('AlbumArt', () => {
  it('falls back to a designed placeholder when a cover is missing', () => {
    render(<AlbumArt title="Blue Train" artist="John Coltrane" />)
    expect(screen.getByRole('img', { name: /no cover for blue train/i })).toBeInTheDocument()
  })

  it('falls back when a remote cover fails to load', () => {
    const { container } = render(<AlbumArt src="https://example.com/missing.jpg" title="Blue Train" artist="John Coltrane" />)
    fireEvent.error(container.querySelector('img')!)
    expect(screen.getByRole('img', { name: /no cover for blue train/i })).toBeInTheDocument()
  })

  it('shows an artwork skeleton until the remote image has loaded', () => {
    const { container } = render(<AlbumArt src="https://example.com/blue-train.jpg" title="Blue Train" artist="John Coltrane" />)
    const artwork = screen.getByRole('img', { name: /blue train.*john coltrane.*cover/i })
    expect(artwork).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('.artwork-skeleton')).toBeInTheDocument()

    fireEvent.load(container.querySelector('img')!)
    expect(artwork).toHaveAttribute('aria-busy', 'false')
    expect(container.querySelector('.artwork-skeleton')).not.toBeInTheDocument()
  })

  it('can use an artist-inspired fallback without requesting another photo service', () => {
    render(<AlbumArt title="Unknown Sleeve" artist="John Coltrane" fallback="artist" />)
    expect(screen.getByRole('img', { name: /no cover for unknown sleeve by john coltrane/i })).toHaveClass('album-art--artist')
    expect(screen.getByText('JC')).toBeInTheDocument()
  })
})
