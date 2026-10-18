import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { wallCollidersAt, floorCollider, containerBounds } from '../../config/container'
import { PhysicsWorld } from './PhysicsWorld'
import { SoftBallManager } from './SoftBallManager'
import { createWallBody } from './ContainerBodies'
import { getTier } from '../../config/ballTiers'
import { softBallCentroid, softBallSleeping } from './SoftBall'
import { isOutsideContainer } from '../../config/gameOver'
import Matter from 'matter-js'

/**
 * Phase 2.10.1: open-top containment (SoftBallManager.wallTopY) — spec §3.
 * The side-wall backstop must only apply BELOW the current wall tops so a
 * ball pushed past the wall line above the tops can genuinely leave the
 * container — otherwise the overflow game-over rule could never fire. The
 * floor backstop is unconditional.
 */
function openTopRig(wallTopY: number) {
  const physics = new PhysicsWorld()
  for (const body of [...wallCollidersAt().map(createWallBody), createWallBody(floorCollider())]) {
    physics.addBody(body)
  }
  const manager = new SoftBallManager(physics.world)
  manager.tierRadius = (t) => getTier(t)?.radius ?? 34
  manager.wallTopY = wallTopY
  physics.setSubStepHandler(() => {
    manager.stepAll()
    manager.separateContacts()
    manager.expandShape()
    manager.clampToContainer()
    manager.commitRest()
  })
  const drain = () => {
    const evs = physics.takeCollisionEvents()
    if (evs.length) manager.markTouched(evs.flatMap((e) => [e.bodyA.id, e.bodyB.id]))
  }
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      physics.step(PHYSICS.stepMs)
      drain()
    }
  }
  return { physics, manager, step }
}

describe('Phase 2.10.1: open-top containment (wallTopY)', () => {
  it('a ball pushed past the wall line ABOVE the tops is not clamped back inside', () => {
    const b = containerBounds()
    const topY = b.floorY - 400
    const { manager, step } = openTopRig(topY)
    const r = getTier(2)!.radius

    // Spawn just above the wall tops, near the right wall line, moving
    // outward: it crosses the extrapolated line in open sky.
    const crossX = b.innerRightAt(topY - 20) - r
    const ball = manager.spawnBall(crossX, topY - 20 - r, 2)
    Matter.Body.setVelocity(ball.soft.center, { x: 6, y: -1 })
    for (const p of ball.soft.particles) Matter.Body.setVelocity(p, { x: 6, y: -1 })
    step(PHYSICS.stepHz * 3)
    const c = softBallCentroid(ball.soft)
    // Genuinely past the wall line — the backstop did NOT resurrect it. (It
    // typically perches on the wall-top ledge, above the tops = open sky;
    // the game-over rule correctly waits for it to drop below the tops.)
    expect(c.x - b.innerRightAt(c.y)).toBeGreaterThan(6)
    step(PHYSICS.stepHz * 2)
    const c2 = softBallCentroid(ball.soft)
    expect(c2.x - b.innerRightAt(c2.y)).toBeGreaterThan(6)
  }, 120_000)

  it('a ball falling outside the walls (below the tops) stays outside and reads as overflow', () => {
    const b = containerBounds()
    const topY = b.floorY - 400
    const { manager, step } = openTopRig(topY)
    const r = getTier(2)!.radius

    // Spawn DIRECTLY outside, beyond the wall slab's outer face, below the
    // tops — the end state of a ball that rolled over the rim and is now
    // falling down the outside of the wall.
    const y = topY + 150
    const x = b.innerRightAt(y) + 80 + r
    const ball = manager.spawnBall(x, y, 2)
    step(PHYSICS.stepHz * 2)
    const c = softBallCentroid(ball.soft)
    // It is genuinely OUTSIDE, below the tops, and the dwell rule reads it
    // as overflow. (It slides down the wall's outer face, so the fall is
    // friction-slowed — what matters is outside-ness, not fall distance.)
    expect(c.y).toBeGreaterThan(topY)
    expect(isOutsideContainer(c, 400)).toBe(true)
    // ...and the backstop never dragged it back inside the funnel.
    step(PHYSICS.stepHz)
    const c2 = softBallCentroid(ball.soft)
    expect(c2.y).toBeGreaterThan(topY)
    expect(isOutsideContainer(c2, 400)).toBe(true)
  }, 120_000)

  it('a ball pressed against the wall BELOW the tops is still contained', () => {
    const b = containerBounds()
    const topY = b.floorY - 400
    const { manager, step } = openTopRig(topY)
    const r = getTier(2)!.radius

    // Wedge a ball against the right wall low in the funnel, pushed outward
    const ball = manager.spawnBall(b.innerRightAt(b.floorY - r) - r, b.floorY - r - 1, 2)
    Matter.Body.setVelocity(ball.soft.center, { x: 5, y: 0 })
    for (const p of ball.soft.particles) Matter.Body.setVelocity(p, { x: 5, y: 0 })
    step(PHYSICS.stepHz * 2)
    const c = softBallCentroid(ball.soft)
    // Contained: centroid must remain INSIDE the wall line (backstop holds)
    expect(c.x).toBeLessThan(b.innerRightAt(c.y) + 2)
  }, 120_000)
})

/* --- Phase 2.10.2: corrected escape classification ------------------------- */

describe('Phase 2.10.2: wall-band containment classification', () => {
  it('a ball squeezed past the inner line FROM INSIDE is clamped back (no band-stuck state)', () => {
    const b = containerBounds()
    const topY = b.floorY - 400
    const { manager, step } = openTopRig(topY)

    // Embed the ball's centroid just past the inner wall line (inside the
    // band, < frameThickness) below the tops — the state a hard wall-side
    // squeeze can produce. It must be pushed back inside, not exempted.
    const y = topY + 150
    const embeddedX = b.innerRightAt(y) + 12 // past the line, inside the band
    const ball = manager.spawnBall(embeddedX, y, 2)
    step(PHYSICS.stepHz * 3)
    const c = softBallCentroid(ball.soft)
    const past = c.x - b.innerRightAt(c.y)
    expect(past).toBeLessThan(6) // back on the inner side (contact depth)
  }, 120_000)

  it('a ball fully beyond the wall band OUTER face (below the tops) stays outside', () => {
    const b = containerBounds()
    const topY = b.floorY - 400
    const { manager, step } = openTopRig(topY)
    const r = getTier(2)!.radius

    const y = topY + 150
    const x = b.innerRightAt(y) + 80 + r // beyond the band's outer face
    const ball = manager.spawnBall(x, y, 2)
    step(PHYSICS.stepHz * 2)
    const c = softBallCentroid(ball.soft)
    expect(c.x - b.innerRightAt(Math.min(c.y, b.floorY))).toBeGreaterThan(28)
    expect(c.y).toBeGreaterThan(topY)
  }, 120_000)
})

/* --- Phase 2.10.2: compressed wall-wedge war surrender ---------------------- */

describe('Phase 2.10.2: war surrender reaches compressed wall wedges', () => {
  it('a wedged ball held in a cap-saturated standing wave still falls asleep', () => {
    const b = containerBounds()
    const topY = b.floorY - 400
    const { manager, step } = openTopRig(topY)
    const r = getTier(2)!.radius

    // Ball resting against the right wall, kept in a standing wave by
    // re-injected cap-level velocities every substep (the wall-contact
    // limit cycle). War surrender (600 fast substeps) + drift gate must
    // put it to sleep; the 2.10.0 tuning (area within 3% only, 960 steps)
    // is covered by rest-surrender.test.ts.
    const ball = manager.spawnBall(b.innerRightAt(b.floorY - r) - r, b.floorY - r - 1, 2)
    let slept = false
    for (let i = 0; i < PHYSICS.stepHz * 20 && !slept; i++) {
      step(1)
      if (!softBallSleeping(ball.soft)) {
        // Standing-wave churn: cap-level speed with ZERO net displacement
        // (direction alternates every substep, exactly like the measured
        // wall-contact limit cycle). The drift gate must stay satisfied.
        const dir = i % 2 === 0 ? 1 : -1
        Matter.Body.setVelocity(ball.soft.center, { x: 7 * dir, y: 0 })
        for (const p of ball.soft.particles) Matter.Body.setVelocity(p, { x: 7 * dir, y: 0 })
      }
      slept = softBallSleeping(ball.soft)
    }
    expect(slept).toBe(true)
  }, 240_000)
})
