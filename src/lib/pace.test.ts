import { describe, expect, it } from 'vitest'
import { appendPaceSample, estimateRemainingMs, formatDuration, medianPace } from './pace'

describe('pace estimation', () => {
  it('uses four seconds before it has learned a pace', () => {
    expect(medianPace([])).toBe(4_000)
    expect(estimateRemainingMs(10, [])).toBe(40_000)
  })

  it('learns from the median of recent choices', () => {
    expect(medianPace([2_000, 7_000, 3_000, 4_000, 8_000])).toBe(4_000)
    expect(medianPace([2_000, 4_000])).toBe(3_000)
  })

  it('rejects hidden-page and idle samples over 30 seconds', () => {
    expect(appendPaceSample([2_000], 5_000, false)).toEqual([2_000])
    expect(appendPaceSample([2_000], 30_001, true)).toEqual([2_000])
    expect(medianPace([2_000, 60_000])).toBe(2_000)
  })

  it('keeps only the latest 25 samples and formats estimates', () => {
    let samples: number[] = []
    for (let index = 1; index <= 30; index += 1) samples = appendPaceSample(samples, index * 100)
    expect(samples).toHaveLength(25)
    expect(samples[0]).toBe(600)
    expect(formatDuration(42_000)).toBe('42 sec')
    expect(formatDuration(125_000)).toBe('2 min')
    expect(formatDuration(3_900_000)).toBe('1 hr 5 min')
  })
})
