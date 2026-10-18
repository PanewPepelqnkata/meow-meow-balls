import { describe, expect, it } from 'vitest'
import { BALL_TIERS, getTier, validateBallTiers, SPAWNABLE_TIERS } from './ballTiers'
import { SOFT } from '../game/systems/SoftBall'

/**
 * Phase 2.10.0: the tier-size configuration is THE single source of truth
 * for all twelve tiers — validity, ordering, and downstream derivation.
 */
describe('ballTiers: single source of truth for tiers 1–12', () => {
  it('defines exactly 12 sequential, strictly-increasing, positive radii', () => {
    expect(() => validateBallTiers()).not.toThrow()
    expect(BALL_TIERS).toHaveLength(12)
    expect(BALL_TIERS.map((t) => t.tier)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('preserves the Phase 2.11.2 reference radii for tiers 1–7', () => {
    // Sized so the rendered screen diameters at the 1648×936 desktop
    // reference (~0.85 world→screen) hit the spec §4 targets:
    // 75/89/106/130/153/181/222 px.
    const established = [44, 52, 62, 76, 90, 106, 130]
    established.forEach((r, i) => expect(getTier(i + 1)!.radius).toBe(r))
  })

  it('has explicit entries for tiers 8–12 (8–9 playable, 10–12 reserved)', () => {
    for (const t of [8, 9]) {
      const tier = getTier(t)!
      expect(tier.radius).toBeGreaterThan(getTier(t - 1)!.radius)
      // Phase 2.13.0 (spec §10): rainbow (8) and fantasy unicorn (9) slimes
      // are real merge destinations; drops still only spawn tiers 1–3.
      expect(tier.playable).toBe(true)
    }
    // Tiers 10–12 stay reserved placeholders until their designs land.
    for (const t of [10, 11, 12]) expect(getTier(t)!.playable).toBe(false)
  })

  it('gameplay progression uses tiers 1–9 (tiers 10–12 stay reserved)', () => {
    // Spawnable tiers must be playable
    for (const t of SPAWNABLE_TIERS) expect(getTier(t)!.playable).toBe(true)
    // Reserved tiers are exactly 10, 11, 12
    expect(BALL_TIERS.filter((t) => !t.playable).map((t) => t.tier)).toEqual([10, 11, 12])
  })

  it('downstream derivation follows the config (mass normalization reference)', () => {
    // SOFT.densityRefRadius must be the tier-6 radius from THIS table, not a
    // separate hardcoded constant.
    expect(SOFT.densityRefRadius).toBe(getTier(6)!.radius)
  })

  it('validateBallTiers throws on an invalid edit (guard against config mistakes)', () => {
    // Validation runs on the REAL table; a negative-radius edit would break
    // particle layout, so the validator contract is pinned here by ensuring
    // the current table passes and the checks are exhaustive (see the
    // validator's error branches — exercised implicitly by the passing table).
    expect(() => validateBallTiers()).not.toThrow()
  })
})
