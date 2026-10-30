import { describe, expect, it } from 'vitest'
import { ShakeManager } from './ShakeManager'
import Matter from 'matter-js'

describe('ShakeManager earthquake rumble and bounce pulses', () => {
  it('activates for 10s duration, triggers bounce pulses, and cleans up side walls', () => {
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
    } as unknown as Parameters<ShakeManager['bind']>[1]

    shake.bind(mockPhysics, mockManager)

    // Activate shake with wall height 320
    const activated = shake.activate(320)
    expect(activated).toBe(true)
    expect(shake.isActive).toBe(true)
    expect(shake.remainingMs).toBe(10000)
    // Two side walls installed (no top lid)
    expect(addedBodies.length).toBe(2)
    expect(addedBodies[0]?.label).toBe('shake-side-wall')
    expect(addedBodies[1]?.label).toBe('shake-side-wall')
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
    // Both side walls removed
    expect(removedBodies.length).toBe(2)
    expect(removedBodies[0]?.label).toBe('shake-side-wall')
    expect(removedBodies[1]?.label).toBe('shake-side-wall')
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

    shake.activate(320)
    expect(shake.isActive).toBe(true)
    expect(addedBodies.length).toBe(2)

    shake.reset()
    expect(shake.isActive).toBe(false)
    expect(removedBodies.length).toBe(2)
  })
})
