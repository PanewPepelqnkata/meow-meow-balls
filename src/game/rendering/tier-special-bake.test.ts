import { describe, expect, it } from 'vitest'
import {
  isSpecialBakeTier,
  specialBakeExtent,
  specialBakeGeometry,
} from './bakeGeometry'
import { getTier } from '../../config/ballTiers'
import { ballOutlineWidth } from './BallAppearance'

/**
 * The tier 8/9 BAKE GEOMETRY — the per-ball frozen texture a sleeping
 * tier 8/9 ball displays.
 *
 * Two bugs lived in this area, and both made the ball VANISH:
 *
 *  1. The bake REMOVED the ball's live texture (`textures.remove`) while
 *     the ball's own body sprite was still bound to it. Phaser destroys
 *     the texture and nulls its source, so the next WebGL render of that
 *     sprite throws "Cannot read properties of null (reading
 *     'resolution')" — inside the render pass, which kills the Phaser
 *     game loop permanently (RequestAnimationFrame re-arms the next frame
 *     AFTER the callback returns, so a throw stops it forever), and the
 *     ENTIRE UI disappears with the ball.
 *
 *  2. The texture was SIZED from the world-space contour while the tier
 *     8/9 procedural body was DRAWN in local space (centred on 0,0). The
 *     body was rasterized outside the canvas and clipped away — an empty
 *     texture — and the returned `center` was a negated world coordinate
 *     instead of the ball centre's offset inside the texture, so the
 *     sprite was placed ~350px away from the ball (measured: tier 8 at
 *     ball x=355, sprite at x=707 — off the 720-wide stage).
 *
 * The geometry is a pure function, so it is directly testable here.
 */
describe('tier 8/9 bake geometry', () => {
  it('only tier 9 uses the procedural local-space bake', () => {
    // TIER 8 IS NOT BAKED: it is the cycling RGB ball, a plain ball whose
    // colour animates — a baked texture would freeze one colour. It draws
    // through the live Graphics path like every other tier.
    expect(isSpecialBakeTier(9)).toBe(true)
    for (const t of [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12]) {
      expect(isSpecialBakeTier(t)).toBe(false)
    }
  })

  it('the tier 9 extent covers the horn (-1.35r) and the mane (±0.95r)', () => {
    const R = getTier(9)!.radius
    // 1.4r must be >= the horn reach of 1.35r
    expect(specialBakeExtent(9, R)).toBeGreaterThanOrEqual(R * 1.35)
    // and >= the mane reach
    expect(specialBakeExtent(9, R)).toBeGreaterThanOrEqual(R * 0.95)
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
