import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const motionPreference = vi.hoisted(() => ({ reduced: false }))

vi.mock('motion/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('motion/react')>(),
  useReducedMotion: () => motionPreference.reduced,
}))

import App from './App'
import { NAVIGATION_STORAGE_KEY } from './lib/navigation'
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

function seedActiveBattle() {
  const timestamp = '2026-07-21T12:00:00.000Z'
  const albums = [
    { id: 'a', title: 'Album A', artist: 'Artist A', sourceText: 'Album A - Artist A', matchStatus: 'manual' },
    { id: 'b', title: 'Album B', artist: 'Artist B', sourceText: 'Album B - Artist B', matchStatus: 'manual' },
  ]
  localStorage.setItem(DATA_STORAGE_KEY, JSON.stringify({
    version: 3,
    learnedPaceSamples: [],
    currentCollectionId: 'collection-1',
    trackProfiles: {},
    collections: [{
      id: 'collection-1', name: 'Tie shelf', albums, createdAt: timestamp, updatedAt: timestamp, completedRuns: [],
      activeRun: {
        id: 'run-1', mode: 'balanced', seed: 7, algorithmVersion: 'bt-v1', decisions: [], status: 'active',
        createdAt: timestamp, updatedAt: timestamp, paceSamples: [],
      },
    }],
  }))
  sessionStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify({
    version: 1, screen: 'battle', collectionId: 'collection-1', runId: 'run-1',
  }))
}

interface TrackReviewSeedAlbum {
  id: string
  title: string
  artist: string
  sourceText: string
  matchStatus: 'manual' | 'matched'
  releaseGroupId?: string
}

function seedTrackReview(albums: TrackReviewSeedAlbum[], tracklists: Record<string, unknown> = {}) {
  const timestamp = '2026-07-16T12:00:00.000Z'
  localStorage.setItem(DATA_STORAGE_KEY, JSON.stringify({
    version: 3,
    learnedPaceSamples: [],
    currentCollectionId: 'collection-1',
    trackProfiles: {},
    collections: [{
      id: 'collection-1', name: 'Heart controls', albums, createdAt: timestamp, updatedAt: timestamp,
      completedRuns: [{
        id: 'run-1', mode: 'balanced', seed: 1, algorithmVersion: 'bt-v1', decisions: [], status: 'completed',
        createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp, paceSamples: [],
        finalRanking: albums.map((album) => album.id), albumSnapshot: albums,
      }],
    }],
  }))
  localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify({ version: 3, entries: {}, covers: {}, tracklists }))
  sessionStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify({
    version: 1, screen: 'track-review', collectionId: 'collection-1', runId: 'run-1', trackReviewAlbumId: albums[0]?.id,
  }))
}

describe('Solitude app flow', () => {
  beforeEach(() => {
    motionPreference.reduced = false
  })

  it('moves from import through review and accepts keyboard album choices', async () => {
    await reachBattle('Blue Train - John Coltrane\nKind of Blue - Miles Davis')
    expect(screen.getByRole('heading', { name: /which record comes first/i })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })

    expect(await screen.findByRole('heading', { name: /your next record is clear/i })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    const stored = JSON.parse(localStorage.getItem(DATA_STORAGE_KEY) ?? '{}')
    expect(stored.collections[0].completedRuns).toHaveLength(1)
    expect(stored.collections[0].activeRun).toBeUndefined()
    expect(stored.collections[0].completedRuns[0].decisions[0].outcome).toBe('win')
  })

  it('locks utilities during animation, then Undo restores an immediately usable matchup', async () => {
    const user = await reachBattle('A - Artist A\nB - Artist B\nC - Artist C')
    const originalMatchup = document.querySelector('.battle-page .sr-only')?.textContent
    const tieButton = screen.getByRole('button', { name: /can’t decide/i })
    expect(tieButton).toHaveAttribute('aria-keyshortcuts', '0')
    await user.click(tieButton)
    expect(document.querySelectorAll<HTMLButtonElement>('.choice-card')).toHaveLength(2)
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.choice-card')).every((button) => button.disabled)).toBe(true)
    expect(tieButton).toBeDisabled()
    expect(screen.getByRole('button', { name: /undo/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /restart/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /save & exit/i })).toBeDisabled()
    await waitFor(() => expect(document.querySelector('.battle-progress__labels span')?.textContent).toContain('Battle 2'))

    await user.click(screen.getByRole('button', { name: /undo/i }))
    await waitFor(() => expect(document.querySelector('.battle-progress__labels span')?.textContent).toContain('Battle 1'))
    expect(document.querySelector('.battle-page .sr-only')?.textContent).toBe(originalMatchup)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(document.querySelector('.battle-progress__labels span')?.textContent).toContain('Battle 2'))
  })

  it('stores a clicked tie and completes two albums with equal Heart scores', async () => {
    seedActiveBattle()
    const user = userEvent.setup()
    render(<App />)

    const tieButton = await screen.findByRole('button', { name: /can’t decide/i })
    await user.click(tieButton)
    expect(await screen.findByRole('heading', { name: /your next record is clear/i })).toBeInTheDocument()

    const stored = JSON.parse(localStorage.getItem(DATA_STORAGE_KEY) ?? '{}')
    const completedRun = stored.collections[0].completedRuns[0]
    expect(completedRun.decisions[0]).toMatchObject({ outcome: 'tie' })
    expect(new Set([completedRun.decisions[0].winnerId, completedRun.decisions[0].loserId])).toEqual(new Set(['a', 'b']))
    expect(completedRun.heartScores.a).toBeCloseTo(0, 12)
    expect(completedRun.heartScores.b).toBeCloseTo(0, 12)
  })

  it('uses 0 to commit a tie immediately when reduced motion is preferred', async () => {
    motionPreference.reduced = true
    seedActiveBattle()
    render(<App />)
    await screen.findByRole('button', { name: /can’t decide/i })

    fireEvent.keyDown(window, { key: '0' })
    const immediatelyStored = JSON.parse(localStorage.getItem(DATA_STORAGE_KEY) ?? '{}')
    expect(immediatelyStored.collections[0].completedRuns[0].decisions[0].outcome).toBe('tie')
    expect(await screen.findByRole('heading', { name: /your next record is clear/i })).toBeInTheDocument()
    expect(immediatelyStored.collections[0].completedRuns[0].heartScores.a).toBeCloseTo(immediatelyStored.collections[0].completedRuns[0].heartScores.b, 12)
  })

  it('restores the exact active battle after a same-tab reload and still supports Save & exit', async () => {
    await reachBattle('A - Artist A\nB - Artist B\nC - Artist C')
    fireEvent.keyDown(window, { key: '1' })
    await waitFor(() => expect(JSON.parse(localStorage.getItem(DATA_STORAGE_KEY) ?? '{}').collections[0].activeRun.decisions).toHaveLength(1))
    cleanup()
    render(<App />)

    await screen.findByRole('heading', { name: /which record comes first/i })
    expect(document.querySelector('.battle-progress__labels span')?.textContent).toContain('Battle 2')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /save & exit/i }))
    const resume = await screen.findByRole('button', { name: /resume/i })
    await user.click(resume)
    expect(await screen.findByRole('heading', { name: /which record comes first/i })).toBeInTheDocument()
  })

  it('keeps song review optional and builds Record value from manual summaries', async () => {
    const user = await reachBattle('A - Artist A\nB - Artist B')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(await screen.findByRole('heading', { name: /your next record is clear/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /go deeper with the songs/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /review the songs/i }))
    expect(await screen.findByRole('heading', { name: /keep the songs that stay with you/i })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/total tracks/i), '10')
    await user.type(screen.getByLabelText(/liked tracks/i), '4')
    expect(screen.queryByLabelText(/loved tracks/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /save & next album/i }))
    await user.click(screen.getByRole('button', { name: /skip unheard album/i }))

    expect(await screen.findByRole('tab', { name: /record value/i })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /record value/i }))
    expect(screen.getByRole('heading', { name: /not reviewed/i })).toBeInTheDocument()
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(DATA_STORAGE_KEY) ?? '{}')
      expect(Object.keys(stored.collections[0].completedRuns[0].trackAnalysis.recordScores)).toHaveLength(1)
      expect(Object.values(stored.collections[0].completedRuns[0].trackAnalysis.profiles)).toContainEqual(expect.objectContaining({ reviewState: 'reviewed', likedCount: 4, successes: 4 }))
    })
  })

  it('keeps one accessible heart toggle, preserves likes, and scrolls once per album advance', async () => {
    const albums: TrackReviewSeedAlbum[] = [
      { id: 'a', title: 'A', artist: 'Artist A', sourceText: 'A - Artist A', matchStatus: 'matched', releaseGroupId: 'release-group-a' },
      { id: 'b', title: 'B', artist: 'Artist B', sourceText: 'B - Artist B', matchStatus: 'manual' },
      { id: 'c', title: 'C', artist: 'Artist C', sourceText: 'C - Artist C', matchStatus: 'manual' },
    ]
    seedTrackReview(albums, {
      'release-group-a:0': {
        expiresAt: Date.now() + 60_000,
        result: {
          releaseGroupId: 'release-group-a', offset: 0, releaseCount: 1, hasMore: false,
          editions: [{
            id: 'edition-a', title: 'Standard edition', trackCount: 2,
            tracks: [
              { id: 'track-1', title: 'First Song', position: 1, mediumPosition: 1 },
              { id: 'track-2', title: 'Second Song', position: 2, mediumPosition: 1 },
            ],
          }],
        },
      },
    })

    const user = userEvent.setup()
    render(<App />)
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    const scrollTo = vi.mocked(window.scrollTo)
    const like = await screen.findByRole('button', { name: /like first song/i })
    expect(like).toHaveAttribute('aria-pressed', 'false')
    expect(like).toHaveTextContent('♡')
    expect(screen.queryByRole('button', { name: /^love/i })).not.toBeInTheDocument()
    expect(scrollIntoView).not.toHaveBeenCalled()

    await user.click(like)
    const unlike = screen.getByRole('button', { name: /unlike first song/i })
    expect(unlike).toHaveAttribute('aria-pressed', 'true')
    expect(unlike).toHaveTextContent('♥')
    expect(scrollIntoView).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /save & next album/i }))
    expect(await screen.findByRole('heading', { name: /^B$/ })).toBeInTheDocument()
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' })
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(DATA_STORAGE_KEY) ?? '{}')
      expect(stored.trackProfiles['mb:release-group-a'].likedTrackIds).toEqual(['track-1'])
    })

    await user.click(screen.getByRole('button', { name: /skip unheard album/i }))
    expect(await screen.findByRole('heading', { name: /^C$/ })).toBeInTheDocument()
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2))
    expect(scrollTo).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /skip unheard album/i }))
    expect(await screen.findByRole('heading', { name: /your next record is clear/i })).toBeInTheDocument()
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('uses immediate scrolling between review albums when reduced motion is preferred', async () => {
    motionPreference.reduced = true
    seedTrackReview([
      { id: 'a', title: 'A', artist: 'Artist A', sourceText: 'A - Artist A', matchStatus: 'manual' },
      { id: 'b', title: 'B', artist: 'Artist B', sourceText: 'B - Artist B', matchStatus: 'manual' },
    ])
    const user = userEvent.setup()
    render(<App />)
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)

    expect(await screen.findByRole('heading', { name: /^A$/ })).toBeInTheDocument()
    expect(scrollIntoView).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /skip unheard album/i }))
    expect(await screen.findByRole('heading', { name: /^B$/ })).toBeInTheDocument()
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
  })

  it('keeps long result titles, artists, and scores present in the ranking rows', async () => {
    const timestamp = '2026-07-16T12:00:00.000Z'
    const longTitle = 'A Remarkably Long Album Title That Must Wrap Without Leaving the Mobile Viewport'
    const longArtist = 'The Extraordinary International Ensemble With an Equally Long Artist Name'
    const albums = [
      { id: 'a', title: longTitle, artist: longArtist, sourceText: 'long result', matchStatus: 'manual' },
      { id: 'b', title: 'Another Extended Record Name for Narrow Screens', artist: 'A Second Very Long Artist Credit', sourceText: 'second result', matchStatus: 'manual' },
    ]
    localStorage.setItem(DATA_STORAGE_KEY, JSON.stringify({
      version: 3,
      learnedPaceSamples: [],
      currentCollectionId: 'collection-1',
      trackProfiles: {},
      collections: [{
        id: 'collection-1', name: 'Long results', albums, createdAt: timestamp, updatedAt: timestamp,
        completedRuns: [{
          id: 'run-1', mode: 'balanced', seed: 1, algorithmVersion: 'bt-v1',
          decisions: [{ winnerId: 'a', loserId: 'b', outcome: 'win', durationMs: 1000, chosenAt: timestamp }],
          status: 'completed', createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp, paceSamples: [],
          finalRanking: ['a', 'b'], heartScores: { a: 1234567890.12, b: -987654321.98 }, albumSnapshot: albums,
          trackAnalysis: { createdAt: timestamp, profiles: {}, collectionMean: .5, recordScores: { a: .95, b: .05 } },
        }],
      }],
    }))
    sessionStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify({
      version: 1, screen: 'results', collectionId: 'collection-1', runId: 'run-1',
    }))

    render(<App />)
    expect(await screen.findByText(longTitle)).toBeInTheDocument()
    expect(screen.getByText(longArtist)).toBeInTheDocument()
    expect(screen.getByText('1,234,567,890.12 heart')).toBeInTheDocument()
    expect(screen.getByText('-987,654,321.98 heart')).toBeInTheDocument()
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
      version: 3,
      learnedPaceSamples: [],
      currentCollectionId: 'collection-1',
      trackProfiles: {},
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
      version: 3,
      learnedPaceSamples: [],
      trackProfiles: {},
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
