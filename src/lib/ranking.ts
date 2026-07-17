import type { BattleDecision, RankingMode } from './types'

export interface Matchup {
  leftId: string
  rightId: string
}

export interface BattleState {
  complete: boolean
  completedComparisons: number
  totalComparisons: number
  matchup?: Matchup
  ranking?: string[]
}

export interface ModeDetails {
  id: RankingMode
  name: string
  eyebrow: string
  description: string
  pro: string
  con: string
  recommended?: boolean
}

export const MODE_DETAILS: ModeDetails[] = [
  {
    id: 'quick',
    name: 'Quick',
    eyebrow: 'A first pressing',
    description: 'Three seeded round-robin rounds, or every available round for a tiny list.',
    pro: 'Fastest route to a useful shortlist.',
    con: 'The middle of the ranking is approximate.',
  },
  {
    id: 'balanced',
    name: 'Balanced',
    eyebrow: 'The house favorite',
    description: 'An interactive merge sort that produces a complete, defensible order.',
    pro: 'Excellent balance of speed and confidence.',
    con: 'Not every possible pair meets directly.',
    recommended: true,
  },
  {
    id: 'thorough',
    name: 'Thorough',
    eyebrow: 'The deep listen',
    description: 'Every unique pair faces off exactly once.',
    pro: 'Maximum direct comparison coverage.',
    con: 'Large collections take a long time.',
  },
]

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values]
  const random = seededRandom(seed)
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function roundRobinRounds(albumIds: readonly string[], seed: number): Array<Array<[string, string]>> {
  const shuffled: Array<string | null> = seededShuffle(albumIds, seed)
  if (shuffled.length % 2 === 1) shuffled.push(null)
  const rounds: Array<Array<[string, string]>> = []

  for (let round = 0; round < shuffled.length - 1; round += 1) {
    const pairs: Array<[string, string]> = []
    for (let index = 0; index < shuffled.length / 2; index += 1) {
      const first = shuffled[index]
      const second = shuffled[shuffled.length - 1 - index]
      if (first && second) pairs.push([first, second])
    }
    rounds.push(pairs)
    const fixed = shuffled[0]
    const rotating = shuffled.slice(1)
    rotating.unshift(rotating.pop() ?? null)
    shuffled.splice(0, shuffled.length, fixed, ...rotating)
  }
  return rounds
}

export function quickSchedule(albumIds: readonly string[], seed: number): Array<[string, string]> {
  const rounds = roundRobinRounds(albumIds, seed)
  return rounds.slice(0, Math.min(3, rounds.length)).flat()
}

export function thoroughSchedule(albumIds: readonly string[], seed: number): Array<[string, string]> {
  const shuffled = seededShuffle(albumIds, seed)
  const pairs: Array<[string, string]> = []
  for (let first = 0; first < shuffled.length; first += 1) {
    for (let second = first + 1; second < shuffled.length; second += 1) {
      pairs.push([shuffled[first], shuffled[second]])
    }
  }
  return seededShuffle(pairs, seed ^ 0xa5a5a5a5)
}

export function balancedWorstCaseCount(albumCount: number): number {
  if (albumCount < 2) return 0
  const power = Math.ceil(Math.log2(albumCount))
  return albumCount * power - 2 ** power + 1
}

export function battleCount(mode: RankingMode, albumCount: number, seed = 1): number {
  const ids = Array.from({ length: albumCount }, (_, index) => String(index))
  if (mode === 'quick') return quickSchedule(ids, seed).length
  if (mode === 'thorough') return (albumCount * (albumCount - 1)) / 2
  return balancedWorstCaseCount(albumCount)
}

function orientPair(pair: [string, string], seed: number, index: number): Matchup {
  const random = seededRandom((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0)
  return random() < 0.5
    ? { leftId: pair[0], rightId: pair[1] }
    : { leftId: pair[1], rightId: pair[0] }
}

interface Score {
  wins: number
  games: number
  opponents: string[]
  beaten: Set<string>
}

function rankFromDecisions(
  albumIds: readonly string[],
  decisions: readonly BattleDecision[],
  seed: number,
  mode: 'quick' | 'thorough',
): string[] {
  const scores = new Map<string, Score>(
    albumIds.map((id) => [id, { wins: 0, games: 0, opponents: [], beaten: new Set() }]),
  )
  for (const decision of decisions) {
    const winner = scores.get(decision.winnerId)
    const loser = scores.get(decision.loserId)
    if (!winner || !loser) continue
    winner.wins += 1
    winner.games += 1
    loser.games += 1
    winner.opponents.push(decision.loserId)
    loser.opponents.push(decision.winnerId)
    winner.beaten.add(decision.loserId)
  }

  const seededOrder = seededShuffle(albumIds, seed)
  const seedIndex = new Map(seededOrder.map((id, index) => [id, index]))
  const primary = (id: string) => {
    const score = scores.get(id)!
    return mode === 'quick' ? (score.games ? score.wins / score.games : 0) : score.wins
  }
  const groupWins = (id: string) => {
    const score = scores.get(id)!
    return [...score.beaten].filter((opponent) => Math.abs(primary(opponent) - primary(id)) < 1e-9).length
  }
  const opponentStrength = (id: string) => {
    const score = scores.get(id)!
    return score.opponents.reduce((sum, opponent) => sum + primary(opponent), 0)
  }

  return [...albumIds].sort((a, b) => {
    const primaryDifference = primary(b) - primary(a)
    if (Math.abs(primaryDifference) > 1e-9) return primaryDifference
    const tiedGroupDifference = groupWins(b) - groupWins(a)
    if (tiedGroupDifference) return tiedGroupDifference
    const strengthDifference = opponentStrength(b) - opponentStrength(a)
    if (Math.abs(strengthDifference) > 1e-9) return strengthDifference
    return (seedIndex.get(a) ?? 0) - (seedIndex.get(b) ?? 0)
  })
}

function balancedState(
  albumIds: readonly string[],
  seed: number,
  decisions: readonly BattleDecision[],
): BattleState {
  let runs = seededShuffle(albumIds, seed).map((id) => [id])
  let consumed = 0
  const totalComparisons = balancedWorstCaseCount(albumIds.length)

  while (runs.length > 1) {
    const nextRuns: string[][] = []
    for (let runIndex = 0; runIndex < runs.length; runIndex += 2) {
      const left = runs[runIndex]
      const right = runs[runIndex + 1]
      if (!right) {
        nextRuns.push(left)
        continue
      }

      let leftIndex = 0
      let rightIndex = 0
      const merged: string[] = []
      while (leftIndex < left.length && rightIndex < right.length) {
        const pair: [string, string] = [left[leftIndex], right[rightIndex]]
        const decision = decisions[consumed]
        if (!decision) {
          return {
            complete: false,
            completedComparisons: consumed,
            totalComparisons,
            matchup: orientPair(pair, seed ^ 0x51f15e, consumed),
          }
        }

        const expected = new Set(pair)
        if (!expected.has(decision.winnerId) || !expected.has(decision.loserId)) {
          return {
            complete: false,
            completedComparisons: consumed,
            totalComparisons,
            matchup: orientPair(pair, seed ^ 0x51f15e, consumed),
          }
        }
        merged.push(decision.winnerId)
        if (decision.winnerId === left[leftIndex]) leftIndex += 1
        else rightIndex += 1
        consumed += 1
      }
      merged.push(...left.slice(leftIndex), ...right.slice(rightIndex))
      nextRuns.push(merged)
    }
    runs = nextRuns
  }

  return {
    complete: true,
    completedComparisons: consumed,
    totalComparisons,
    ranking: runs[0] ?? [],
  }
}

export function getBattleState(
  mode: RankingMode,
  albumIds: readonly string[],
  seed: number,
  decisions: readonly BattleDecision[],
): BattleState {
  if (mode === 'balanced') return balancedState(albumIds, seed, decisions)

  const schedule = mode === 'quick' ? quickSchedule(albumIds, seed) : thoroughSchedule(albumIds, seed)
  const index = Math.min(decisions.length, schedule.length)
  if (index >= schedule.length) {
    return {
      complete: true,
      completedComparisons: index,
      totalComparisons: schedule.length,
      ranking: rankFromDecisions(albumIds, decisions.slice(0, schedule.length), seed, mode),
    }
  }
  return {
    complete: false,
    completedComparisons: index,
    totalComparisons: schedule.length,
    matchup: orientPair(schedule[index], seed ^ 0xc0ffee, index),
  }
}
