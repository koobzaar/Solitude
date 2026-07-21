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
  heartScores?: Record<string, number>
}

export interface RankingModeMetadata {
  id: RankingMode
  recommended?: boolean
}

export const RANKING_MODES: RankingModeMetadata[] = [
  { id: 'quick' },
  { id: 'balanced', recommended: true },
  { id: 'thorough' },
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function balancedBudget(albumCount: number): number {
  const allPairs = (albumCount * (albumCount - 1)) / 2
  const adaptiveAllowance = clamp(Math.ceil(albumCount / 5), 10, 20)
  return Math.min(allPairs, balancedWorstCaseCount(albumCount) + adaptiveAllowance)
}

export function battleCount(mode: RankingMode, albumCount: number, seed = 1): number {
  const ids = Array.from({ length: albumCount }, (_, index) => String(index))
  if (mode === 'quick') return quickSchedule(ids, seed).length
  if (mode === 'thorough') return (albumCount * (albumCount - 1)) / 2
  return balancedBudget(albumCount)
}

function orientPair(pair: readonly [string, string], seed: number, index: number): Matchup {
  const random = seededRandom((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0)
  return random() < 0.5
    ? { leftId: pair[0], rightId: pair[1] }
    : { leftId: pair[1], rightId: pair[0] }
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const exp = Math.exp(-Math.min(value, 40))
    return 1 / (1 + exp)
  }
  const exp = Math.exp(Math.max(value, -40))
  return exp / (1 + exp)
}

/** Fits regularized Bradley–Terry abilities with deterministic coordinate-Newton updates. */
export function fitBradleyTerry(
  albumIds: readonly string[],
  decisions: readonly BattleDecision[],
  lambda = 1,
): Record<string, number> {
  const indexById = new Map(albumIds.map((id, index) => [id, index]))
  const observations = albumIds.map(() => [] as Array<{ opponent: number; result: 0 | 0.5 | 1 }>)
  for (const decision of decisions) {
    const winner = indexById.get(decision.winnerId)
    const loser = indexById.get(decision.loserId)
    if (winner === undefined || loser === undefined || winner === loser) continue
    const tied = decision.outcome === 'tie'
    observations[winner].push({ opponent: loser, result: tied ? 0.5 : 1 })
    observations[loser].push({ opponent: winner, result: tied ? 0.5 : 0 })
  }

  const scores = albumIds.map(() => 0)
  for (let iteration = 0; iteration < 100; iteration += 1) {
    let largestStep = 0
    for (let album = 0; album < scores.length; album += 1) {
      let gradient = -lambda * scores[album]
      let curvature = lambda
      for (const observation of observations[album]) {
        const probability = sigmoid(scores[album] - scores[observation.opponent])
        gradient += observation.result - probability
        curvature += probability * (1 - probability)
      }
      const step = curvature ? gradient / curvature : 0
      scores[album] += step
      largestStep = Math.max(largestStep, Math.abs(step))
    }

    const mean = scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length)
    for (let album = 0; album < scores.length; album += 1) scores[album] -= mean
    if (largestStep < 1e-10) break
  }

  return Object.fromEntries(albumIds.map((id, index) => [id, scores[index]]))
}

export function rankByHeartScores(
  albumIds: readonly string[],
  heartScores: Readonly<Record<string, number>>,
  seed: number,
): string[] {
  const tieOrder = seededShuffle(albumIds, seed)
  const tieIndex = new Map(tieOrder.map((id, index) => [id, index]))
  return [...albumIds].sort((left, right) => {
    const difference = (heartScores[right] ?? 0) - (heartScores[left] ?? 0)
    if (Math.abs(difference) > 1e-10) return difference
    return (tieIndex.get(left) ?? 0) - (tieIndex.get(right) ?? 0)
  })
}

function completeState(
  albumIds: readonly string[],
  decisions: readonly BattleDecision[],
  seed: number,
  totalComparisons: number,
): BattleState {
  const evidence = decisions.slice(0, totalComparisons)
  const heartScores = fitBradleyTerry(albumIds, evidence)
  return {
    complete: true,
    completedComparisons: totalComparisons,
    totalComparisons,
    heartScores,
    ranking: rankByHeartScores(albumIds, heartScores, seed),
  }
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`
}

function samePair(decision: BattleDecision, pair: readonly [string, string]): boolean {
  return pairKey(decision.winnerId, decision.loserId) === pairKey(pair[0], pair[1])
}

function scheduledState(
  albumIds: readonly string[],
  decisions: readonly BattleDecision[],
  seed: number,
  schedule: ReadonlyArray<readonly [string, string]>,
): BattleState {
  let completed = 0
  while (completed < decisions.length && completed < schedule.length && samePair(decisions[completed], schedule[completed])) completed += 1
  if (completed >= schedule.length) return completeState(albumIds, decisions, seed, schedule.length)
  return {
    complete: false,
    completedComparisons: completed,
    totalComparisons: schedule.length,
    matchup: orientPair(schedule[completed], seed ^ 0xc0ffee, completed),
  }
}

function allPairs(albumIds: readonly string[], seed: number): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (let first = 0; first < albumIds.length; first += 1) {
    for (let second = first + 1; second < albumIds.length; second += 1) pairs.push([albumIds[first], albumIds[second]])
  }
  return seededShuffle(pairs, seed ^ 0x7f4a7c15)
}

export function balancedChain(albumIds: readonly string[], seed: number): Array<[string, string]> {
  const order = seededShuffle(albumIds, seed)
  return order.slice(1).map((id, index) => [order[index], id])
}

function balancedState(
  albumIds: readonly string[],
  seed: number,
  decisions: readonly BattleDecision[],
): BattleState {
  const budget = balancedBudget(albumIds.length)
  const chain = balancedChain(albumIds, seed)
  let completed = 0
  while (completed < decisions.length && completed < chain.length && samePair(decisions[completed], chain[completed])) completed += 1
  if (completed < chain.length) {
    return {
      complete: false,
      completedComparisons: completed,
      totalComparisons: budget,
      matchup: orientPair(chain[completed], seed ^ 0x51f15e, completed),
    }
  }

  const validIds = new Set(albumIds)
  const evidence = decisions.slice(0, budget).filter((decision) => (
    decision.winnerId !== decision.loserId && validIds.has(decision.winnerId) && validIds.has(decision.loserId)
  ))
  const seen = new Set<string>()
  const matchCounts = new Map(albumIds.map((id) => [id, 0]))
  for (const decision of evidence) {
    const key = pairKey(decision.winnerId, decision.loserId)
    if (seen.has(key)) continue
    seen.add(key)
    matchCounts.set(decision.winnerId, (matchCounts.get(decision.winnerId) ?? 0) + 1)
    matchCounts.set(decision.loserId, (matchCounts.get(decision.loserId) ?? 0) + 1)
  }
  completed = seen.size
  if (completed >= budget) return completeState(albumIds, evidence, seed, budget)

  const heartScores = fitBradleyTerry(albumIds, evidence)
  let selected: [string, string] | undefined
  let selectedPriority = -1
  for (const pair of allPairs(albumIds, seed)) {
    if (seen.has(pairKey(pair[0], pair[1]))) continue
    const probability = sigmoid((heartScores[pair[0]] ?? 0) - (heartScores[pair[1]] ?? 0))
    const exposure = Math.sqrt((1 + (matchCounts.get(pair[0]) ?? 0)) * (1 + (matchCounts.get(pair[1]) ?? 0)))
    const priority = probability * (1 - probability) / exposure
    if (priority > selectedPriority + 1e-15) {
      selected = pair
      selectedPriority = priority
    }
  }

  if (!selected) return completeState(albumIds, evidence, seed, completed)
  return {
    complete: false,
    completedComparisons: completed,
    totalComparisons: budget,
    matchup: orientPair(selected, seed ^ 0x51f15e, completed),
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
  return scheduledState(albumIds, decisions, seed, schedule)
}
