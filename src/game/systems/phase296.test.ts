import { describe, expect, it } from 'vitest'
import Matter from 'matter-js'
import { PHYSICS } from '../../config/physics'
import { createSoftBall, renderContour } from './SoftBall'
import { SoftBallManager } from './SoftBallManager'
import { wallCollidersAt, CONTAINER } from '../../config/container'
import { createWallBody } from './ContainerBodies'
import { WallAnimator } from './WallAnimator'
import { getTier } from '../../config/ballTiers'

describe('Phase 2.9.6: wall ability lifecycle', () => {
  it('raise→hold→lower→normal with collider sync and ball safety', () => {
    let fakeTime = 0
    const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, positionIterations: 14, velocityIterations: 12, constraintIterations: 6, enableSleeping: true })
    Matter.Composite.add(engine.world, [Matter.Bodies.rectangle(360, 1020, 720, 80, { isStatic: true })])
    const wallBodies = wallCollidersAt().map((spec) => createWallBody(spec))
    for (const body of wallBodies) Matter.Composite.add(engine.world, body)
    const manager = new SoftBallManager(engine.world)
    manager.tierRadius = (t: number) => getTier(t)?.radius ?? 38
    const redraws: number[] = []
    const walls = new WallAnimator()
    walls.setClock(() => fakeTime)
    walls.bind(wallBodies, (h) => redraws.push(h), manager)
    const ball = manager.spawnBall(360, CONTAINER.topY + CONTAINER.height - 100, 1)
    for (let i = 0; i < 240; i++) {
      fakeTime += 16.6
      Matter.Engine.update(engine, PHYSICS.stepMs)
      manager.stepAll()
      manager.separateContacts()
      walls.update(fakeTime)
    }
    expect(walls.height).toBeCloseTo(CONTAINER.height, 0) // normal (lowered) default
    expect(walls.activate()).toBe(true)
    expect(walls.activate()).toBe(false) // no re-trigger while active
    for (let i = 0; i < 120; i++) {
      fakeTime += 16.6
      Matter.Engine.update(engine, PHYSICS.stepMs)
      manager.stepAll()
      manager.separateContacts()
      walls.update(fakeTime)
    }
    expect(walls.phaseNow).toBe('raised')
    expect(walls.height).toBeCloseTo(CONTAINER.raisedHeight, 0)
    expect(redraws.length).toBeGreaterThan(5) // visuals were synced
    const c = ball.soft.center.position
    expect(c.y).toBeLessThan(CONTAINER.topY + 800)
    let sawLowering = false
    for (let i = 0; i < 25 * 60 + 200; i++) {
      fakeTime += 16.6
      Matter.Engine.update(engine, PHYSICS.stepMs)
      manager.stepAll()
      manager.separateContacts()
      walls.update(fakeTime)
      if (walls.phaseNow === 'lowering') sawLowering = true
      if (sawLowering && walls.phaseNow === 'normal') break
    }
    expect(sawLowering).toBe(true)
    expect(walls.height).toBeCloseTo(CONTAINER.height, 0)
    const c2 = ball.soft.center.position
    expect(Number.isFinite(c2.x)).toBe(true)
  })
})

describe('Phase 2.9.6: size progression', () => {
  it('blue and green increased, progression still monotonic', () => {
    expect(getTier(1)!.radius).toBeGreaterThan(34) // increased from 34
    expect(getTier(2)!.radius).toBeGreaterThan(44) // increased from 44
    for (let t = 1; t < 6; t++) {
      expect(getTier(t + 1)!.radius).toBeGreaterThan(getTier(t)!.radius)
    }
  })
})

describe('Phase 2.9.6: hand-drawn irregularity', () => {
  it('different balls have different contour shapes (deterministic per seed)', () => {
    const ball1 = createSoftBall(360, 300, 90, 1)
    const ball2 = createSoftBall(360, 300, 90, 2)
    const c1 = renderContour(ball1, 6, 90 * 0.32)
    const c2 = renderContour(ball2, 6, 90 * 0.32)
    // shapes must differ (not identical circles)
    let diff = 0
    for (let i = 0; i < c1.length; i++) {
      diff += Math.abs(c1[i]!.x - c2[i]!.x) + Math.abs(c1[i]!.y - c2[i]!.y)
    }
    // Phase 2.9.8 envelope safety reduced the per-seed wave to an inward dip
    // capped at ~0.7% of radius (≤ ~1.3px swing on a radius-90 ball), so two
    // seeds now differ by a small but clearly nonzero amount (~2–3px summed
    // over 144 samples). Threshold keeps the intent: not identical circles.
    expect(diff).toBeGreaterThan(1)
    // deterministic: same ball object gives the same contour on re-render
    const c1b = renderContour(ball1, 6, 90 * 0.32)
    let drift = 0
    for (let i = 0; i < c1.length; i++) {
      drift += Math.abs(c1[i]!.x - c1b[i]!.x) + Math.abs(c1[i]!.y - c1b[i]!.y)
    }
    expect(drift).toBeLessThan(2) // stable (no random per-frame change)
    // still round overall
    const radii = c1.map((p) => Math.hypot(p.x - 360, p.y - 300))
    expect(Math.max(...radii) / Math.min(...radii)).toBeLessThan(1.08)
  })
})
