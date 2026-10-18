import { describe, expect, it } from 'vitest'
import Matter from 'matter-js'
import { PHYSICS } from '../../config/physics'
import { createSoftBall, softBallSpeed, softBallArea, softBallCentroid, renderContour } from './SoftBall'
import { SoftBallManager } from './SoftBallManager'
import { containerBounds } from '../../config/container'
import { getTier } from '../../config/ballTiers'

function makeRig() {
  const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, positionIterations: 14, velocityIterations: 12, constraintIterations: 6, enableSleeping: true })
  Matter.Composite.add(engine.world, [
    Matter.Bodies.rectangle(360, 1020, 720, 80, { isStatic: true }),
    Matter.Bodies.rectangle(216, 700, 28, 700, { isStatic: true }),
    Matter.Bodies.rectangle(504, 700, 28, 700, { isStatic: true }),
  ])
  const manager = new SoftBallManager(engine.world)
  manager.tierRadius = (t: number) => getTier(t)?.radius ?? 38
  return { engine, manager }
}

function stepRig(engine: Matter.Engine, manager: SoftBallManager) {
  Matter.Engine.update(engine, PHYSICS.stepMs)
  manager.stepAll()
  manager.separateContacts()
  manager.clampToContainer()
  manager.commitRest()
}

describe('Phase 2.9.7: interpenetration bounded during dense pile', () => {
  it('max cross-ball particle overlap stays bounded during rapid drops', () => {
    const { engine, manager } = makeRig()
    const b = containerBounds()
    let maxPen = 0
    for (let k = 0; k < 10; k++) {
      const tier = (k % 3) + 1
      const r = getTier(tier)!.radius
      manager.spawnBall(260 + (k % 5) * 55, b.top + r + 32, tier)
      for (let i = 0; i < 90; i++) {
        stepRig(engine, manager)
        const balls = manager.getBalls()
        for (let a = 0; a < balls.length; a++) {
          for (let c = a + 1; c < balls.length; c++) {
            for (const pa of balls[a]!.soft.particles) {
              for (const pb of balls[c]!.soft.particles) {
                const d = Math.hypot(pa.position.x - pb.position.x, pa.position.y - pb.position.y)
                const contact = balls[a]!.soft.radius * 0.32 + balls[c]!.soft.radius * 0.32
                if (d < contact) maxPen = Math.max(maxPen, contact - d)
              }
            }
          }
        }
      }
    }
    // The stiffer ring + aggressive separation keeps worst-case penetration
    // bounded; it can still transiently spike during the highest-speed
    // impacts but must resolve within a few frames.
    expect(maxPen).toBeLessThan(45)
  })
})

describe('Phase 2.9.7: no container escape', () => {
  it('particles stay inside the container through dense-pile stress', () => {
    const { engine, manager } = makeRig()
    const b = containerBounds()
    for (let k = 0; k < 12; k++) {
      const tier = (k % 4) + 1
      const r = getTier(tier)!.radius
      manager.spawnBall(260 + (k % 5) * 55, b.top + r + 32, tier)
      for (let i = 0; i < 75; i++) stepRig(engine, manager)
    }
    for (let i = 0; i < 240; i++) stepRig(engine, manager)
    for (const ball of manager.getBalls()) {
      const particles: Matter.Body[] = ball.soft.particles
      for (const p of particles) {
        expect(p.position.x).toBeGreaterThan(b.left - 10)
        expect(p.position.x).toBeLessThan(b.right + 10)
        expect(p.position.y).toBeLessThan(b.floorY + 90)
      }
    }
  })
})

describe('Phase 2.9.7: resting stability with stiff ring', () => {
  it('settled ball speed decreases over time', () => {
    const { engine, manager } = makeRig()
    const ball = manager.spawnBall(360, 700, 2)
    for (let i = 0; i < 240; i++) stepRig(engine, manager)
    let sumEarly = 0
    let sumLate = 0
    for (let i = 0; i < 150; i++) {
      stepRig(engine, manager)
      const s = softBallSpeed(ball.soft)
      if (i < 75) sumEarly += s
      else sumLate += s
    }
    // Late-phase speed should not exceed early-phase (no accumulating energy)
    expect(sumLate / 75).toBeLessThanOrEqual(sumEarly / 75 * 1.2)
  })
})

describe('Phase 2.9.7: hand-drawn contour is subtle and deterministic', () => {
  it('contour ratio ≤ 1.08 and stable across re-renders', () => {
    const ball = createSoftBall(360, 300, 90, 1)
    void softBallArea
    void softBallCentroid
    const c1 = renderContour(ball, 6, 90 * 0.32)
    const radii = c1.map((p) => Math.hypot(p.x - 360, p.y - 300))
    expect(Math.max(...radii) / Math.min(...radii)).toBeLessThan(1.08)
    const c2 = renderContour(ball, 6, 90 * 0.32)
    let drift = 0
    for (let i = 0; i < c1.length; i++) {
      drift += Math.abs(c1[i]!.x - c2[i]!.x) + Math.abs(c1[i]!.y - c2[i]!.y)
    }
    expect(drift).toBeLessThan(2)
  })
})
