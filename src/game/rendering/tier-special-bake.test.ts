import { describe, expect, it } from 'vitest'
import {
  isSpecialBakeTier,
  specialBakeExtent,
  specialBakeGeometry,
} from './bakeGeometry'
import { getTier } from '../../config/ballTiers'
import { ballOutlineWidth } from './BallAppearance'

/**
 * Geometry for the per-ball procedural-tier bake. Tiers 8 and 9 remain on
 * their live path; these helpers describe dimensions if that bake is used.
 */
describe('tier 8/9 bake geometry', () => {
  it('does not route tiers 8 or 9 through the plain special-bake path', () => {
    for (const t of [8, 9]) {
      expect(isSpecialBakeTier(t)).toBe(false)
    }
  })

  it('the tier 9 extent covers the dorsal fin and the soft aura', () => {
    const R = getTier(9)!.radius
    // 1.9r must cover the dorsal fin peak (~1.82r) and the aura stack
    // outermost ring (~1.77r = 1.72r x the 1.03 breath peak).
    expect(specialBakeExtent(9, R)).toBeGreaterThanOrEqual(R * 1.82)
  })

  it('the texture is square and the ball sits at its middle', () => {
    for (const tier of [9]) {
      const R = getTier(tier)!.radius
      const geo = specialBakeGeometry(tier, R)
      expect(geo.w).toBe(geo.h)
      expect(geo.center).toBeCloseTo(geo.w / 2, 6)
      expect(geo.center).toBeCloseTo(geo.h / 2, 6)
    }
  })

  it('the ball centre is INSIDE the texture, clear of the edges', () => {
    for (const tier of [9]) {
      const R = getTier(tier)!.radius
      const geo = specialBakeGeometry(tier, R)
      expect(geo.center).toBeGreaterThan(geo.pad)
      expect(geo.center).toBeLessThan(geo.w - geo.pad)
    }
  })

  it('the texture size does NOT depend on where the ball is on the stage', () => {
    // The old bake sized the texture from the WORLD contour, so a ball
    // near the stage edge produced a different (and wrongly offset)
    // texture than the same ball in the middle.
    const R = getTier(9)!.radius
    const geo = specialBakeGeometry(9, R)
    const expectedPad = ballOutlineWidth(R) / 2 + 3
    expect(geo.pad).toBeCloseTo(expectedPad, 6)
    // the size is a pure function of the tier and the radius
    expect(specialBakeGeometry(9, R).w).toBe(geo.w)
    expect(specialBakeGeometry(9, R).center).toBe(geo.center)
  })

  it('the texture is big enough to hold the body plus its ink outline', () => {
    for (const tier of [9]) {
      const R = getTier(tier)!.radius
      const geo = specialBakeGeometry(tier, R)
      const body = specialBakeExtent(tier, R) * 2
      const ink = ballOutlineWidth(R)
      expect(geo.w).toBeGreaterThanOrEqual(body + ink)
    }
  })
})
