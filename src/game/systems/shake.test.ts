import { describe, expect, it } from 'vitest'
import { ShakeManager } from './ShakeManager'
import Matter from 'matter-js'

describe('ShakeManager ability lifecycle and escape prevention', () => {
  it('activates for exactly 10s duration and removes lid on expiration', () => {
    let nowMs = 1000
    const shake = new ShakeManager()
    shake.setClock(() => nowMs)

    const addedBodies: Matter.Body[] = []
    const removedBodies: Matter.Body[] = []
    const dummyPhysics = {
      addBody: (b: Matter.Body) => addedBodies.push(b),
      removeBody: (b: Matter.Body) => removedBodies.push(b),
    }
    shake.bind(dummyPhysics, null)
    expect(shake.isActive).toBe(false)
    expect(shake.remainingMs).toBe(0)

    const activated = shake.activate(320)
    expect(activated).toBe(true)
    expect(shake.isActive).toBe(true)
    expect(shake.remainingMs).toBe(10_000)
    expect(addedBodies.length).toBe(1)
    expect(addedBodies[0]?.label).toBe('shake-lid')

    // Repeated activation while active is rejected
    expect(shake.activate(320)).toBe(false)

    // Mid-duration update
    nowMs += 5000
    const mid = shake.update(nowMs)
    expect(mid.active).toBe(true)
    expect(shake.remainingMs).toBe(5000)
    expect(removedBodies.length).toBe(0)

    // Expiration after 10s
    nowMs += 5001
    const finished = shake.update(nowMs)
    expect(finished.active).toBe(false)
    expect(shake.isActive).toBe(false)
    expect(shake.remainingMs).toBe(0)
    expect(removedBodies.length).toBe(1)
    expect(removedBodies[0]?.label).toBe('shake-lid')
  })

  it('reset() tears down lid and clears active state', () => {
    const shake = new ShakeManager()
    const addedBodies: Matter.Body[] = []
    const removedBodies: Matter.Body[] = []
    shake.bind({
      addBody: (b: Matter.Body) => addedBodies.push(b),
      removeBody: (b: Matter.Body) => removedBodies.push(b),
    }, null)

    shake.activate(320)
    expect(shake.isActive).toBe(true)
    expect(addedBodies.length).toBe(1)

    shake.reset()
    expect(shake.isActive).toBe(false)
    expect(removedBodies.length).toBe(1)
  })
})
