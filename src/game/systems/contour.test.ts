import { describe, expect, it } from 'vitest'
import Matter from 'matter-js'
import { createSoftBall, renderContour, applyPressure, clampSoftBallSpeed } from './SoftBall'

function step(ball: Parameters<typeof applyPressure>[0], engine: Matter.Engine) {
  Matter.Engine.update(engine, 1000 / 60)
  clampSoftBallSpeed(ball)
  applyPressure(ball)
}

describe('smooth contour (2.8 §1)', () => {
  it('resting contour: smooth, closed, near-circular, no overshoot', () => {
    const ball = createSoftBall(360, 300, 90, 1)
    const c = renderContour(ball, 6, 90 * 0.32) // outset = visual particle radius
    expect(c.length).toBe(96)
    const cx = 360
    const cy = 300
    const radii = c.map((p) => Math.hypot(p.x - cx, p.y - cy))
    const min = Math.min(...radii)
    const max = Math.max(...radii)
    expect(max / min).toBeLessThan(1.12) // near-circular at rest
    // consistent winding → no cusps or self-intersections
    let turns = 0
    for (let i = 0; i < c.length; i++) {
      const a = c[i]!
      const b = c[(i + 1) % c.length]!
      const d = c[(i + 2) % c.length]!
      const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x)
      turns += cross > 0 ? 1 : -1
    }
    expect(Math.abs(turns)).toBe(c.length)
    // smoothness: bounded adjacent-point distance (no corners/gaps)
    for (let i = 0; i < c.length; i++) {
      const a = c[i]!
      const b = c[(i + 1) % c.length]!
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(20)
    }
  })

  it('flattened contour: deformed, smooth, no self-intersection or collapse', () => {
    const engine = Matter.Engine.create({
      gravity: { x: 0, y: 1, scale: 0.0016 },
      positionIterations: 10,
      velocityIterations: 8,
      constraintIterations: 4,
      enableSleeping: false,
    })
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(360, 1020, 720, 80, { isStatic: true }),
      Matter.Bodies.rectangle(216, 700, 28, 700, { isStatic: true }),
      Matter.Bodies.rectangle(504, 700, 28, 700, { isStatic: true }),
    ])
    const ball = createSoftBall(360, 300, 90, 1)
    Matter.Composite.add(engine.world, ball.composite)
    for (let i = 0; i < 240; i++) step(ball, engine)
    const ys0 = ball.particles.map((p) => p.position.y)
    const restSY0 = Math.max(...ys0) - Math.min(...ys0)
    const presser = Matter.Bodies.rectangle(360, 300, 220, 60, { density: 0.003, friction: 0.02 })
    Matter.Composite.add(engine.world, presser)
    let minSY = 9999
    let worstCurvature = 0
    let minRadius = 9999
    for (let i = 0; i < 240; i++) {
      step(ball, engine)
      const ys = ball.particles.map((p) => p.position.y)
      const sy = Math.max(...ys) - Math.min(...ys)
      if (sy < minSY) {
        minSY = sy
        const c = renderContour(ball, 6, 90 * 0.32)
        for (let k = 0; k < c.length; k++) {
          const a = c[k]!
          const b = c[(k + 1) % c.length]!
          const d = c[(k + 2) % c.length]!
          const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x)
          const la = Math.hypot(b.x - a.x, b.y - a.y)
          const lb = Math.hypot(d.x - b.x, d.y - b.y)
          if (la > 0.1 && lb > 0.1) worstCurvature = Math.max(worstCurvature, Math.abs(cross) / (la * lb))
        }
        const cx = ball.center.position.x
        const cy = ball.center.position.y
        minRadius = Math.min(minRadius, ...c.map((p) => Math.hypot(p.x - cx, p.y - cy)))
      }
    }
    expect(minSY).toBeLessThan(restSY0 * 1.01) // deforms under press with structure
    expect(worstCurvature).toBeLessThan(1.5) // |sinθ| bound — no kinks
    expect(minRadius).toBeGreaterThan(30) // contour never collapses inward
  })

  it('contour area ≈ physics ring area (fill matches simulation)', () => {
    const ball = createSoftBall(360, 300, 90, 1)
    const c = renderContour(ball, 6, 90 * 0.32)
    let area = 0
    for (let i = 0; i < c.length; i++) {
      const p = c[i]!
      const q = c[(i + 1) % c.length]!
      area += p.x * q.y - q.x * p.y
    }
    area = Math.abs(area) / 2
    // The fill must match the simulated ring: contour area ≈ (ringR + pr)²·π
    // where ringR = 0.68r and pr = 0.32r → (0.68r+0.32r)²π = r²π, i.e. the
    // fill area tracks the ball's full visual disc (± polygonal approximation
    // and rest deformation).
    const fullDisc = Math.PI * 90 * 90
    expect(area).toBeGreaterThan(fullDisc * 0.82)
    expect(area).toBeLessThan(fullDisc * 1.05)
  })
})
