import { describe, expect, it } from 'vitest'
import { collectionDiscovery, collectionSlotsFor, hasUnidentifiedCollectionFinds } from './collectibleCollection'
import { rollCollectibleTheme } from './collectibleThemes'

describe('collection character identities', () => {
  it('keeps characters separate even when their discovery palettes match', () => {
    const discoveries = { '9:pig:2': 100, '9:shark:2': 200, '9:pig:5': 300, '9:drunko:2': 400, '9:robo:2': 500 }
    expect(collectionDiscovery(discoveries, 9, 'pig')).toEqual({ at: 100, variant: 2 })
    expect(collectionDiscovery(discoveries, 9, 'shark')).toEqual({ at: 200, variant: 2 })
    expect(collectionDiscovery(discoveries, 9, 'drunko')).toEqual({ at: 400, variant: 2 })
    expect(collectionDiscovery(discoveries, 9, 'robo')).toEqual({ at: 500, variant: 2 })
  })

  it('retains a character’s first discovered palette rather than the latest run palette', () => {
    const discoveries = { '9:pig:7': 300, '9:pig:1': 100, '9:shark:0': 50 }
    expect(collectionDiscovery(discoveries, 9, 'pig')).toEqual({ at: 100, variant: 1 })
  })

  it('never guesses an animal from ambiguous historical numeric records', () => {
    const discoveries = { '9:0': 100, '9:6': 150 }
    expect(collectionDiscovery(discoveries, 9, 'pig')).toBeNull()
    expect(collectionDiscovery(discoveries, 9, 'shark')).toBeNull()
    expect(hasUnidentifiedCollectionFinds(discoveries, 9)).toBe(true)
    expect(collectionDiscovery({ ...discoveries, '9:pig:2': 200 }, 9, 'pig')).toEqual({ at: 200, variant: 2 })
  })

  it('recognizes a new collectible identity even when the tier was already discovered', () => {
    const discoveries = { '9:shark:3': 100 }
    expect(collectionDiscovery(discoveries, 9, 'shark')).toEqual({ at: 100, variant: 3 })
    expect(collectionDiscovery(discoveries, 9, 'pig')).toBeNull()
    expect(collectionDiscovery(discoveries, 9, 'drunko')).toBeNull()
    expect(collectionDiscovery(discoveries, 9, 'robo')).toBeNull()
  })

  it('keeps score-generated numeric records unidentified even when a tier has one character', () => {
    const discoveries = { '10:5': 150, '10:0': 100, '11:0': 200, '12:0': 250 }
    expect(collectionDiscovery(discoveries, 10, 'crab')).toBeNull()
    for (const tier of [10, 11, 12]) {
      expect(hasUnidentifiedCollectionFinds(discoveries, tier)).toBe(true)
    }
    expect(hasUnidentifiedCollectionFinds({ '8:0': 100 }, 8)).toBe(false)
  })

  it('ignores malformed palette keys and timestamps instead of hiding a rediscovery', () => {
    const discoveries = {
      '9:pig:': 100,
      '9:pig:01': 100,
      '9:pig:8': 100,
      '9:pig:NaN': 100,
      '9:pig:0': 0,
      '9:pig:1': -100,
      '9:pig:2': Number.NaN,
      '9:pig:3': Number.POSITIVE_INFINITY,
    }
    expect(collectionDiscovery(discoveries, 9, 'pig')).toBeNull()
    expect(collectionDiscovery({ ...discoveries, '9:pig:4': 300 }, 9, 'pig')).toEqual({ at: 300, variant: 4 })
    expect(hasUnidentifiedCollectionFinds({ '9:8': 100, '9:0': 0, '9:1': Number.NaN }, 9)).toBe(false)
  })

  it('reserves exactly eight unrelated slots for each high tier, with unimplemented slots excluded from rolls', () => {
    for (const tier of [9, 10, 11, 12]) {
      const slots = collectionSlotsFor(tier)
      expect(slots).toHaveLength(8)
      expect(new Set(slots.map((slot) => slot.slot)).size).toBe(8)
      for (let seed = 0; seed < 30; seed++) {
        const rolled = rollCollectibleTheme(tier, seed, (value) => value)
        expect(rolled === null || slots.some((slot) => slot.theme === rolled)).toBe(true)
      }
    }
    expect(collectionSlotsFor(11).every((slot) => slot.theme === null)).toBe(true)
    expect(collectionSlotsFor(12).every((slot) => slot.theme === null)).toBe(true)
  })
})
