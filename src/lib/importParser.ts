import type { Album } from './types'
import { makeId } from './id'

export interface ParsedLine {
  line: number
  sourceText: string
  title: string
  artist: string
  duplicateOf?: number
  error?: ParseError
}

export type ParseErrorCode = 'empty' | 'missingTitle' | 'missingArtist' | 'limit'

export interface ParseError {
  code: ParseErrorCode
  values?: { limit: number }
}

export interface ParseResult {
  lines: ParsedLine[]
  albums: Album[]
  duplicateCount: number
  invalidCount: number
  truncatedCount: number
}

const DASH_SEPARATOR = /\s+[-–—]\s+/

export function normalizeValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function splitLine(sourceText: string, swapColumns: boolean): Omit<ParsedLine, 'line' | 'sourceText'> {
  const text = sourceText.trim().replace(/\s+/g, ' ')
  if (!text) return { title: '', artist: '', error: { code: 'empty' } }
  if (/^[-–—]\s*/.test(text)) return { title: '', artist: text.replace(/^[-–—]\s*/, ''), error: { code: 'missingTitle' } }
  if (/\s[-–—]$/.test(text)) return { title: text.replace(/\s[-–—]$/, ''), artist: '', error: { code: 'missingArtist' } }

  let first = ''
  let second = ''
  const tabColumns = sourceText.split('\t').map((part) => part.trim())
  if (tabColumns.length >= 2) {
    ;[first, second] = tabColumns
  } else {
    const byMatch = text.match(/^(.+?)\s+by\s+(.+)$/i)
    if (byMatch) {
      first = byMatch[1]
      second = byMatch[2]
    } else {
      const dashColumns = text.split(DASH_SEPARATOR)
      if (dashColumns.length >= 2) {
        first = dashColumns[0]
        second = dashColumns.slice(1).join(' - ')
      } else {
        first = text
        second = 'Unknown artist'
      }
    }
  }

  const titleOnly = second === 'Unknown artist'
  const [title, artist] = swapColumns && !titleOnly ? [second, first] : [first, second]
  if (!title.trim()) return { title: '', artist: artist.trim(), error: { code: 'missingTitle' } }
  if (!artist.trim()) return { title: title.trim(), artist: '', error: { code: 'missingArtist' } }
  return { title: title.trim(), artist: artist.trim() }
}

export function parseAlbumList(input: string, swapColumns = false, limit = 100): ParseResult {
  const seen = new Map<string, number>()
  let duplicateCount = 0
  let invalidCount = 0
  let accepted = 0
  let truncatedCount = 0

  const lines = input.split(/\r?\n/).map((sourceText, index): ParsedLine => {
    const parsed = splitLine(sourceText, swapColumns)
    const result: ParsedLine = { line: index + 1, sourceText, ...parsed }
    if (result.error) {
      if (result.error.code !== 'empty') invalidCount += 1
      return result
    }

    const key = `${normalizeValue(result.title)}::${normalizeValue(result.artist)}`
    const originalLine = seen.get(key)
    if (originalLine !== undefined) {
      result.duplicateOf = originalLine
      duplicateCount += 1
      return result
    }

    if (accepted >= limit) {
      result.error = { code: 'limit', values: { limit } }
      invalidCount += 1
      truncatedCount += 1
      return result
    }

    seen.set(key, result.line)
    accepted += 1
    return result
  })

  const albums = lines
    .filter((line) => !line.error && !line.duplicateOf)
    .map((line): Album => ({
      id: makeId('album'),
      title: line.title,
      artist: line.artist,
      sourceText: line.sourceText.trim(),
      matchStatus: 'pending',
    }))

  return { lines, albums, duplicateCount, invalidCount, truncatedCount }
}
