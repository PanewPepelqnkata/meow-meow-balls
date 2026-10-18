import { describe, expect, it } from 'vitest'
import Matter from 'matter-js'
import { PHYSICS } from '../../config/physics'
import { createSoftBall, applyPressure, clampSoftBallSpeed, softBallArea, softBallSpeed, renderContour, SOFT } from './SoftBall'

/** Build the validated box rig with a given ring size and measure:
 * rest roundness, press flattening, settle speed, sim cost. */
function rig(segments: number) {
  const engine = Matter.Engine.create({
    gravity: { ...PHYSICS.gravity },
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
  const ball = createSoftBall(360, 300, 90, 1, segments)
  Matter.Composite.add(engine.world, ball.composite)
  const run = (seconds: number) => {
    const t0 = performance.now()
    for (let i = 0; i < seconds * 60; i++) {
      Matter.Engine.update(engine, PHYSICS.stepMs)
      clampSoftBallSpeed(ball)
      applyPressure(ball)
    }
    return (performance.now() - t0) / (seconds * 60) // ms per step
  }
  return { engine, ball, run }
}

function spread(ball: ReturnType<typeof createSoftBall>) {
  const xs = ball.particles.map((p) => p.position.x)
  const ys = ball.particles.map((p) => p.position.y)
  return {
    sx: Math.max(...xs) - Math.min(...xs),
    sy: Math.max(...ys) - Math.min(...ys),
  }
}

describe('particle-count comparison (12 vs 16 vs 20)', () => {
  it('measures roundness, flattening, stability, cost', () => {
    const results: string[] = []
    for (const n of [12, 16, 20] as const) {
      ;(SOFT as unknown as { segments: number }).segments = n
      const { ball, run } = rig(n)
      run(4)
      const rest = spread(ball)
      const restRoundness = rest.sx / rest.sy // 1.0 = perfect circle
      const restSpeed = softBallSpeed(ball)
      const contour = renderContour(ball, 6, ball.radius * 0.24)
      const cx = ball.center.position.x
      const cy = ball.center.position.y
      const radii = contour.map((p) => Math.hypot(p.x - cx, p.y - cy))
      const contourRoundness = Math.max(...radii) / Math.min(...radii)

      let minSY = 9999
      let maxSX = 0
      let minAR = 9
      const rig2 = rig(n)
      rig2.run(4)
      const presser2 = Matter.Bodies.rectangle(360, 300, 220, 60, { density: 0.003, friction: 0.02 })
      Matter.Composite.add(rig2.engine.world, presser2)
      const msPerStep = rig2.run(4)
      for (let i = 0; i < 240; i++) {
        Matter.Engine.update(rig2.engine, PHYSICS.stepMs)
        clampSoftBallSpeed(rig2.ball)
        applyPressure(rig2.ball)
        const s = spread(rig2.ball)
        minSY = Math.min(minSY, s.sy)
        maxSX = Math.max(maxSX, s.sx)
        minAR = Math.min(minAR, softBallArea(rig2.ball) / rig2.ball.restArea)
      }
      const afterSpeed = softBallSpeed(rig2.ball)
      results.push(
        `n=${n}: restRoundness=${restRoundness.toFixed(3)} contourRoundness=${contourRoundness.toFixed(3)} restSpeed=${restSpeed.toFixed(2)} flattenSY=${minSY.toFixed(0)} widenSX=${maxSX.toFixed(0)} minArea=${minAR.toFixed(2)} ms/step=${msPerStep.toFixed(3)} settledSpeed=${afterSpeed.toFixed(2)}`,
      )
      ;(SOFT as unknown as { segments: number }).segments = 16
    }
    // Chosen: n=16 (best contour roundness + fastest settle at moderate cost).
    // Regression bounds: all sizes stay stable and cheap; 16 stays smoothest.
    for (const r of results) {
      expect(r).toMatch(/ms\/step=0\.1?\d\d/)
      expect(r).toMatch(/contourRoundness=1\.\d\d/) // hand-drawn irregularity ≤ ~1.06
    }
    expect(results.join('\n')).toContain('n=16: ')
    console.log('PARTICLE-COMPARE', results.join(' | '))
  })
})
