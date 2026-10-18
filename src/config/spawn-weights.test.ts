import { describe, expect, it } from 'vitest'
import { SPAWN_WEIGHTS, normalizedSpawnWeights, pickWeightedTier } from './spawn'
import { randomSpawnTier, getTier, SPAWNABLE_TIERS } from './ballTiers'

/**
 * Phase 2.13.1 (spec §5) — weighted random-tier spawn tests:
 *  - DETERMINISTIC boundary selection with a stubbed rng,
 *  - a SEEDED statistical test verifying the distribution is approximately
 *    correct (and correctly ORDERED: tier 1 ≫ 2 > 3 > 4, tiers 5–10 never),
 *  - weight-table validation (loud failure on a bad edit).
 */

/** Deterministic seeded PRNG (mulberry32) for the statistical test. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('Phase 2.13.1: weighted spawn weights — table + normalization', () => {
  it('the default table is the tuned gameplay table (40 / 30 / 20 / 10) and excludes tiers 5–10', () => {
    // User-tuned values (easily editable — see SPAWN_WEIGHTS in config/spawn.ts).
    expect(SPAWN_WEIGHTS[1]).toBe(40)
    expect(SPAWN_WEIGHTS[2]).toBe(30)
    expect(SPAWN_WEIGHTS[3]).toBe(20)
    expect(SPAWN_WEIGHTS[4]).toBe(10)
    expect(Object.keys(SPAWN_WEIGHTS).length).toBe(4)
    for (let t = 5; t <= 10; t++) expect(SPAWN_WEIGHTS[t]).toBeUndefined()
  })

  it('normalized probabilities sum to 1 and match the table fractions', () => {
    const norm = normalizedSpawnWeights()
    let sum = 0
    for (const p of norm.values()) sum += p
    expect(sum).toBeCloseTo(1, 12)
    expect(norm.get(1)).toBeCloseTo(0.4, 12)
    expect(norm.get(2)).toBeCloseTo(0.3, 12)
    expect(norm.get(3)).toBeCloseTo(0.2, 12)
    expect(norm.get(4)).toBeCloseTo(0.1, 12)
  })

  it('normalization is scale-invariant (weights need not sum to 100)', () => {
    const norm = normalizedSpawnWeights({ 2: 44, 1: 140 })
    expect(norm.get(1)).toBeCloseTo(140 / 184, 12)
    expect(norm.get(2)).toBeCloseTo(44 / 184, 12)
  })

  it('rejects unusable tables loudly (all-zero / negative / empty)', () => {
    expect(() => normalizedSpawnWeights({})).toThrow()
    expect(() => normalizedSpawnWeights({ 1: 0, 2: 0 })).toThrow()
    expect(() => normalizedSpawnWeights({ 1: -5, 2: 10 })).toThrow()
    expect(() => normalizedSpawnWeights({ 1: Number.NaN })).toThrow()
    expect(() => normalizedSpawnWeights({ 0: 10 })).toThrow()
  })

  it('every weighted tier is a valid, playable tier and in SPAWNABLE_TIERS', () => {
    for (const tier of Object.keys(SPAWN_WEIGHTS).map(Number)) {
      expect(getTier(tier)?.playable).toBe(true)
      expect(SPAWNABLE_TIERS).toContain(tier)
    }
  })
})

describe('Phase 2.13.1: weighted spawn selection — deterministic boundaries', () => {
  // Inverse-CDF walk over 40/30/20/10: r ∈ [0, 0.40) → tier 1,
  // [0.40, 0.70) → tier 2, [0.70, 0.90) → tier 3, [0.90, 1) → tier 4.
  const at = (r: number) => pickWeightedTier(() => r)

  it('selects each tier exactly on its weight boundary', () => {
    expect(at(0)).toBe(1)
    expect(at(0.3999)).toBe(1)
    // (Exact-boundary probes sit epsilon off: IEEE-754 dust makes e.g. 0.7 −
    // 0.4 land a hair inside tier 2's bucket, so probe just past each edge.)
    expect(at(0.4)).toBe(2)
    expect(at(0.6999)).toBe(2)
    expect(at(0.7001)).toBe(3)
    expect(at(0.8999)).toBe(3)
    expect(at(0.9001)).toBe(4)
    expect(at(0.9999)).toBe(4)
  })

  it('randomSpawnTier uses the same weighted selection (not uniform)', () => {
    // Uniform over 4 tiers would give tier 4 at r = 0.80 (r ≥ 0.75) —
    // weighted puts 0.80 inside tier 3's bucket [0.70, 0.90).
    expect(randomSpawnTier(() => 0.8)).toBe(3)
    expect(randomSpawnTier(() => 0.95)).toBe(4)
    // Uniform over 3 tiers (the old behavior) would give tier 2 at r = 0.35;
    // weighted gives tier 1 until 0.40.
    expect(randomSpawnTier(() => 0.35)).toBe(1)
    expect(randomSpawnTier(() => 0.5)).toBe(2)
  })

  it('tolerates a broken rng outside [0,1) without crashing or bias', () => {
    expect(pickWeightedTier(() => 1.5)).toBe(4) // pulled to the last bucket
    expect(pickWeightedTier(() => -0.2)).toBe(1)
    expect(pickWeightedTier(() => Number.NaN)).toBe(1)
  })
})

describe('Phase 2.13.1: weighted spawn selection — seeded statistical test', () => {
  const N = 50_000
  const rng = mulberry32(0x2131)

  it('the observed distribution is approximately correct and strictly ordered', () => {
    const counts = new Map<number, number>()
    for (let i = 0; i < N; i++) {
      const t = randomSpawnTier(rng)
      counts.set(t, (counts.get(t) ?? 0) + 1)
      // Tiers 5–10 NEVER appear from random spawning (spec §5).
      if (t < 1 || t > 4) throw new Error(`out-of-table tier ${t} spawned`)
    }
    const f = (t: number) => (counts.get(t) ?? 0) / N
    // Approximate correctness: within ±1.5 percentage points of the table.
    expect(Math.abs(f(1) - 0.4)).toBeLessThan(0.015)
    expect(Math.abs(f(2) - 0.3)).toBeLessThan(0.015)
    expect(Math.abs(f(3) - 0.2)).toBeLessThan(0.015)
    expect(Math.abs(f(4) - 0.1)).toBeLessThan(0.01)
    // Strict rarity ordering: tier 1 most common, each next tier rarer.
    expect(f(1)).toBeGreaterThan(f(2))
    expect(f(2)).toBeGreaterThan(f(3))
    expect(f(3)).toBeGreaterThan(f(4))
  })

  it('seeded runs are fully reproducible', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      expect(randomSpawnTier(a)).toBe(randomSpawnTier(b))
    }
  })
})
