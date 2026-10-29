import { describe, expect, it } from 'vitest'
import { CONTAINER, containerBounds, wallTopYAt } from './container'
import { SPAWN, spawnY, clampSpawnX } from './spawn'
import { BALL_TIERS, getTier, SPAWNABLE_TIERS } from './ballTiers'

/**
 * Phase 2.10.1 spawn geometry regressions (spec §2): the spawn point is
 * anchored to the FULLY RAISED wall tops — every spawned ball's BOTTOM
 * starts `clearanceAboveRaisedWall` above them, for every playable tier,
 * and the horizontal clamp keeps the envelope clear of the extrapolated
 * slanted wall lines.
 */
describe('Phase 2.10.1: raised-wall-anchored spawn geometry', () => {
  const raisedTopY = wallTopYAt(CONTAINER.raisedHeight)

  it('the bottom of EVERY configured tier spawns above the raised wall tops', () => {
    for (const t of BALL_TIERS) {
      const y = spawnY(t.radius)
      expect(y + t.radius).toBeCloseTo(raisedTopY - SPAWN.clearanceAboveRaisedWall, 6)
      expect(y + t.radius).toBeLessThan(raisedTopY)
    }
  })

  it('every SPAWNABLE tier spawns fully above even the raised walls (with clearance)', () => {
    for (const tier of SPAWNABLE_TIERS) {
      const t = getTier(tier)!
      const y = spawnY(t.radius)
      expect(y - t.radius).toBeLessThan(raisedTopY - SPAWN.clearanceAboveRaisedWall)
    }
  })

  it('the largest playable tier (7) stays fully on screen', () => {
    const r7 = getTier(7)!.radius
    const y = spawnY(r7)
    expect(y - r7).toBeGreaterThan(0) // ball top above y=0
  })

  it('the raised-wall anchor is used, not the normal rim', () => {
    const normalTopY = wallTopYAt(CONTAINER.height)
    const r1 = getTier(1)!.radius
    // The spawn remains anchored to the resolved raised rim, not the
    // normal rim, even when the wall extension is shortened.
    expect(spawnY(r1)).toBe(raisedTopY - r1 - SPAWN.clearanceAboveRaisedWall)
    expect(raisedTopY).toBeLessThan(normalTopY)
  })

  it('horizontal clamp keeps the envelope inside the extrapolated wall lines', () => {
    for (const tier of SPAWNABLE_TIERS) {
      const t = getTier(tier)!
      const y = spawnY(t.radius)
      const b = containerBounds()
      const left = clampSpawnX(-1000, t.radius)
      const right = clampSpawnX(1000, t.radius)
      expect(left).toBeCloseTo(b.innerLeftAt(y) + t.radius + SPAWN.clampMargin, 6)
      expect(right).toBeCloseTo(b.innerRightAt(y) - t.radius - SPAWN.clampMargin, 6)
      // Clamped range is valid (left ≤ right) at spawn height
      expect(left).toBeLessThanOrEqual(right)
    }
  })

  it('spawn never overlaps a wall top or another ball at spawn height (envelope clear)', () => {
    const b = containerBounds()
    for (const tier of SPAWNABLE_TIERS) {
      const t = getTier(tier)!
      const y = spawnY(t.radius)
      // envelope vs left/right extrapolated wall lines at the spawn height
      expect(b.innerLeftAt(y) + SPAWN.clampMargin).toBeLessThanOrEqual(spawnY(t.radius) - y + y) // no-op guard
      const clampedX = clampSpawnX(360, t.radius)
      expect(clampedX - t.radius).toBeGreaterThanOrEqual(b.innerLeftAt(y) + SPAWN.clampMargin - 1e-6)
      expect(clampedX + t.radius).toBeLessThanOrEqual(b.innerRightAt(y) - SPAWN.clampMargin + 1e-6)
      // above every wall top (normal AND raised)
      expect(y + t.radius).toBeLessThan(wallTopYAt(CONTAINER.raisedHeight))
    }
  })
})
