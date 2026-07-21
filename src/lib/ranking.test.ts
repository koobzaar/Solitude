import { describe, expect, it } from 'vitest'
import type { BattleDecision, RankingMode } from './types'
import { balancedBudget, balancedChain, balancedWorstCaseCount, battleCount, fitBradleyTerry, getBattleState, quickSchedule, seededShuffle, thoroughSchedule } from './ranking'

function playToEnd(mode: RankingMode, albumIds: string[], seed: number, initial: BattleDecision[] = []) {
  const decisions = [...initial]
  for (let guard = 0; guard < 20_000; guard += 1) {
    const state = getBattleState(mode, albumIds, seed, decisions)
    if (state.complete) return { state, decisions }
    if (!state.matchup) throw new Error('Missing matchup')
    const [winnerId, loserId] = [state.matchup.leftId, state.matchup.rightId].sort()
    decisions.push({ winnerId, loserId, chosenAt: new Date(guard).toISOString(), durationMs: 1_000 })
  }
  throw new Error('Ranking did not complete')
}

function playTiesToEnd(mode: RankingMode, albumIds: string[], seed: number, initial: BattleDecision[] = []) {
  const decisions = [...initial]
  for (let guard = 0; guard < 20_000; guard += 1) {
    const state = getBattleState(mode, albumIds, seed, decisions)
    if (state.complete) return { state, decisions }
    if (!state.matchup) throw new Error('Missing matchup')
    decisions.push({
      winnerId: state.matchup.leftId,
      loserId: state.matchup.rightId,
      outcome: 'tie',
      chosenAt: new Date(guard).toISOString(),
      durationMs: 1_000,
    })
  }
  throw new Error('Ranking did not complete')
}

describe('ranking schedules', () => {
  it('produces the documented comparison counts', () => {
    expect(battleCount('quick', 2)).toBe(1)
    expect(battleCount('quick', 3)).toBe(3)
    expect(battleCount('quick', 5)).toBe(6)
    expect(battleCount('quick', 6)).toBe(9)
    expect(battleCount('balanced', 5)).toBe(10)
    expect(balancedWorstCaseCount(100)).toBe(573)
    expect(balancedBudget(100)).toBe(593)
    expect(battleCount('thorough', 100)).toBe(4_950)
  })

  it('is deterministic for initial order, schedules, and presentation', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    expect(seededShuffle(ids, 42)).toEqual(seededShuffle(ids, 42))
    expect(quickSchedule(ids, 42)).toEqual(quickSchedule(ids, 42))
    expect(thoroughSchedule(ids, 42)).toEqual(thoroughSchedule(ids, 42))
    expect(getBattleState('balanced', ids, 42, []).matchup).toEqual(getBattleState('balanced', ids, 42, []).matchup)
  })

  it.each(['quick', 'balanced', 'thorough'] as const)('completes %s runs for even, odd, and minimal lists', (mode) => {
    for (const count of [2, 5, 10]) {
      const ids = Array.from({ length: count }, (_, index) => `album-${index}`)
      const { state } = playToEnd(mode, ids, 123)
      expect(state.complete).toBe(true)
      expect(state.ranking).toHaveLength(count)
      expect(new Set(state.ranking).size).toBe(count)
    }
  })

  it.each(['quick', 'balanced', 'thorough'] as const)('completes %s runs made entirely of ties', (mode) => {
    const ids = Array.from({ length: 8 }, (_, index) => `album-${index}`)
    const { state, decisions } = playTiesToEnd(mode, ids, 321)
    expect(state.complete).toBe(true)
    expect(decisions.every((decision) => decision.outcome === 'tie')).toBe(true)
    expect(Object.values(state.heartScores ?? {}).every((score) => Math.abs(score) < 1e-8)).toBe(true)
  })

  it('replays decisions exactly and Undo restores the previous matchup', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const { decisions } = playToEnd('balanced', ids, 919)
    const partial = decisions.slice(0, -1)
    const beforeLast = getBattleState('balanced', ids, 919, partial)
    expect(new Set([beforeLast.matchup?.leftId, beforeLast.matchup?.rightId])).toEqual(new Set([decisions.at(-1)?.winnerId, decisions.at(-1)?.loserId]))
    expect(getBattleState('balanced', ids, 919, decisions).ranking).toEqual(playToEnd('balanced', ids, 919, decisions).state.ranking)
  })

  it('replays ties exactly and Undo restores the same presented pair', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `album-${index}`)
    const { decisions } = playTiesToEnd('balanced', ids, 2026)
    const partial = decisions.slice(0, -1)
    const beforeLast = getBattleState('balanced', ids, 2026, partial)
    expect(beforeLast.matchup).toBeDefined()
    expect(new Set([beforeLast.matchup?.leftId, beforeLast.matchup?.rightId])).toEqual(new Set([
      decisions.at(-1)?.winnerId,
      decisions.at(-1)?.loserId,
    ]))
    expect(getBattleState('balanced', ids, 2026, partial).matchup).toEqual(beforeLast.matchup)
  })

  it('counts both albums as exposed after a balanced tie and never selects that pair again', () => {
    const ids = ['a', 'b', 'c', 'd']
    const seed = 404
    const chain = balancedChain(ids, seed)
    const decisions: BattleDecision[] = chain.map(([winnerId, loserId], index) => ({
      winnerId,
      loserId,
      outcome: 'tie',
      chosenAt: new Date(index).toISOString(),
      durationMs: 1_000,
    }))
    const state = getBattleState('balanced', ids, seed, decisions)
    const endpoints = new Set([chain[0][0], chain.at(-1)![1]])
    expect(state.completedComparisons).toBe(chain.length)
    expect(new Set([state.matchup?.leftId, state.matchup?.rightId])).toEqual(endpoints)

    const decided = state.matchup!
    const next = getBattleState('balanced', ids, seed, [
      ...decisions,
      { winnerId: decided.leftId, loserId: decided.rightId, outcome: 'tie', chosenAt: '', durationMs: 1_000 },
    ])
    expect(next.completedComparisons).toBe(chain.length + 1)
    expect(new Set([next.matchup?.leftId, next.matchup?.rightId])).not.toEqual(endpoints)
  })

  it('uses seeded order as the final tie-breaker for a circular thorough result', () => {
    const ids = ['a', 'b', 'c']
    const schedule = thoroughSchedule(ids, 77)
    const winners = new Map(['a:b', 'b:c', 'a:c'].map((pair) => [pair, pair === 'a:c' ? 'c' : pair[0]]))
    const decisions = schedule.map(([first, second], index) => {
      const key = [first, second].sort().join(':')
      const winnerId = winners.get(key)!
      return { winnerId, loserId: winnerId === first ? second : first, chosenAt: new Date(index).toISOString(), durationMs: 1_000 }
    })
    expect(getBattleState('thorough', ids, 77, decisions).ranking).toEqual(seededShuffle(ids, 77))
  })

  it('recovers known strength and keeps cyclic evidence finite', () => {
    const ids = ['strong', 'middle', 'weak']
    const decisions: BattleDecision[] = [
      ['strong', 'middle'], ['strong', 'weak'], ['middle', 'weak'],
      ['strong', 'middle'], ['strong', 'weak'], ['middle', 'weak'],
    ].map(([winnerId, loserId], index) => ({ winnerId, loserId, chosenAt: new Date(index).toISOString(), durationMs: 1_000 }))
    const scores = fitBradleyTerry(ids, decisions)
    expect(scores.strong).toBeGreaterThan(scores.middle)
    expect(scores.middle).toBeGreaterThan(scores.weak)
    expect(Object.values(scores).reduce((sum, score) => sum + score, 0)).toBeCloseTo(0, 10)

    const cycle = fitBradleyTerry(ids, [
      { winnerId: 'strong', loserId: 'middle', chosenAt: '', durationMs: 1 },
      { winnerId: 'middle', loserId: 'weak', chosenAt: '', durationMs: 1 },
      { winnerId: 'weak', loserId: 'strong', chosenAt: '', durationMs: 1 },
    ])
    expect(Object.values(cycle).every(Number.isFinite)).toBe(true)
    expect(Object.values(cycle).every((score) => Math.abs(score) < 1e-8)).toBe(true)
  })

  it('fits isolated and mixed ties as fractional Bradley–Terry outcomes', () => {
    const isolated = fitBradleyTerry(['left', 'right'], [
      { winnerId: 'left', loserId: 'right', outcome: 'tie', chosenAt: '', durationMs: 1 },
    ])
    expect(isolated.left).toBeCloseTo(0, 12)
    expect(isolated.right).toBeCloseTo(0, 12)

    const mixed = fitBradleyTerry(['strong', 'middle', 'weak'], [
      { winnerId: 'strong', loserId: 'middle', outcome: 'win', chosenAt: '', durationMs: 1 },
      { winnerId: 'strong', loserId: 'weak', outcome: 'win', chosenAt: '', durationMs: 1 },
      { winnerId: 'middle', loserId: 'weak', outcome: 'win', chosenAt: '', durationMs: 1 },
      { winnerId: 'strong', loserId: 'middle', outcome: 'tie', chosenAt: '', durationMs: 1 },
      { winnerId: 'middle', loserId: 'weak', outcome: 'tie', chosenAt: '', durationMs: 1 },
    ])
    expect(mixed.strong).toBeGreaterThan(mixed.middle)
    expect(mixed.middle).toBeGreaterThan(mixed.weak)
    expect(Object.values(mixed).every(Number.isFinite)).toBe(true)
    expect(Object.values(mixed).reduce((sum, score) => sum + score, 0)).toBeCloseTo(0, 10)
  })

  it('treats legacy decisions without an outcome exactly like explicit wins', () => {
    const legacy: BattleDecision[] = [
      { winnerId: 'a', loserId: 'b', chosenAt: '', durationMs: 1 },
      { winnerId: 'a', loserId: 'c', chosenAt: '', durationMs: 1 },
      { winnerId: 'b', loserId: 'c', chosenAt: '', durationMs: 1 },
    ]
    const explicit = legacy.map((decision) => ({ ...decision, outcome: 'win' as const }))
    expect(fitBradleyTerry(['a', 'b', 'c'], legacy)).toEqual(fitBradleyTerry(['a', 'b', 'c'], explicit))
  })

  it('handles large balanced and thorough lists without duplicate matchups', () => {
    const ids = Array.from({ length: 60 }, (_, index) => String(index))
    const pairs = thoroughSchedule(ids, 11)
    expect(pairs).toHaveLength(1_770)
    expect(new Set(pairs.map((pair) => [...pair].sort().join(':'))).size).toBe(1_770)
    const balanced = playToEnd('balanced', ids, 11).decisions
    expect(balanced).toHaveLength(balancedBudget(60))
    expect(new Set(balanced.map((decision) => [decision.winnerId, decision.loserId].sort().join(':'))).size).toBe(balanced.length)
  })
})
