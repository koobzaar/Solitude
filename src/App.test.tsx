import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { CATALOG_STORAGE_KEY, DATA_STORAGE_KEY } from './lib/storage'

async function reachBattle(albumLines: string) {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: /start a ranking/i }))
  await user.type(await screen.findByLabelText(/name this collection/i), 'Sunday shelf')
  await user.click(screen.getByRole('button', { name: /add your records/i }))
  const textarea = await screen.findByLabelText(/album list/i)
  await user.type(textarea, albumLines)
  const albumCount = albumLines.split('\n').length
  await user.click(screen.getByRole('button', { name: new RegExp(`Review ${albumCount} albums`, 'i') }))
  expect(await screen.findByRole('heading', { name: /review your records/i })).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: /choose ranking mode/i }))
  await user.click(await screen.findByRole('button', { name: /begin balanced battle/i }))
  await screen.findByRole('heading', { name: /which record comes first/i })
  return user
}

describe('Solitude app flow', () => {
  it('moves from import through review and accepts keyboard album choices', async () => {
    await reachBattle('Blue Train - John Coltrane\nKind of Blue - Miles Davis')
    expect(screen.getByRole('heading', { name: /which record comes first/i })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })

    expect(await screen.findByRole('heading', { name: /your next record is clear/i })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    const stored = JSON.parse(localStorage.getItem(DATA_STORAGE_KEY) ?? '{}')
    expect(stored.collections[0].completedRuns).toHaveLength(1)
    expect(stored.collections[0].activeRun).toBeUndefined()
  })

  it('returns to the library after reload and offers an exact Resume action', async () => {
    const user = await reachBattle('A - Artist A\nB - Artist B\nC - Artist C')
    fireEvent.keyDown(window, { key: '1' })
    await user.click(screen.getByRole('button', { name: /save & exit/i }))
    expect(await screen.findByRole('button', { name: /resume/i })).toBeInTheDocument()

    await waitFor(() => expect(JSON.parse(localStorage.getItem(DATA_STORAGE_KEY) ?? '{}').collections[0].activeRun.decisions).toHaveLength(1))
    // Testing Library cleanup simulates a full page reload while localStorage remains intact.
    cleanup()
    render(<App />)

    const resume = await screen.findByRole('button', { name: /resume/i })
    await user.click(resume)
    await screen.findByRole('heading', { name: /which record comes first/i })
    expect(document.querySelector('.battle-progress__labels span')?.textContent).toContain('Battle 2')
  })

  it('renders safely for people who prefer reduced motion', () => {
    const matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }))
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia })
    render(<App />)
    expect(screen.getByRole('heading', { name: /what deserves thenext spin/i })).toBeInTheDocument()
    expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
  })

  it('automatically corrects strong fuzzy matches and explains missing archive covers', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /start a ranking/i }))
    await user.type(await screen.findByLabelText(/name this collection/i), 'Corrected shelf')
    await user.click(screen.getByRole('button', { name: /add your records/i }))
    await user.type(await screen.findByLabelText(/album list/i), 'I love you. - The neighborhood\nInside In / Inside Out - The Kooks')
    await user.click(screen.getByRole('button', { name: /review 2 albums/i }))
    expect(await screen.findByRole('heading', { name: /review your records/i })).toBeInTheDocument()

    const now = Date.now()
    localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify({
      version: 2,
      entries: {
        'i love you::the neighborhood': {
          expiresAt: now + 60_000,
          results: [{
            id: 'neighbourhood-id', title: 'I Love You.', artist: 'The Neighbourhood', year: 2013,
            score: 100, confidence: 0.98, titleSimilarity: 1, artistSimilarity: 0.94,
            matchKind: 'fuzzy', primaryType: 'Album', weak: false,
          }],
        },
        'inside in inside out::the kooks': {
          expiresAt: now + 60_000,
          results: [{
            id: 'kooks-id', title: 'Inside In/Inside Out', artist: 'The Kooks', year: 2006,
            score: 100, confidence: 1, titleSimilarity: 1, artistSimilarity: 1,
            matchKind: 'exact', primaryType: 'Album', weak: false,
          }],
        },
      },
      covers: {
        'neighbourhood-id': { expiresAt: now + 60_000, result: { status: 'available', url: 'https://example.com/neighbourhood.jpg' } },
        'kooks-id': { expiresAt: now + 60_000, result: { status: 'missing' } },
      },
    }))

    await user.click(screen.getByRole('button', { name: /match 2 unresolved/i }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'I Love You.' })).toBeInTheDocument())
    expect(screen.getByText(/The Neighbourhood/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Inside In/Inside Out' })).toBeInTheDocument()
    expect(screen.getByText(/auto-corrected · 98%/i)).toBeInTheDocument()
    expect(screen.getByText(/no archive cover—showing an artist-inspired fallback/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/matches for/i)).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /edit details/i })[0])
    expect(screen.getByLabelText('Artist')).toHaveValue('The Neighbourhood')

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(DATA_STORAGE_KEY) ?? '{}')
      expect(stored.collections[0].albums[0]).toMatchObject({ artist: 'The Neighbourhood', coverStatus: 'available' })
      expect(stored.collections[0].albums[1]).toMatchObject({ title: 'Inside In/Inside Out', coverStatus: 'missing' })
    })
  })

  it('collapses confident matches and only exposes candidates for unresolved records', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /start a ranking/i }))
    await user.type(await screen.findByLabelText(/name this collection/i), 'Mixed certainty')
    await user.click(screen.getByRole('button', { name: /add your records/i }))
    await user.type(await screen.findByLabelText(/album list/i), 'Exact Album - Exact Artist\nUncertain Album - Uncertain Artist')
    await user.click(screen.getByRole('button', { name: /review 2 albums/i }))
    await screen.findByRole('heading', { name: /review your records/i })

    const now = Date.now()
    const exact = {
      id: 'exact-id', title: 'Exact Album', artist: 'Exact Artist', score: 100, confidence: 1,
      titleSimilarity: 1, artistSimilarity: 1, matchKind: 'exact', primaryType: 'Album', weak: false,
    }
    const ambiguous = [
      { id: 'maybe-a', title: 'Uncertain Album', artist: 'Uncertain Artist', score: 100, confidence: .94, titleSimilarity: 1, artistSimilarity: .83, matchKind: 'fuzzy', primaryType: 'Album', weak: false },
      { id: 'maybe-b', title: 'Uncertain Album Deluxe', artist: 'Uncertain Artist', score: 96, confidence: .91, titleSimilarity: .9, artistSimilarity: .93, matchKind: 'fuzzy', primaryType: 'Album', weak: false },
    ]
    localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify({
      version: 2,
      entries: {
        'exact album::exact artist': { expiresAt: now + 60_000, results: [exact] },
        'uncertain album::uncertain artist': { expiresAt: now + 60_000, results: ambiguous },
      },
      covers: { 'exact-id': { expiresAt: now + 60_000, result: { status: 'missing' } } },
    }))

    await user.click(screen.getByRole('button', { name: /match 2 unresolved/i }))
    expect(await screen.findByRole('heading', { name: 'Exact Album' })).toBeInTheDocument()
    expect(await screen.findByLabelText(/matches for uncertain album/i)).toBeInTheDocument()
    expect(screen.getAllByLabelText(/matches for/i)).toHaveLength(1)
  })

  it('uses the redesigned empty state and stores optional collection context', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByRole('heading', { name: /your shelf is quiet/i })).toBeInTheDocument()
    expect(screen.getByText(/0 collections · saved on this device/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /create your first collection/i }))
    expect(await screen.findByRole('heading', { name: /let’s set the stage/i })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/name this collection/i), 'Winter records')
    await user.click(screen.getByRole('button', { name: /rainy day/i }))
    await user.type(screen.getByLabelText(/note to your future self/i), 'For slow Sundays')
    await user.click(screen.getByRole('button', { name: /add your records/i }))

    expect(await screen.findByRole('heading', { name: /paste your wishlist/i })).toBeInTheDocument()
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(DATA_STORAGE_KEY) ?? '{}')
      expect(stored.collections[0]).toMatchObject({ name: 'Winter records', vibe: 'Rainy day', note: 'For slow Sundays' })
    })
  })

  it('keeps rename, delete, and completed-history controls on redesigned cards', async () => {
    const timestamp = '2026-07-16T12:00:00.000Z'
    localStorage.setItem(DATA_STORAGE_KEY, JSON.stringify({
      version: 1,
      learnedPaceSamples: [],
      currentCollectionId: 'collection-1',
      collections: [{
        id: 'collection-1', name: 'Original name', albums: [
          { id: 'a', title: 'A', artist: 'Artist A', sourceText: 'A - Artist A', matchStatus: 'manual' },
          { id: 'b', title: 'B', artist: 'Artist B', sourceText: 'B - Artist B', matchStatus: 'manual' },
        ],
        createdAt: timestamp, updatedAt: timestamp,
        completedRuns: [{
          id: 'run-1', mode: 'balanced', seed: 1, decisions: [], status: 'completed', createdAt: timestamp,
          updatedAt: timestamp, completedAt: timestamp, paceSamples: [], finalRanking: ['a', 'b'],
        }],
      }],
    }))
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByText(/ranking history/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /rename original name/i }))
    const rename = screen.getByLabelText(/collection name/i)
    await user.clear(rename)
    await user.type(rename, 'Renamed shelf')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(screen.getByRole('heading', { name: /renamed shelf/i })).toBeInTheDocument()

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: /delete renamed shelf/i }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(await screen.findByRole('heading', { name: /your shelf is quiet/i })).toBeInTheDocument()
  })

  it('uses deterministic stored covers without skipping a first-album placeholder', () => {
    const timestamp = '2026-07-16T12:00:00.000Z'
    localStorage.setItem(DATA_STORAGE_KEY, JSON.stringify({
      version: 1,
      learnedPaceSamples: [],
      collections: [{
        id: 'covers', name: 'Cover shelf', createdAt: timestamp, updatedAt: timestamp, completedRuns: [],
        albums: [
          { id: 'first', title: 'First Album', artist: 'First Artist', sourceText: 'first', matchStatus: 'matched', releaseGroupId: 'missing', coverStatus: 'missing' },
          { id: 'second', title: 'Second Album', artist: 'Second Artist', sourceText: 'second', matchStatus: 'manual', coverUrl: 'https://example.com/second.jpg', coverStatus: 'custom' },
        ],
      }],
    }))
    render(<App />)

    expect(screen.getAllByRole('img', { name: /no cover for first album by first artist/i })).toHaveLength(2)
    expect(screen.getByRole('img', { name: /second album.*second artist.*cover/i }).querySelector('img')).toHaveAttribute('src', 'https://example.com/second.jpg')
  })
})
