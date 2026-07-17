let fallbackCounter = 0

export function makeId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  fallbackCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`
}

export function makeSeed(): number {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const values = new Uint32Array(1)
    crypto.getRandomValues(values)
    return values[0] || 1
  }
  return (Date.now() >>> 0) || 1
}
