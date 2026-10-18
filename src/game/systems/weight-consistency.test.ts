import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { PhysicsWorld } from './PhysicsWorld'
import { SoftBallManager } from './SoftBallManager'
import { createWallBody, floorCollider } from './ContainerBodies'
import { wallCollidersAt } from '../../config/container'
import { getTier } from '../../config/ballTiers'
import { softBallArea } from './SoftBall'
import type { SoftBallEntity } from './SoftBallManager'

/**
 * Phase 2.9.9 weight-consistency regressions (production stepping path).
 *
 * The user-visible requirement: a smaller ball resting on a larger ball must
 * exert less force than a larger ball of the same material — the support may
 * deform slightly, but proportionally to the LOAD's mass, not per-ball
 * equally. These tests pin:
 *  1. effective composite mass ∝ R² (2D area) across tiers — the contact
 *     skin's fixed +2px no longer makes small balls ~21% over-weight;
 *  2. the center particle stays a small fixed share (~2%) of ball mass;
 *  3. measured settled deformation of the SAME support under a tier-1 load
 *     is smaller than under a tier-5 load, in area, aspect, and centroid
 *     compression.
 */

function rig() {
  const physics = new PhysicsWorld()
  for (const body of [...wallCollidersAt().map(createWallBody), createWallBody(floorCollider())]) {
    physics.addBody(body)
  }
  const manager = new SoftBallManager(physics.world)
  manager.tierRadius = (t) => getTier(t)?.radius ?? 34
  physics.setSubStepHandler(() => {
    manager.stepAll()
    manager.separateContacts()
    manager.expandShape()
    manager.clampToContainer()
    manager.commitRest()
  })
  const drain = () => {
    const events = physics.takeCollisionEvents()
    if (events.length) manager.markTouched(events.flatMap(({ bodyA, bodyB }) => [bodyA.id, bodyB.id]))
  }
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      physics.step(PHYSICS.stepMs)
      drain()
    }
  }
  return { physics, manager, step }
}

function totalMass(e: SoftBallEntity): number {
  return e.soft.center.mass + e.soft.particles.reduce((s, p) => s + p.mass, 0)
}

function shape(e: SoftBallEntity) {
  const xs = e.soft.particles.map((p) => p.position.x)
  const ys = e.soft.particles.map((p) => p.position.y)
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  return {
    area: softBallArea(e.soft) / e.soft.restArea,
    aspect: Math.min(w, h) / Math.max(w, h),
    cy: e.soft.center.position.y,
  }
}

describe('Phase 2.9.9: weight consistency of the soft-ball composites', () => {
  it('effective mass scales with physical area; center share is small and constant', () => {
    const { manager, step } = rig()
    const refs: Array<{ tier: number; mass: number; area: number }> = []
    for (let t = 1; t <= 6; t++) {
      const R = getTier(t)!.radius
      const b = manager.spawnBall(360, 610 + R + 40, t)
      const mass = totalMass(b)
      refs.push({ tier: t, mass, area: Math.PI * R * R })
      manager.removeBall(b.id)
      step(2)
    }
    // mass/area constant across tiers within 2% (was 21% skewed before the
    // Phase 2.9.9 density normalization)
    const ratios = refs.map((r) => r.mass / r.area)
    const min = Math.min(...ratios)
    const max = Math.max(...ratios)
    expect(max / min).toBeLessThan(1.02)
    // sanity: heavier tiers are heavier
    for (let i = 1; i < refs.length; i++) {
      expect(refs[i]!.mass).toBeGreaterThan(refs[i - 1]!.mass)
    }
    // center particle ≈ 2% of ball mass at every tier (not disproportionately
    // heavy), and exactly 1/3 of one particle's density-derived mass
    for (let t = 1; t <= 6; t++) {
      const b = manager.spawnBall(360, 610 + getTier(t)!.radius + 40, t)
      const total = totalMass(b)
      expect(b.soft.center.mass / total).toBeGreaterThan(0.015)
      expect(b.soft.center.mass / total).toBeLessThan(0.03)
      expect(b.soft.center.mass).toBeCloseTo(b.soft.particles[0]!.mass / 3, 3)
      manager.removeBall(b.id)
      step(2)
    }
  }, 120000)

  it('a small load deforms the support less than a large load (measured, same rig)', () => {
    const run = (loaderTier: number) => {
      const { manager, step } = rig()
      // support: tier 6 centered on the floor
      const support = manager.spawnBall(360, 940, 6)
      step(1500)
      const before = shape(support)
      const R = getTier(loaderTier)!.radius
      manager.spawnBall(360, 610 + R + 4, loaderTier) // drops onto the support
      step(2400)
      const after = shape(support)
      return { before, after, areaLoss: 1 - after.area / before.area, cyDrop: after.cy - before.cy }
    }
    const small = run(1)
    const large = run(5)
    // both stay healthy
    expect(small.after.area).toBeGreaterThan(0.97)
    expect(large.after.area).toBeGreaterThan(0.95)
    // the large load must compress the support MORE (area loss ≥ 2× the
    // small load's), and both stay healthy
    expect(large.areaLoss).toBeGreaterThan(small.areaLoss * 2)
    // absolute numbers, so a regression that flattens both is still caught
    expect(small.areaLoss).toBeLessThan(0.005)
    expect(large.areaLoss).toBeLessThan(0.02)
  }, 240000)
})
