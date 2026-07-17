import { describe, expect, it } from 'vitest'
import { normalizeValue, parseAlbumList } from './importParser'

describe('parseAlbumList', () => {
  it('parses hyphen, en dash, em dash, tabs, by, and title-only formats', () => {
    const parsed = parseAlbumList([
      'Blue Train - John Coltrane',
      'Kind of Blue – Miles Davis',
      'A Love Supreme — John Coltrane',
      'Promises\tFloating Points & Pharoah Sanders',
      'Mingus Ah Um by Charles Mingus',
      'Unknown Pleasures',
    ].join('\n'))

    expect(parsed.invalidCount).toBe(0)
    expect(parsed.albums).toHaveLength(6)
    expect(parsed.albums[3]).toMatchObject({ title: 'Promises', artist: 'Floating Points & Pharoah Sanders' })
    expect(parsed.albums[4]).toMatchObject({ title: 'Mingus Ah Um', artist: 'Charles Mingus' })
    expect(parsed.albums[5]).toMatchObject({ title: 'Unknown Pleasures', artist: 'Unknown artist' })
  })

  it('swaps artist and album columns globally without breaking title-only lines', () => {
    const parsed = parseAlbumList('Miles Davis\tKind of Blue\nUnknown Pleasures', true)
    expect(parsed.albums[0]).toMatchObject({ title: 'Kind of Blue', artist: 'Miles Davis' })
    expect(parsed.albums[1]).toMatchObject({ title: 'Unknown Pleasures', artist: 'Unknown artist' })
  })

  it('trims whitespace and ignores blank lines', () => {
    const parsed = parseAlbumList('  Blue Train   -   John Coltrane  \n\n   \nKind of Blue - Miles Davis\n')
    expect(parsed.albums).toHaveLength(2)
    expect(parsed.invalidCount).toBe(0)
    expect(parsed.albums[0]).toMatchObject({ title: 'Blue Train', artist: 'John Coltrane' })
  })

  it('flags normalized duplicate lines', () => {
    const parsed = parseAlbumList('Ágætis byrjun - Sigur Rós\nAgaetis byrjun - sigur ros')
    expect(parsed.duplicateCount).toBe(1)
    expect(parsed.albums).toHaveLength(1)
    expect(parsed.lines[1].duplicateOf).toBe(1)
  })

  it('reports invalid missing columns and enforces the 100-album limit', () => {
    const lines = Array.from({ length: 102 }, (_, index) => `Album ${index} - Artist ${index}`)
    lines.splice(4, 0, ' - Artist')
    const parsed = parseAlbumList(lines.join('\n'))
    expect(parsed.albums).toHaveLength(100)
    expect(parsed.truncatedCount).toBe(2)
    expect(parsed.invalidCount).toBe(3)
  })

  it('normalizes accents, punctuation, case, and whitespace', () => {
    expect(normalizeValue('  Coração—Selvagem! ')).toBe('coracao selvagem')
  })
})
