import { describe, expect, it } from 'vitest'
import { ShakeManager } from './ShakeManager'
import Matter from 'matter-js'
import { CONTAINER } from '../../config/container'
import { SoftBallManager } from './SoftBallManager'
import { getTier } from '../../config/ballTiers'

describe('ShakeManager earthquake rumble and bounce pulses', () => {
  it('activates for 10s duration, triggers bounce pulses, and adds invisible extended side walls (no lid)', () => {
    let now = 1000
    const shake = new ShakeManager()
    shake.setClock(() => now)

    const addedBodies: Matter.Body[] = []
    const removedBodies: Matter.Body[] = []
    const mockPhysics = {
      addBody: (b: Matter.Body) => addedBodies.push(b),
      removeBody: (b: Matter.Body) => removedBodies.push(b),
    }

    const mockBalls = [
      {
        id: 2,
        state: 'settled',
        soft: {
          particles: [
            Matter.Bodies.circle(0, 0, 10),
            Matter.Bodies.circle(0, 0, 10),
          ],
        },
      },
    ]

    let wokeBallId = -1
    const mockManager = {
      getBalls: () => mockBalls,
      wakeBall: (id: number) => {
        wokeBallId = id
      },
      centroid: () => ({ x: 360, y: 800 }),
    } as unknown as Parameters<ShakeManager['bind']>[1]

    shake.bind(mockPhysics, mockManager)

    // Activate shake with wall height 320
    const activated = shake.activate()
    expect(activated).toBe(true)
    expect(shake.isActive).toBe(true)
    expect(shake.remainingMs).toBe(10000)
    // Two invisible extended side walls are added (left + right); no lid.
    expect(addedBodies.length).toBe(2)
    expect(addedBodies.map((b) => b.label).sort()).toEqual(['shake-wall-left', 'shake-wall-right'])
    expect(wokeBallId).toBe(2)

    // Initial update produces seismic rumble
    const frame0 = shake.update(now, 16)
    expect(frame0.active).toBe(true)
    expect(typeof frame0.cameraDx).toBe('number')
    expect(typeof frame0.cameraDy).toBe('number')
    expect(typeof frame0.cameraRotation).toBe('number')

    // Particles and dust are created
    expect(shake.getDebris().length).toBeGreaterThan(0)
    expect(shake.getDustPuffs().length).toBeGreaterThan(0)

    // Advance 5 seconds (active midway)
    now += 5000
    const mid = shake.update(now, 16)
    expect(mid.active).toBe(true)
    expect(shake.remainingMs).toBe(5000)

    // Advance past 10 seconds (expiration)
    now += 5001
    const end = shake.update(now, 16)
    expect(end.active).toBe(false)
    expect(shake.isActive).toBe(false)
    // Both extended side walls are removed on expiration.
    expect(removedBodies.length).toBe(2)
  })

  it('resets cleanly when reset() is called mid-ability', () => {
    const now = 500
    const shake = new ShakeManager()
    shake.setClock(() => now)

    const addedBodies: Matter.Body[] = []
    const removedBodies: Matter.Body[] = []
    shake.bind({
      addBody: (b) => addedBodies.push(b),
      removeBody: (b) => removedBodies.push(b),
    })

    shake.activate()
    expect(shake.isActive).toBe(true)
    expect(addedBodies.length).toBe(2)

    shake.reset()
    expect(shake.isActive).toBe(false)
    expect(removedBodies.length).toBe(2)
  })

  it('does not clamp or bounce balls vertically against an invisible top lid during Shake', () => {
    const engine = Matter.Engine.create()
    const manager = new SoftBallManager(engine.world)
    manager.tierRadius = (t: number) => getTier(t)?.radius ?? 38
    manager.shakeActive = true

    // Spawn a ball above the container wall tops (sideClampFromY = CONTAINER.topY)
    const aboveRimY = CONTAINER.topY - 40
    const ball = manager.spawnBall(360, aboveRimY, 1)
    for (const p of ball.soft.particles) {
      Matter.Body.setVelocity(p, { x: 0, y: -4 })
    }
    const minParticleYBefore = Math.min(...ball.soft.particles.map((p) => p.position.y))
    expect(minParticleYBefore).toBeLessThan(CONTAINER.topY)

    manager.clampToContainer()

    const minParticleYAfter = Math.min(...ball.soft.particles.map((p) => p.position.y))
    // Particle y and upward velocity must be untouched (no invisible lid pushing down)
    expect(minParticleYAfter).toBeCloseTo(minParticleYBefore, 5)
    for (const p of ball.soft.particles) {
      expect(p.velocity.y).toBeCloseTo(-4, 5)
    }
  })
})
