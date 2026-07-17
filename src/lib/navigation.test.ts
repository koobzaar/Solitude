import { describe, expect, it } from 'vitest'
import { loadNavigation, NAVIGATION_STORAGE_KEY, saveNavigation } from './navigation'
import { createInitialState } from './storage'
import type { Collection } from './types'
import { BATTLE_ALGORITHM_VERSION } from './types'

const timestamp = '2026-01-01T00:00:00.000Z'
const collection: Collection = {
  id: 'collection', name: 'Shelf', createdAt: timestamp, updatedAt: timestamp,
  albums: [
    { id: 'a', title: 'A', artist: 'Artist', sourceText: 'A', matchStatus: 'manual' },
    { id: 'b', title: 'B', artist: 'Artist', sourceText: 'B', matchStatus: 'manual' },
  ],
  activeRun: { id: 'active', mode: 'balanced', seed: 1, algorithmVersion: BATTLE_ALGORITHM_VERSION, decisions: [], status: 'active', createdAt: timestamp, updatedAt: timestamp, paceSamples: [] },
  completedRuns: [{ id: 'done', mode: 'balanced', seed: 1, algorithmVersion: BATTLE_ALGORITHM_VERSION, decisions: [], status: 'completed', createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp, paceSamples: [], finalRanking: ['a', 'b'] }],
}

describe('session navigation', () => {
  it('restores import drafts and valid run screens', () => {
    const state = { ...createInitialState(), collections: [collection] }
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    saveNavigation({ version: 1, screen: 'import', collectionId: 'collection', importDraft: 'A - Artist', swapColumns: true, selectedMode: 'quick' }, storage)
    expect(loadNavigation(state, storage).navigation).toMatchObject({ screen: 'import', importDraft: 'A - Artist', swapColumns: true })
    values.set(NAVIGATION_STORAGE_KEY, JSON.stringify({ version: 1, screen: 'battle', collectionId: 'collection', runId: 'active' }))
    expect(loadNavigation(state, storage).navigation.screen).toBe('battle')
    values.set(NAVIGATION_STORAGE_KEY, JSON.stringify({ version: 1, screen: 'results', collectionId: 'collection', runId: 'done' }))
    expect(loadNavigation(state, storage).navigation.screen).toBe('results')
  })

  it('falls back to the library for corrupt and stale references', () => {
    const state = { ...createInitialState(), collections: [collection] }
    expect(loadNavigation(state, { getItem: () => '{bad' })).toMatchObject({ navigation: { screen: 'library' }, invalid: true })
    expect(loadNavigation(state, { getItem: () => JSON.stringify({ version: 1, screen: 'battle', collectionId: 'collection', runId: 'missing' }) })).toMatchObject({ navigation: { screen: 'library' }, invalid: true })
  })
})
