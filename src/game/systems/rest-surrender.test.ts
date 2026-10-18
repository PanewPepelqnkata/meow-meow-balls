import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { containerBounds, wallCollidersAt, floorCollider } from '../../config/container'
import { getTier } from '../../config/ballTiers'
import Matter from 'matter-js'
import { PhysicsWorld } from './PhysicsWorld'
import { SoftBallManager } from './SoftBallManager'
import { SOFT, softBallSleeping } from './SoftBall'
import { createWallBody } from './ContainerBodies'

/**
 * Phase 2.10.0 WAR SURRENDER regression (see SOFT.restWarSurrenderSteps).
 *
 * Measured live defect: a ball wedged in a dense pile can enter a standing
 * constraint/contact war — Matter's constraint solver displaces positions
 * every substep (its corrections turn into velocity on the next Body.update),
 * the separation backstop repairs the created overlap, and a few particles
 * pin at the travel cap FOREVER. The rest gate's speed threshold then reset
 * the quiet window every substep ('fast') and the pile never fully slept.
 *
 * The fix: after restWarSurrenderSteps CONSECUTIVE fast substeps, a ball
 * whose area is still ~at rest is in solver churn, not a real disturbance —
 * the speed gate stands down and the drift gate alone decides rest.
 *
 * The pipeline is driven manually (like the production substep handler) so
 * the injected war velocities are live exactly when the rest gate reads them
 * — matching the real war, where the constraint corrections are born inside
 * Engine.update and are present post-solve at gate time.
 */

function rig() {
  const physics = new PhysicsWorld()
  for (const body of [...wallCollidersAt().map(createWallBody), createWallBody(floorCollider())]) {
    physics.addBody(body)
  }
  const manager = new SoftBallManager(physics.world)
  manager.tierRadius = (t) => getTier(t)?.radius ?? 34
  const ids: number[] = []
  const substep = (warInject?: () => void) => {
    physics.step(PHYSICS.stepMs)
    for (const e of physics.takeCollisionEvents()) ids.push(e.bodyA.id, e.bodyB.id)
    if (ids.length) manager.markTouched(ids)
    warInject?.()
    manager.stepAll()
    manager.separateContacts()
    manager.expandShape()
    manager.clampToContainer()
    manager.commitRest()
  }
  return { physics, manager, substep }
}

describe('Phase 2.10.0: rest-gate war surrender', () => {
  it('standing war surrenders to the drift gate; real motion still blocks sleep', () => {
    const { physics, manager, substep } = rig()
    const b = containerBounds()
    const ball = manager.spawnBall(360, b.floorY - getTier(2)!.radius - 2, 2)
    // Settle into floor contact (touched); a lone ball legitimately sleeps here
    for (let i = 0; i < 2 * PHYSICS.stepHz; i++) substep()
    expect(ball.touched).toBe(true)
    manager.wakeBall(ball.id)
    expect(softBallSleeping(ball.soft)).toBe(false)

    const ps = ball.soft.particles

    // ---- Phase A: the standing war (up to 15s) -----------------------------
    // Two opposite particles carry oscillating cap-adjacent velocities at
    // gate time (net centroid force ≈ 0 — the measured signature: local
    // solver churn, centroid net ~0, area ~1, speeds near the cap). Sleep
    // = surrender threshold (8s) + one full quiet window (2s).
    let maxWar = 0
    let slept = -1
    for (let i = 0; i < 15 * PHYSICS.stepHz; i++) {
      const s = (i % 2 === 0 ? 1 : -1) * 7.5
      substep(() => {
        if (!softBallSleeping(ball.soft)) {
          Matter.Body.setVelocity(ps[1]!, { x: 0, y: s })
          Matter.Body.setVelocity(ps[9]!, { x: 0, y: -s })
        }
      })
      maxWar = Math.max(maxWar, manager.restDebug(ball.id).war)
      if (slept < 0 && softBallSleeping(ball.soft)) slept = i
    }
    // The war counter must have exceeded the surrender threshold…
    expect(maxWar).toBeGreaterThan(SOFT.restWarSurrenderSteps)
    // …and the ball must have slept afterwards (within the 15s war sim).
    expect(slept).toBeGreaterThan(0)
    expect(softBallSleeping(ball.soft)).toBe(true)

    // ---- Phase B: surrender must not mask REAL motion ---------------------
    // Wake it and apply a SLOW coherent drift (0.4 px/step — below the speed
    // gate entirely): the drift gate must keep the ball awake.
    manager.wakeBall(ball.id)
    let driftedSeen = false
    for (let i = 0; i < Math.floor(0.4 * PHYSICS.stepHz); i++) {
      substep(() => {
        if (!softBallSleeping(ball.soft)) {
          for (const p of ball.soft.particles) Matter.Body.setVelocity(p, { x: 2, y: 0 })
          Matter.Body.setVelocity(ball.soft.center, { x: 2, y: 0 })
        }
      })
      if (manager.restDebug(ball.id).lastReset === 'drifted') driftedSeen = true
    }
    expect(driftedSeen).toBe(true)
    expect(softBallSleeping(ball.soft)).toBe(false)

    // ---- Phase C: motion stops → the ball sleeps again ---------------------
    for (let i = 0; i < 5 * PHYSICS.stepHz && !softBallSleeping(ball.soft); i++) substep()
    expect(softBallSleeping(ball.soft)).toBe(true)
    physics.dispose()
  }, 120_000)
})
