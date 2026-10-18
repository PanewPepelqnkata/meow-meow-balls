import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { containerBounds, wallCollidersAt, floorCollider } from '../../config/container'
import { getTier } from '../../config/ballTiers'
import { PhysicsWorld } from './PhysicsWorld'
import { SoftBallManager } from './SoftBallManager'
import { MergeSystem } from './MergeSystem'
import { ScoreSystem } from './ScoreSystem'
import { gameBus } from '../events/gameBus'
import { createWallBody } from './ContainerBodies'

/**
 * Phase 2.10.0 END-TO-END merge regressions through the full production
 * pipeline (PhysicsWorld + soft-body solver chain + MergeSystem with the
 * new placement). These run the actual "trapped ball" scenarios:
 * two large balls merge beside a smaller ball / in a dense pile — and
 * verify NO ball ends up inside the replacement (worst disc overlap ≤ the
 * settled-pile bound of 2.5px), exactly one replacement is created per
 * merge, and chains still escalate with exactly-once scoring.
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
  const score = new ScoreSystem()
  const mergeSystem = new MergeSystem(manager, physics, score)
  const drain = () => {
    const evs = physics.takeCollisionEvents()
    const ids: number[] = []
    for (const e of evs) ids.push(e.bodyA.id, e.bodyB.id)
    if (ids.length) manager.markTouched(ids)
    mergeSystem.processMerges(evs)
  }
  const step = (seconds: number) => {
    for (let i = 0; i < seconds * PHYSICS.stepHz; i++) {
      physics.step(PHYSICS.stepMs)
      drain()
    }
  }
  return { physics, manager, score, step }
}

/** Worst cross-ball disc overlap (collision envelopes), same measure as the
 * stabilization suite — a trapped ball would show a huge value. */
function worstPairOverlap(manager: SoftBallManager): number {
  const balls = manager.getBalls()
  let worst = 0
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const rA = balls[i]!.soft.radius * 0.32 + 2
      const rB = balls[j]!.soft.radius * 0.32 + 2
      for (const pa of balls[i]!.soft.particles) {
        for (const pb of balls[j]!.soft.particles) {
          const d = Math.hypot(pa.position.x - pb.position.x, pa.position.y - pb.position.y)
          worst = Math.max(worst, rA + rB - d)
        }
      }
    }
  }
  return worst
}

describe('Phase 2.10.0: merge placement in real gameplay (anti-trap)', () => {
  it('REGRESSION: two tier-4 balls merge with a small tier-1 in the impact zone — nobody is trapped', () => {
    const { manager, step, physics } = rig()
    const b = containerBounds()
    const r4 = getTier(4)!.radius
    const r1 = getTier(1)!.radius
    // The tier-1 lands and settles FIRST (like real gameplay).
    manager.spawnBall(360, b.floorY - r1 - 2, 1)
    step(1.5)
    // Then the two tier-4s drop as an overlapping pair DIRECTLY onto it:
    // their merge midpoint sits right above the tier-1 (distance ~115px,
    // well inside the tier-5 envelope 99 + tier-1 40 = 139 — the old
    // clamped-midpoint spawn buried the small ball).
    const pairY = b.floorY - r4 * 2.4
    manager.spawnBall(360 - r4 * 0.55, pairY, 4)
    manager.spawnBall(360 + r4 * 0.55, pairY, 4)
    step(2)
    // Exactly one replacement: exactly one tier-5 exists.
    expect(manager.getBalls().filter((e) => e.tier === 5)).toHaveLength(1)
    expect(manager.getBalls().filter((e) => e.tier === 4)).toHaveLength(0)
    // THE invariant: the small ball is not trapped inside the replacement.
    expect(worstPairOverlap(manager)).toBeLessThanOrEqual(2.5)
    physics.dispose()
  }, 60_000)

  it('four tier-1s chain-merge with exactly-once semantics and clean conservation', () => {
    const { manager, step, score } = rig()
    const b = containerBounds()
    const r1 = getTier(1)!.radius
    // Two pairs stacked on the floor
    manager.spawnBall(360 - r1 - 1, b.floorY - r1 - 2, 1)
    manager.spawnBall(360 + r1 + 1, b.floorY - r1 - 2, 1)
    manager.spawnBall(360 - r1 - 1, b.floorY - r1 * 3 - 6, 1)
    manager.spawnBall(360 + r1 + 1, b.floorY - r1 * 3 - 6, 1)
    // Track merge awards (each 'state:score' emission = exactly one merge)
    let awards = 0
    const off = gameBus.on('state:score', () => {
      awards++
    })
    step(6)
    off()
    // Conservation: each merge removes 2 balls and creates 1, so merges =
    // 4 − count; every award event corresponds to exactly one merge and the
    // score is the exact running sum the ScoreSystem reports.
    const merges = 4 - manager.count
    expect(merges).toBeGreaterThanOrEqual(2) // at least both pairs merged
    expect(awards).toBe(merges) // exactly-once: no duplicate merges/awards
    for (const e of manager.getBalls()) expect(e.tier).toBeGreaterThanOrEqual(2)
    expect(score.score).toBeGreaterThan(0)
    expect(worstPairOverlap(manager)).toBeLessThanOrEqual(2.5)
  }, 60_000)

  it('a merge in a dense pile leaves no ball trapped and no explosive impulse', () => {
    const { manager, step, physics } = rig()
    const b = containerBounds()
    const r3 = getTier(3)!.radius
    const r1 = getTier(1)!.radius
    // Dense pile: tier-3 pair beside fillers, tier-1 dropping onto the pair
    manager.spawnBall(320, b.floorY - r3 - 2, 3)
    manager.spawnBall(320 + r3 * 2 - 2, b.floorY - r3 - 2, 3) // overlapping pair
    manager.spawnBall(240, b.floorY - getTier(2)!.radius - 2, 2)
    manager.spawnBall(480, b.floorY - getTier(2)!.radius - 2, 2)
    manager.spawnBall(360, b.floorY - r3 * 2 - r1 - 6, 1)
    step(4)
    let maxSpeedSeen = 0
    for (let i = 0; i < 4; i++) {
      step(1)
      for (const e of manager.getBalls()) {
        for (const p of e.soft.particles) {
          maxSpeedSeen = Math.max(maxSpeedSeen, Math.hypot(p.velocity.x, p.velocity.y))
        }
      }
    }
    // No trapped ball: all overlaps within the settled-pile bound
    expect(worstPairOverlap(manager)).toBeLessThanOrEqual(2.5)
    // No explosive impulse from placement: speeds stay at/below the particle
    // cap (SOFT.maxParticleSpeed = 8) plus settle slack
    expect(maxSpeedSeen).toBeLessThanOrEqual(8.5)
    // Nothing escaped the container
    for (const e of manager.getBalls()) {
      const c = e.soft.center.position
      expect(c.y).toBeLessThan(b.floorY)
      expect(c.x).toBeGreaterThan(b.innerLeftAt(c.y) - 10)
      expect(c.x).toBeLessThan(b.innerRightAt(c.y) + 10)
    }
    physics.dispose()
  }, 90_000)
})
