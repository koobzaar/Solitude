const DEFAULT_CHOICE_MS = 4_000
const MAX_VALID_CHOICE_MS = 30_000
const MAX_SAMPLES = 25

export function isValidPaceSample(durationMs: number, pageVisible = true): boolean {
  return pageVisible && Number.isFinite(durationMs) && durationMs > 0 && durationMs <= MAX_VALID_CHOICE_MS
}

export function appendPaceSample(samples: readonly number[], durationMs: number, pageVisible = true): number[] {
  if (!isValidPaceSample(durationMs, pageVisible)) return [...samples]
  return [...samples, Math.round(durationMs)].slice(-MAX_SAMPLES)
}

export function medianPace(samples: readonly number[]): number {
  const valid = samples.filter((sample) => isValidPaceSample(sample)).sort((a, b) => a - b)
  if (!valid.length) return DEFAULT_CHOICE_MS
  const middle = Math.floor(valid.length / 2)
  return valid.length % 2 ? valid[middle] : Math.round((valid[middle - 1] + valid[middle]) / 2)
}

export function estimateRemainingMs(remainingChoices: number, samples: readonly number[]): number {
  return Math.max(0, remainingChoices) * medianPace(samples)
}

export type DurationDescriptor =
  | { unit: 'seconds'; count: number }
  | { unit: 'minutes'; count: number }
  | { unit: 'hours'; count: number }
  | { unit: 'hoursMinutes'; hours: number; minutes: number }

export function describeDuration(durationMs: number): DurationDescriptor {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  if (seconds < 60) return { unit: 'seconds', count: seconds }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return { unit: 'minutes', count: minutes }
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder
    ? { unit: 'hoursMinutes', hours, minutes: remainder }
    : { unit: 'hours', count: hours }
}
