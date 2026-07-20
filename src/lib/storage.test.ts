import { describe, expect, it, vi } from 'vitest'
import type { BattleRun, Collection } from './types'
import { CATALOG_STORAGE_KEY, DATA_STORAGE_KEY, createInitialState, loadCatalogCache, loadState, saveState } from './storage'
import { BATTLE_ALGORITHM_VERSION } from './types'

function run(status: 'active' | 'completed'): BattleRun {
  return {
    id: 'run-1', mode: 'balanced', seed: 7, algorithmVersion: BATTLE_ALGORITHM_VERSION, decisions: [], status,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', paceSamples: [],
    ...(status === 'completed' ? { completedAt: '2026-01-01T00:01:00.000Z', finalRanking: ['a', 'b'] } : {}),
  }
}

function collection(): Collection {
  return {
    id: 'collection-1', name: 'Jazz', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    albums: [
      { id: 'a', title: 'A', artist: 'Artist A', sourceText: 'A - Artist A', matchStatus: 'manual' },
      { id: 'b', title: 'B', artist: 'Artist B', sourceText: 'B - Artist B', matchStatus: 'manual' },
    ],
    activeRun: run('active'), completedRuns: [run('completed')],
  }
}

describe('storage', () => {
  it('initializes an empty versioned state', () => {
    expect(loadState({ getItem: () => null })).toEqual({ state: createInitialState(), recovered: false })
  })

  it('recovers from malformed JSON and invalid schemas', () => {
    expect(loadState({ getItem: () => '{broken' }).recovered).toBe(true)
    expect(loadState({ getItem: () => JSON.stringify({ version: 99 }) }).recovered).toBe(true)
  })

  it('restores active runs and completed history', () => {
    const state = { ...createInitialState(), collections: [collection()], currentCollectionId: 'collection-1' }
    const storage = new Map<string, string>()
    expect(saveState(state, { setItem: (key, value) => { storage.set(key, value) } }).ok).toBe(true)
    const loaded = loadState({ getItem: (key) => storage.get(key) ?? null })
    expect(loaded.state.collections[0].activeRun?.id).toBe('run-1')
    expect(loaded.state.collections[0].completedRuns[0].finalRanking).toEqual(['a', 'b'])
  })

  it('discards state from previous schema versions', () => {
    const previous = { ...createInitialState(), version: 2, collections: [collection()] }
    const loaded = loadState({ getItem: () => JSON.stringify(previous) })
    expect(loaded).toEqual({ state: createInitialState(), recovered: true })
  })

  it('reports quota failures without throwing', () => {
    const setItem = vi.fn(() => { throw new DOMException('Full', 'QuotaExceededError') })
    expect(saveState(createInitialState(), { setItem })).toMatchObject({ ok: false })
    expect(setItem).toHaveBeenCalledWith(DATA_STORAGE_KEY, expect.any(String))
  })

  it('migrates catalog cache v2 to schema v3 and ignores v1', () => {
    expect(CATALOG_STORAGE_KEY).toBe('solitude:catalog:v2')
    const v2 = { getItem: () => JSON.stringify({ version: 2, entries: { kept: { expiresAt: 1, results: [] } }, covers: {} }) }
    expect(loadCatalogCache(v2)).toEqual({ version: 3, entries: { kept: { expiresAt: 1, results: [] } }, covers: {}, tracklists: {} })
    const v1 = { getItem: () => JSON.stringify({ version: 1, entries: { stale: {} } }) }
    expect(loadCatalogCache(v1)).toEqual({ version: 3, entries: {}, covers: {}, tracklists: {} })
  })
})
