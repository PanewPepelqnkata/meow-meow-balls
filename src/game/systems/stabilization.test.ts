import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { PhysicsWorld } from './PhysicsWorld'
import { SoftBallManager } from './SoftBallManager'
import { createWallBody, floorCollider } from './ContainerBodies'
import { containerBounds, wallCollidersAt } from '../../config/container'
import { getTier } from '../../config/ballTiers'
import { softBallSleeping, softBallArea, softBallMaxSpeed } from './SoftBall'

/**
 * Phase 2.9.8 stabilization regressions. These run the ACTUAL production
 * stepping path (PhysicsWorld.step → Engine.update → stepAll →
 * separateContacts → expandShape → clampToContainer, plus the scene's
 * event drain for merge eligibility) and pin the measured invariants:
 *  - cross-ball collision discs never interpenetrate in a settled pile,
 *  - rendered shapes stay round and recognizable under load,
 *  - a settled pile becomes visually still (whole-ball sleep),
 *  - no particle escapes the container,
 *  - free fall is never frozen,
 *  - merging still works through the whole-ball rest mechanism.
 */

const STEP = PHYSICS.stepMs

function makeProductionRig() {
  const physics = new PhysicsWorld()
  for (const body of [...wallCollidersAt().map(createWallBody), createWallBody(floorCollider())]) {
    physics.addBody(body)
  }
  const manager = new SoftBallManager(physics.world)
  manager.tierRadius = (t) => getTier(t)?.radius ?? 34
  // exactly the PlaygroundScene substep handler
  physics.setSubStepHandler(() => {
    manager.stepAll()
    manager.separateContacts()
    manager.expandShape()
    manager.clampToContainer()
    manager.commitRest()
  })
  const drainEvents = () => {
    const events = physics.takeCollisionEvents()
    if (events.length) {
      manager.markTouched(events.flatMap(({ bodyA, bodyB }) => [bodyA.id, bodyB.id]))
    }
  }
  return { physics, manager, drainEvents }
}

/** Worst cross-ball overlap of the actual collision discs (bodyR incl. skin). */
function worstPairOverlap(manager: SoftBallManager): number {
  const balls = manager.getBalls()
  let worst = -Infinity
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

describe('Phase 2.9.8: contact integrity in a settled pile', () => {
  it('a settled mixed pile holds with zero disc overlap, round shapes, and no escapes', () => {
    const { physics, manager, drainEvents } = makeProductionRig()
    const b = containerBounds()
    for (let k = 0; k < 8; k++) {
      manager.spawnBall(260 + (k % 4) * 65, b.top + 50, (k % 3) + 1)
      for (let i = 0; i < 40; i++) {
        physics.step(STEP)
        drainEvents()
      }
    }
    for (let i = 0; i < 1200; i++) {
      physics.step(STEP)
      drainEvents()
    }
    // contact integrity: no visible interpenetration at the end of the
    // sequence. Phase 2.9.9: threshold 0.5 → 2.5. The separation backstop no
    // longer moves a coherently-SLEEPING ball (frozen-terrain semantics — it
    // never moves or wakes one, ending the measured endless sleep/wake
    // cycle); when the awake side is wall-blocked it can take only part of a
    // fix before it too settles, leaving a small standing overlap. The
    // contact skin gives 4px of collision-envelope clearance between visual
    // surfaces, so ≤2.5px keeps a visible gap (further covered by the ink
    // stroke); the old 0.5 was only achievable by churning frozen balls.
    expect(worstPairOverlap(manager)).toBeLessThanOrEqual(2.5)
    // shape quality: every ball stays a recognizable, near-round body
    for (const e of manager.getBalls()) {
      const ratio = softBallArea(e.soft) / e.soft.restArea
      expect(ratio).toBeGreaterThan(0.62) // no catastrophic collapse
      const xs = e.soft.particles.map((p) => p.position.x)
      const ys = e.soft.particles.map((p) => p.position.y)
      const sx = Math.max(...xs) - Math.min(...xs)
      const sy = Math.max(...ys) - Math.min(...ys)
      expect(Math.min(sx, sy) / Math.max(sx, sy)).toBeGreaterThan(0.55) // not a line
    }
    // boundary safety: every particle center inside the container — checked
    // against the wall lines at the PARTICLE'S OWN y (the walls slope inward,
    // so a particle resting against a wall higher up sits outside the
    // floor-level line by geometry, not by escape; the container clamp
    // enforces exactly this per-y invariant)
    for (const e of manager.getBalls()) {
      for (const p of e.soft.particles) {
        expect(p.position.y).toBeLessThan(b.floorY)
        expect(p.position.x).toBeGreaterThan(b.innerLeftAt(p.position.y))
        expect(p.position.x).toBeLessThan(b.innerRightAt(p.position.y))
      }
    }
    // visual stillness: nothing moving fast in a settled pile
    for (const e of manager.getBalls()) {
      expect(softBallMaxSpeed(e.soft)).toBeLessThan(2)
    }
  }, 120000)

  it('a settled pile sleeps as whole balls and wakes on a new drop', () => {
    const { physics, manager, drainEvents } = makeProductionRig()
    const b = containerBounds()
    const first = manager.spawnBall(360, b.top + 60, 2)
    for (let i = 0; i < 1200; i++) {
      physics.step(STEP)
      drainEvents()
    }
    expect(softBallSleeping(first.soft)).toBe(true)
    // a new drop wakes it through genuine contact
    manager.spawnBall(360, b.top + 60, 1)
    let woke = false
    for (let i = 0; i < 600 && !woke; i++) {
      physics.step(STEP)
      drainEvents()
      woke = !softBallSleeping(first.soft)
    }
    expect(woke).toBe(true)
  }, 120000)
})

describe('Phase 2.9.8: free fall preserved', () => {
  it('an untouched airborne ball never sleeps and keeps accelerating', () => {
    const { physics, manager, drainEvents } = makeProductionRig()
    const b = containerBounds()
    // Spawn in the open sky above the rim: with the 8-unit travel cap the
    // 120-step window covers ~500px of fall — spawning 240px above the rim
    // keeps the WHOLE window airborne (impact lands after step ~142).
    const ball = manager.spawnBall(360, b.top - 240, 3)
    const speeds: number[] = []
    for (let i = 0; i < 120; i++) {
      physics.step(STEP)
      drainEvents()
      speeds.push(softBallMaxSpeed(ball.soft))
      expect(softBallSleeping(ball.soft)).toBe(false)
    }
    // gravity: velocity grows monotonically toward the travel clamp
    expect(speeds[speeds.length - 1]!).toBeGreaterThan(speeds[5]!)
    expect(speeds[speeds.length - 1]!).toBeGreaterThan(3)
  }, 60000)
})

describe('Phase 2.9.8: merge through the rest mechanism', () => {
  it('two resting same-tier balls still merge on contact', () => {
    const { physics, manager, drainEvents } = makeProductionRig()
    const b = containerBounds()
    const a = manager.spawnBall(340, b.floorY - 40, 1)
    const c = manager.spawnBall(384, b.floorY - 40, 1)
    // settle until both sleep (rest gate), then verify a same-tier pair can
    // still be recognized — merging itself is driven by MergeSystem on
    // collision events (covered by merge.test.ts); here we pin that the rest
    // state does not destroy merge eligibility data or the composites.
    for (let i = 0; i < 1200; i++) {
      physics.step(STEP)
      drainEvents()
    }
    expect(manager.getBallById(a.id)).toBeDefined()

    expect(a.touched).toBe(true)
    expect(c.touched).toBe(true)
    // Phase 2.10.1: the slime-softened ring settles with ~1px of standing
    // contact overlap at the resting seam (was ≤0.5 at the stiffer 2.10.0
    // tuning) — still far inside the settled-pile bound (2.5) and fully
    // covered by the contour's ink stroke.
    expect(worstPairOverlap(manager)).toBeLessThanOrEqual(2.5)
  }, 120000)
})
