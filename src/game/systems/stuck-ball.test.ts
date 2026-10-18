import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { containerBounds, wallCollidersAt, floorCollider } from '../../config/container'
import { getTier } from '../../config/ballTiers'
import Matter from 'matter-js'
import { PhysicsWorld } from './PhysicsWorld'
import { SoftBallManager } from './SoftBallManager'
import { createWallBody } from './ContainerBodies'

/**
 * STUCK-BALL regression: a fully-sleeping (frozen) ball with NO active
 * contacts must be woken by the manager's per-substep audit, because Matter
 * never delivers a collisionStart to a sleeping pair — without the audit it
 * hangs in mid-air until another ball physically hits it.
 *
 * The state is produced in the wild when a ball's support (a resting
 * neighbor) is removed while the wake reach misses it, or a contact pair
 * dies without an impact. Here it is reproduced deterministically by
 * force-freezing a mid-air ball into the exact commitRest state.
 */
function rig() {
  const physics = new PhysicsWorld()
  for (const body of [...wallCollidersAt().map(createWallBody), createWallBody(floorCollider())]) {
    physics.addBody(body)
  }
  const manager = new SoftBallManager(physics.world)
  manager.tierRadius = (t) => getTier(t)?.radius ?? 34
  const ids: number[] = []
  const substep = () => {
    physics.step(PHYSICS.stepMs)
    for (const e of physics.takeCollisionEvents()) ids.push(e.bodyA.id, e.bodyB.id)
    if (ids.length) manager.markTouched(ids)
    manager.stepAll(physics.activeContactBodyIds())
    manager.separateContacts()
    manager.expandShape()
    manager.clampToContainer()
    manager.commitRest()
  }
  return { physics, manager, substep }
}

describe('stuck-ball audit: unsupported frozen balls resume falling', () => {
  it('a ball force-frozen in mid-air falls again within one second', () => {
    const { physics, manager, substep } = rig()
    const b = containerBounds()
    const ball = manager.spawnBall(360, b.top + 120, 1)
    // Let spawn contacts settle, then freeze the ball in OPEN AIR — the
    // exact state commitRest produces (Sleeping.set on every particle).
    for (let i = 0; i < 30; i++) substep()
    for (const p of ball.soft.particles) Matter.Sleeping.set(p, true)
    Matter.Sleeping.set(ball.soft.center, true)
    const y0 = ball.soft.center.position.y
    for (let i = 0; i < PHYSICS.stepHz; i++) substep()
    const y1 = ball.soft.center.position.y
    expect(y1).toBeGreaterThan(y0 + 100)
    // It reaches the floor (nothing suspends it).
    expect(y1).toBeGreaterThan(b.floorY - 3 * getTier(1)!.radius)
    physics.dispose()
  })

  it('a supported ball resting on the floor is never falsely woken by the audit', () => {
    const { physics, manager, substep } = rig()
    const b = containerBounds()
    const ball = manager.spawnBall(360, b.floorY - getTier(1)!.radius - 2, 1)
    for (let i = 0; i < 4 * PHYSICS.stepHz; i++) substep()
    // A supported sleeper MUST be allowed: the audit only fires on
    // zero-active-contact balls; a floor-resting ball has floor contact.
    const y = ball.soft.center.position.y
    const asleep = ball.soft.center.isSleeping || ball.soft.particles.every((p) => p.isSleeping)
    if (asleep) {
      for (let i = 0; i < PHYSICS.stepHz; i++) substep()
      // It stayed put (not launched, not dropped through the floor).
      expect(Math.abs(ball.soft.center.position.y - y)).toBeLessThan(6)
    }
    physics.dispose()
  })
})
