import { describe, expect, it } from 'vitest'
import { addRunCollectible, normalizeRunCollectibles } from './collectibleMetadata'

const pig = { tier: 9, theme: 'pig', variant: 3, discoveredAt: 1800000000100 }
const shark = { tier: 9, theme: 'shark', variant: 3, discoveredAt: 1800000000200 }

describe('per-run collectible metadata', () => {
  it('keeps legacy unknown distinct from an explicitly recorded run with no finds', () => {
    expect(normalizeRunCollectibles(undefined)).toBeNull()
    expect(normalizeRunCollectibles(null)).toBeNull()
    expect(normalizeRunCollectibles([])).toEqual([])
    expect(normalizeRunCollectibles({})).toBeNull()
  })

  it('preserves the actual character identity when two characters use the same palette', () => {
    expect(normalizeRunCollectibles([pig, shark])).toEqual([pig, shark])
  })

  it('deduplicates the same identity by first observation without mutating its input', () => {
    const input = [shark, { ...pig, discoveredAt: 1800000000300 }, pig]
    const result = normalizeRunCollectibles(input)!
    expect(result).toEqual([pig, shark])
    expect(input[0]).toBe(shark)
    expect(input[1]!.discoveredAt).toBe(1800000000300)
    expect(result[0]).not.toBe(pig)
  })

  it('records an identity again in the next run without consulting the lifetime collection', () => {
    const firstRun = addRunCollectible([], pig)
    const repeated = { ...pig, discoveredAt: 1800000000400 }
    const nextRun = addRunCollectible([], repeated)
    expect(firstRun).toEqual([pig])
    expect(nextRun).toEqual([repeated])
    expect(addRunCollectible(firstRun, repeated)).toEqual([pig])
  })

  it('never invents identities from tier caps, rolled themes, or palette-only keys', () => {
    const invalid = [
      { tier: 9, variant: 3, discoveredAt: 1 },
      { tier: 10, theme: 'crab', discoveredAt: 1 },
      { tier: 9, theme: 'pig', variant: 3 },
      { tier: 8, theme: 'pig', variant: 3, discoveredAt: 1 },
      { tier: 13, theme: 'pig', variant: 3, discoveredAt: 1 },
      { tier: 9, theme: '', variant: 3, discoveredAt: 1 },
      { tier: 9, theme: 'pig', variant: 8, discoveredAt: 1 },
      { tier: 9, theme: 'pig', variant: 3, discoveredAt: NaN },
      { tier: 9, theme: 'pig', variant: 3, discoveredAt: 0 },
      '9:3',
    ]
    expect(normalizeRunCollectibles(invalid)).toEqual([])
  })
})
