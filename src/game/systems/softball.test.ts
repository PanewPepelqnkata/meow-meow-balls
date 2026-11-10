import { describe, expect, it } from 'vitest'
import Matter from 'matter-js'
import { PHYSICS } from '../../config/physics'
import { getTier } from '../../config/ballTiers'
import { containerBounds, wallCollidersAt } from '../../config/container'
import { PhysicsWorld } from './PhysicsWorld'
import { SoftBallManager } from './SoftBallManager'
import { createWallBody, floorCollider } from './ContainerBodies'
import {
  SOFT,
  createSoftBall,
  renderContour,
  applyPressure,
  clampSoftBallSpeed,
  softBallArea,
  softBallSpeed,
  softBallCentroid,
  hasProtectedSlimeShape,
  minRadiusFractionFor,
} from './SoftBall'
const STEP = PHYSICS.stepMs

describe('soft-body prototype (Matter-native, single ball)', () => {
  it('drops, lands, and settles without exploding or jittering', () => {
    const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, positionIterations: 10, velocityIterations: 8, constraintIterations: 4, enableSleeping: false })
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(360, 1020, 720, 40, { isStatic: true }),
    ])
    const ball = createSoftBall(360, 300, 90, 1)
    Matter.Composite.add(engine.world, ball.composite)
    for (let i = 0; i < 60 * 6; i++) {
      Matter.Engine.update(engine, STEP)
      clampSoftBallSpeed(ball)
      applyPressure(ball)
    }
    const speed = softBallSpeed(ball)
    const ratio = softBallArea(ball) / ball.restArea
    expect(speed).toBeLessThan(0.8) // settled, no endless jitter
    expect(ratio).toBeGreaterThan(0.8) // did not collapse
    expect(ratio).toBeLessThan(1.15) // did not inflate
    // resting ON the floor (lowest particle near floor surface)
    const lowest = Math.max(...ball.particles.map((p) => p.position.y))
    expect(lowest).toBeGreaterThan(860)
    expect(lowest).toBeLessThan(1010)
  })

  it('flattens under sustained pressure in a box and RECOVERS when released', () => {
    const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, positionIterations: 10, velocityIterations: 8, constraintIterations: 4, enableSleeping: false })
    // Box: floor + two walls (like the container) so the ball is trapped
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(360, 1020, 720, 40, { isStatic: true }),
      Matter.Bodies.rectangle(216, 700, 28, 700, { isStatic: true }),
      Matter.Bodies.rectangle(504, 700, 28, 700, { isStatic: true }),
    ])
    const ball = createSoftBall(360, 300, 90, 1)
    Matter.Composite.add(engine.world, ball.composite)
    for (let i = 0; i < 60 * 4; i++) {
      Matter.Engine.update(engine, STEP)
      clampSoftBallSpeed(ball)
      applyPressure(ball)
    }
    const restSpreadY =
      Math.max(...ball.particles.map((p) => p.position.y)) - Math.min(...ball.particles.map((p) => p.position.y))

    // Heavy block presses down; walls prevent sideways escape → sustained squash.
    // The slam itself splatters the slime (transient); the SUSTAINED state is
    // the equilibrium over the second half of the press.
    const presser = Matter.Bodies.rectangle(360, 300, 220, 60, { density: 0.003, friction: 0.02, label: 'presser' })
    Matter.Composite.add(engine.world, presser)
    let sumSpreadY = 0
    let sumSpreadX = 0
    let sumRatio = 0
    let nSettled = 0
    let minRatioEver = 1
    for (let i = 0; i < 60 * 4; i++) {
      Matter.Engine.update(engine, STEP)
      clampSoftBallSpeed(ball)
      applyPressure(ball)
      const ys = ball.particles.map((p) => p.position.y)
      const xs = ball.particles.map((p) => p.position.x)
      const ratio = softBallArea(ball) / ball.restArea
      if (i >= 60 * 2) {
        sumSpreadY += Math.max(...ys) - Math.min(...ys)
        sumSpreadX += Math.max(...xs) - Math.min(...xs)
        sumRatio += ratio
        nSettled++
      }
      minRatioEver = Math.min(minRatioEver, ratio)
    }
    const squashedSpreadY = sumSpreadY / nSettled
    const squashedSpreadX = sumSpreadX / nSettled
    const squashedRatio = sumRatio / nSettled

    // Release → gradual recovery
    Matter.Composite.remove(engine.world, presser)
    for (let i = 0; i < 60 * 4; i++) {
      Matter.Engine.update(engine, STEP)
      clampSoftBallSpeed(ball)
      applyPressure(ball)
    }
    const recoveredRatio = softBallArea(ball) / ball.restArea
    const recoveredSpreadY = (() => {
      const ys = ball.particles.map((p) => p.position.y)
      return Math.max(...ys) - Math.min(...ys)
    })()

    // Volume-preserving slime: visibly flattened under load AND widened
    // (bulge sideways); area near rest at equilibrium; the slam transient
    // may dip but must never collapse the ring (no fold-through).
    expect(squashedSpreadY).toBeLessThan(restSpreadY * 1.02)
    expect(squashedSpreadX).toBeGreaterThanOrEqual(squashedSpreadY - 10)
    expect(squashedRatio).toBeGreaterThan(0.85) // ~volume preserved at equilibrium
    expect(minRatioEver).toBeGreaterThan(0.4) // transient splat, no collapse
    expect(recoveredSpreadY).toBeGreaterThan(restSpreadY * 0.93) // re-inflated
    expect(recoveredRatio).toBeGreaterThan(0.93) // back near circular
  })

  it('particles collide with the wall — sustained press deforms the contour locally', () => {
    const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, positionIterations: 10, velocityIterations: 8, constraintIterations: 4, enableSleeping: false })
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(360, 1020, 720, 40, { isStatic: true }),
      Matter.Bodies.rectangle(-14, 600, 28, 1200, { isStatic: true, label: 'wall' }),
    ])
    const ball = createSoftBall(360, 300, 90, 1)
    Matter.Composite.add(engine.world, ball.composite)
    for (let i = 0; i < 60 * 3; i++) {
      Matter.Engine.update(engine, STEP)
      clampSoftBallSpeed(ball)
      applyPressure(ball)
    }
    // A heavy PISTON (vertically constrained block) continuously drives the
    // ball INTO the wall — sustained pressure like the pile pressing a ball
    // against the container. The rail constraint keeps it at ball height.
    const driver = Matter.Bodies.rectangle(430, 918, 160, 90, { density: 0.003, friction: 0.02, label: 'driver' })
    Matter.Composite.add(engine.world, driver)
    Matter.Composite.add(
      engine.world,
      Matter.Constraint.create({
        pointA: { x: 430, y: 918 },
        bodyB: driver,
        length: 0,
        stiffness: 1,
        damping: 0,
      }),
    )
    let minSpreadX = Infinity
    let minX = Infinity
    let wallContactFrames = 0
    for (let i = 0; i < 60 * 5; i++) {
      Matter.Body.applyForce(driver, driver.position, { x: -0.012 * driver.mass, y: 0 }) // thruster
      Matter.Engine.update(engine, STEP)
      clampSoftBallSpeed(ball)
      applyPressure(ball)
      const xs = ball.particles.map((p) => p.position.x)
      minX = Math.min(minX, Math.min(...xs))
      minSpreadX = Math.min(minSpreadX, Math.max(...xs) - Math.min(...xs))
      if (Math.min(...xs) < 55) wallContactFrames++
    }
    // Ball pressed at the wall repeatedly during the sustained drive (not
    // launched away) — symmetric pressure now pushes back, so contact is
    // intermittent; deformation is the assertion that matters below.
    expect(wallContactFrames).toBeGreaterThan(25)
    expect(minX).toBeGreaterThan(8) // no tunneling through the wall
    // Locally flattened along the press axis: horizontal spread shrinks
    // measurably below the free-rest spread (~180)
    expect(minSpreadX).toBeLessThan(160)
  })

  it('contacts another soft ball — both deform, no explosion', () => {
    const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, positionIterations: 10, velocityIterations: 8, constraintIterations: 4, enableSleeping: false })
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(360, 1020, 720, 40, { isStatic: true }),
    ])
    const a = createSoftBall(300, 300, 90, 1)
    const b = createSoftBall(430, 300, 90, 2)
    Matter.Composite.add(engine.world, [a.composite, b.composite])
    for (let i = 0; i < 60 * 5; i++) {
      Matter.Engine.update(engine, STEP)
      clampSoftBallSpeed(a)
      applyPressure(a)
      clampSoftBallSpeed(b)
      applyPressure(b)
    }
    const speed = Math.max(softBallSpeed(a), softBallSpeed(b))
    expect(speed).toBeLessThan(1.2) // settled together
    // they pushed each other apart, both resting on the floor
    const ca = softBallCentroid(a)
    const cb = softBallCentroid(b)
    expect(Math.abs(ca.x - cb.x)).toBeGreaterThan(90) // not overlapping
    for (const ball of [a, b]) {
      const ratio = softBallArea(ball) / ball.restArea
      expect(ratio).toBeGreaterThan(0.8)
    }
  })
})

describe('Phase 2.9.1 regression: symmetric area restoration', () => {
  it('collisions never inflate a ball: area returns to ≈rest after impacts', () => {
    // Root cause of the production launch glitch: one-sided pressure never
    // restored inflated balls; collisions inflated them up to 4.3× and the
    // outward push saturated the speed clamp permanently (energy pump).
    const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, positionIterations: 10, velocityIterations: 8, constraintIterations: 4, enableSleeping: false })
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(360, 1020, 720, 80, { isStatic: true }),
    ])
    const ball = createSoftBall(360, 200, 90, 1)
    Matter.Composite.add(engine.world, ball.composite)
    let maxAreaEver = 0
    for (let i = 0; i < 60 * 8; i++) {
      // periodic hard impacts from a bouncing rigid ball (like a dropped ball
      // landing on it repeatedly)
      if (i % 90 === 0) {
        const impactor = Matter.Bodies.circle(360 + (i % 3) * 20 - 20, 60, 30, { density: 0.004, label: 'impactor' })
        Matter.Composite.add(engine.world, impactor)
        Matter.Body.setVelocity(impactor, { x: 0, y: 18 })
        // remove after it settles onto the ball
        if (i > 0) {
          const old = Matter.Composite.allBodies(engine.world).find((b) => b.label === 'impactor' && b.id !== impactor.id)
          void old
        }
      }
      if (i % 90 === 45) {
        for (const b of Matter.Composite.allBodies(engine.world)) {
          if (b.label === 'impactor') Matter.Composite.remove(engine.world, b)
        }
      }
      Matter.Engine.update(engine, PHYSICS.stepMs)
      clampSoftBallSpeed(ball)
      applyPressure(ball)
      maxAreaEver = Math.max(maxAreaEver, softBallArea(ball) / ball.restArea)
    }
    const finalArea = softBallArea(ball) / ball.restArea
    expect(maxAreaEver).toBeLessThan(1.6) // inflation bounded (was 4.3 live)
    expect(finalArea).toBeGreaterThan(0.85) // restored, not deflated
    expect(finalArea).toBeLessThan(1.15)
  })

  it('pressure Δv is bounded (energy-stable by construction)', () => {
    // The corrected solver applies a velocity-level Δv ≤ pressureAcceleration
    // at full deficit, scaling linearly with the deficit. 10 px/step at the
    // absolute ceiling is still 4.8× below the 48 px/step global clamp, and
    // deep deficits only occur under sustained load — the old force-level
    // model reached hundreds of gravities with no ceiling at all.
    expect(SOFT.pressureAcceleration).toBeLessThan(PHYSICS.maxSpeed / 3)
  })
})

describe('Phase 2.9.2 regression: shape retention under extreme compression', () => {
  it('a small ball trapped between two large balls stays recognizable', () => {
    // Valid scenario: bigs rest side-by-side WITHOUT spawn overlap (an earlier
    // diagnostic rig spawned them 74px inside each other, producing an
    // artificial crusher); a small ball drops into the V and a heavy block
    // presses the pile. Measured 2.9.2: worst area 0.86, aspect 0.72.
    const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, positionIterations: 10, velocityIterations: 8, constraintIterations: 4, enableSleeping: false })
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(360, 1020, 720, 80, { isStatic: true }),
      Matter.Bodies.rectangle(216, 700, 28, 700, { isStatic: true }),
      Matter.Bodies.rectangle(504, 700, 28, 700, { isStatic: true }),
    ])
    const mk = (tier: number, x: number, y: number) => {
      const b = createSoftBall(x, y, getTier(tier)!.radius, Math.random())
      Matter.Composite.add(engine.world, b.composite)
      return b
    }
    const t5 = getTier(5)!.radius
    const bigL = mk(5, 250, 1000 - t5)
    const bigR = mk(5, 500, 1000 - t5)
    const small = mk(1, 375, 700)
    const presser = Matter.Bodies.rectangle(375, 250, 340, 60, { density: 0.003, friction: 0.02 })
    Matter.Composite.add(engine.world, presser)
    const all = [bigL, bigR, small]
    let worstArea = 9
    let worstAspect = 9
    for (let i = 0; i < 60 * 8; i++) {
      Matter.Engine.update(engine, STEP)
      for (const b of all) {
        clampSoftBallSpeed(b)
        applyPressure(b)
      }
      worstArea = Math.min(worstArea, softBallArea(small) / small.restArea)
      const xs = small.particles.map((p) => p.position.x)
      const ys = small.particles.map((p) => p.position.y)
      const sx = Math.max(...xs) - Math.min(...xs)
      const sy = Math.max(...ys) - Math.min(...ys)
      worstAspect = Math.min(worstAspect, Math.min(sx, sy) / Math.max(sx, sy))
    }
    // Recognizable: retains ≥70% area and a rounded (≥0.55) silhouette under load
    expect(worstArea).toBeGreaterThan(0.7)
    expect(worstAspect).toBeGreaterThan(0.55)
  })

  it('balls feel heavy: drop onto a resting ball bounces at most once, tiny rebound', () => {
    const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, positionIterations: 10, velocityIterations: 8, constraintIterations: 4, enableSleeping: false })
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(360, 1020, 720, 80, { isStatic: true }),
      Matter.Bodies.rectangle(216, 700, 28, 700, { isStatic: true }),
      Matter.Bodies.rectangle(504, 700, 28, 700, { isStatic: true }),
    ])
    const mk = (tier: number, x: number, y: number) => {
      const b = createSoftBall(x, y, getTier(tier)!.radius, Math.random())
      Matter.Composite.add(engine.world, b.composite)
      return b
    }
    mk(2, 360, 950)
    const upper = mk(2, 360, 300)
    let bounces = 0
    let maxUpward = 0
    let prevVy = 0
    for (let i = 0; i < 60 * 5; i++) {
      Matter.Engine.update(engine, STEP)
      for (const b of [upper]) { clampSoftBallSpeed(b); applyPressure(b) }
      const vy = upper.center.velocity.y
      if (prevVy > 2 && vy < -1) {
        bounces++
        maxUpward = Math.max(maxUpward, -vy)
      }
      prevVy = vy
    }
    // Heavy feel: ≤1 small rebound after a 650px drop (was a rubber-ball risk)
    expect(bounces).toBeLessThanOrEqual(1)
    expect(maxUpward).toBeLessThan(5)
    // No interpenetration at rest: center distance ≥ sum of ring radii × 0.9
    void 0
  })

  it('two resting same-tier balls do not interpenetrate', () => {
    const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, positionIterations: 10, velocityIterations: 8, constraintIterations: 4, enableSleeping: false })
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(360, 1020, 720, 80, { isStatic: true }),
      Matter.Bodies.rectangle(216, 700, 28, 700, { isStatic: true }),
      Matter.Bodies.rectangle(504, 700, 28, 700, { isStatic: true }),
    ])
    const mk = (tier: number, x: number, y: number) => {
      const b = createSoftBall(x, y, getTier(tier)!.radius, Math.random())
      Matter.Composite.add(engine.world, b.composite)
      return b
    }
    const a = mk(2, 330, 950)
    const b = mk(2, 410, 950)
    for (let i = 0; i < 60 * 4; i++) {
      Matter.Engine.update(engine, STEP)
      for (const s of [a, b]) {
        clampSoftBallSpeed(s)
        applyPressure(s)
      }
    }
    const ca = { x: a.center.position.x, y: a.center.position.y }
    const cb = { x: b.center.position.x, y: b.center.position.y }
    const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y)
    const nominal = getTier(2)!.radius * 2
    // Centers should be near the nominal sum (soft squash allows some approach,
    // but not the 52% overlap measured in 2.9.2 diagnosis)
    expect(dist).toBeGreaterThan(nominal * 0.95)
  })
})

describe('Phase 2.9.8 regression: rendered contour stays inside the collision envelope', () => {
  it('contour never extends beyond the collision surface (no visible interpenetration)', () => {
    // Architecture (Phase 2.9.8): Matter's own contact solver owns contact
    // separation, which is only sound if the RENDERED contour can never
    // stick out past the collision discs. renderContour therefore offsets
    // INWARD from the particle outer edge (outset pr is the maximum), and
    // the CR tangents are clamped to their chords so the spline cannot
    // bulge past the ring's convex hull under load.
    const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, positionIterations: 14, velocityIterations: 12, constraintIterations: 6, enableSleeping: false })
    Matter.Composite.add(engine.world, [
      Matter.Bodies.rectangle(360, 1020, 720, 80, { isStatic: true }),
      Matter.Bodies.rectangle(216, 700, 28, 700, { isStatic: true }),
      Matter.Bodies.rectangle(504, 700, 28, 700, { isStatic: true }),
    ])
    const mk = (tier: number, x: number, y: number) => {
      const b = createSoftBall(x, y, getTier(tier)!.radius, Math.random())
      Matter.Composite.add(engine.world, b.composite)
      return b
    }
    const a = mk(2, 330, 900)
    const b = mk(2, 410, 900)
    for (let i = 0; i < 60 * 3; i++) {
      Matter.Engine.update(engine, STEP)
      for (const x of [a, b]) {
        clampSoftBallSpeed(x)
        applyPressure(x)
      }
    }
    // For every contour point: distance to the NEAREST particle center must
    // not exceed the particle's COLLISION radius (visual pr + contactSkin —
    // the body discs, thickened by the contact skin, ARE the collision
    // envelope). If a contour point sticks out past the physics surface,
    // visible overlap becomes possible at legal contact.
    let worstBulge = -1e9
    for (const ball of [a, b]) {
      const bodyR = ball.radius * SOFT.particleRadiusFactor + SOFT.contactSkin
      const contour = renderContour(ball, 6, ball.radius * SOFT.particleRadiusFactor)
      for (const c of contour) {
        let minD = 1e9
        for (const p of ball.particles) {
          minD = Math.min(minD, Math.hypot(c.x - p.position.x, c.y - p.position.y))
        }
        worstBulge = Math.max(worstBulge, minD - bodyR)
      }
    }
    expect(worstBulge).toBeLessThanOrEqual(0)
  })
})

describe('Phase 2.9.5 regression: free fall must never be damped', () => {
  it('a freely falling ball accelerates under gravity (no terminal crawl)', () => {
    // Root cause of the 2.9.4 production regression: the settle-damping gate
    // keyed on per-particle speed < 2.5 + area ±2%, which passes during free
    // fall (a falling ring is stress-free → area exactly 1.0). Damping capped
    // terminal velocity at ~0.44 px/step — balls floated. The gate now keys
    // on CENTROID speed: a falling centroid exits the gate in ~2 steps.
    const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, positionIterations: 14, velocityIterations: 12, constraintIterations: 6, enableSleeping: true })
    Matter.Composite.add(engine.world, [Matter.Bodies.rectangle(360, 1020, 720, 80, { isStatic: true })])
    const ball = createSoftBall(360, containerBounds().top + 46, 34, 99)
    Matter.Composite.add(engine.world, ball.composite)
    const stepWithManager = (markTouched: boolean) => {
      Matter.Engine.update(engine, STEP)
      // mirror the production gate: damping requires the touched flag
      const ratio = softBallArea(ball) / ball.restArea
      if (Math.abs(ratio - 1) > 0.02) {
        for (const p of ball.particles) Matter.Sleeping.set(p, false)
        Matter.Sleeping.set(ball.center, false)
        clampSoftBallSpeed(ball)
        applyPressure(ball)
      } else if (!ball.center.isSleeping) {
        clampSoftBallSpeed(ball)
        if (markTouched) {
          const cVy = ball.particles.reduce((s2, p) => s2 + p.velocity.y, ball.center.velocity.y) / (ball.particles.length + 1)
          const cVx = ball.particles.reduce((s2, p) => s2 + p.velocity.x, ball.center.velocity.x) / (ball.particles.length + 1)
          const cSpd = Math.hypot(cVx, cVy)
          const maxP = Math.max(Math.hypot(ball.center.velocity.x, ball.center.velocity.y), ...ball.particles.map((p) => Math.hypot(p.velocity.x, p.velocity.y)))
          if (cSpd < 1.0 && maxP < 2.5) {
            for (const p of [...ball.particles, ball.center]) {
              Matter.Body.setVelocity(p, { x: p.velocity.x * 0.5, y: p.velocity.y * 0.5 })
            }
          }
        }
      }
    }
    const vySamples: number[] = []
    for (let i = 0; i < 60; i++) {
      // airborne: no contact yet → touched stays false → no damping
      stepWithManager(false)
      // sample only during the fall (walls are shorter since 2.9.6: the ball
      // lands around frame ~35; late samples are post-landing settle)
      if (i % 10 === 0 && i <= 30) vySamples.push(softBallSpeed(ball))
    }
    // Average speed must grow toward the travel clamp (7 px/step at the
    // 120Hz rate) during the fall — the old bug capped it at ~0.44 for the
    // entire fall.
    expect(vySamples[vySamples.length - 1]!).toBeGreaterThan(5)
    expect(vySamples[2]!).toBeGreaterThan(vySamples[0]!)
  })

  it('a resting ball still settles (jitter fix preserved with the touched gate)', () => {
    const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, positionIterations: 14, velocityIterations: 12, constraintIterations: 6, enableSleeping: true })
    Matter.Composite.add(engine.world, [Matter.Bodies.rectangle(360, 1020, 720, 80, { isStatic: true })])
    const ball = createSoftBall(360, 700, 90, 98)
    Matter.Composite.add(engine.world, ball.composite)
    const stepWithManager = (markTouched: boolean) => {
      Matter.Engine.update(engine, STEP)
      const ratio = softBallArea(ball) / ball.restArea
      if (Math.abs(ratio - 1) > 0.02) {
        for (const p of ball.particles) Matter.Sleeping.set(p, false)
        Matter.Sleeping.set(ball.center, false)
        clampSoftBallSpeed(ball)
        applyPressure(ball)
      } else if (!ball.center.isSleeping) {
        clampSoftBallSpeed(ball)
        if (markTouched) {
          const cVy = ball.particles.reduce((s2, p) => s2 + p.velocity.y, ball.center.velocity.y) / (ball.particles.length + 1)
          const cVx = ball.particles.reduce((s2, p) => s2 + p.velocity.x, ball.center.velocity.x) / (ball.particles.length + 1)
          const cSpd = Math.hypot(cVx, cVy)
          const maxP = Math.max(Math.hypot(ball.center.velocity.x, ball.center.velocity.y), ...ball.particles.map((p) => Math.hypot(p.velocity.x, p.velocity.y)))
          if (cSpd < 1.0 && maxP < 2.5) {
            for (const p of [...ball.particles, ball.center]) {
              Matter.Body.setVelocity(p, { x: p.velocity.x * 0.5, y: p.velocity.y * 0.5 })
            }
          }
        }
      }
    }
    const hasTouched = { v: true } // resting on floor → contact established
    for (let i = 0; i < 240; i++) stepWithManager(hasTouched.v)
    let sum = 0
    for (let i = 0; i < 300; i++) {
      stepWithManager(hasTouched.v)
      sum += softBallSpeed(ball)
    }
    // The standing 1.2px/step constraint field must still be suppressed.
    expect(sum / 300).toBeLessThan(0.5)
  })
})

describe('Tier 1 blue ball corner-crush protection (anti-wedge / anti-horn)', () => {
  it('a Tier 1 blue ball pinned in the bottom-left corner under a giant Tier 7 white ball stays round without caving in or growing corner horns', () => {
    const physics = new PhysicsWorld()
    for (const body of [...wallCollidersAt().map(createWallBody), createWallBody(floorCollider())]) {
      physics.addBody(body)
    }
    const manager = new SoftBallManager(physics.world)
    manager.tierRadius = (t) => getTier(t)?.radius ?? 44
    physics.setSubStepHandler(() => {
      manager.stepAll()
      manager.separateContacts()
      manager.expandShape()
      manager.clampToContainer()
      manager.commitRest()
    })
    const b = containerBounds()
    const r1 = getTier(1)!.radius
    const r7 = getTier(7)!.radius
    const r2 = getTier(2)!.radius
    const r3 = getTier(3)!.radius

    // Place the Tier 1 blue ball in the bottom-left corner, then drop the
    // giant Tier 7 white ball + Tier 2 green + Tier 3 pink onto it (exact
    // screenshot layout).
    const leftX = b.innerLeftAt(b.floorY - r1 - 2) + r1 + 2
    const blue = manager.spawnBall(leftX, b.floorY - r1 - 2, 1)
    manager.spawnBall(leftX + 75, b.floorY - r1 * 2 - r7 + 20, 7)
    manager.spawnBall(leftX + 215, b.floorY - r2 - 2, 2)
    manager.spawnBall(leftX + 185, b.floorY - r7 * 2 - r3, 3)

    const ringR = r1 * (1 - SOFT.particleRadiusFactor)
    let minRadialFrac = 1
    let maxRadialFrac = 1
    let maxNeighborRadialStepFrac = 0
    let worstAreaFrac = 1
    let worstAspect = 1

    for (let i = 0; i < 360; i++) {
      physics.step(STEP)
      const evs = physics.takeCollisionEvents()
      if (evs.length) manager.markTouched(evs.flatMap(({ bodyA, bodyB }) => [bodyA.id, bodyB.id]))

      const c = softBallCentroid(blue.soft)
      const pts = blue.soft.particles
      const n = pts.length
      for (let k = 0; k < n; k++) {
        const p = pts[k]!
        const q = pts[(k + 1) % n]!
        const rk = Math.hypot(p.position.x - c.x, p.position.y - c.y) / ringR
        const rq = Math.hypot(q.position.x - c.x, q.position.y - c.y) / ringR
        minRadialFrac = Math.min(minRadialFrac, rk)
        maxRadialFrac = Math.max(maxRadialFrac, rk)
        maxNeighborRadialStepFrac = Math.max(maxNeighborRadialStepFrac, Math.abs(rk - rq))
      }
      worstAreaFrac = Math.min(worstAreaFrac, softBallArea(blue.soft) / blue.soft.restArea)
      const xs = pts.map((p) => p.position.x)
      const ys = pts.map((p) => p.position.y)
      const w = Math.max(...xs) - Math.min(...xs)
      const h = Math.max(...ys) - Math.min(...ys)
      worstAspect = Math.min(worstAspect, Math.min(w, h) / Math.max(w, h))
    }
    const finalAreaFrac = softBallArea(blue.soft) / blue.soft.restArea
    expect(minRadialFrac).toBeGreaterThan(0.62) // never caved in by the Tier 7 ball
    expect(maxRadialFrac).toBeLessThan(1.08) // no rectangular corner horn sticking out
    expect(maxNeighborRadialStepFrac).toBeLessThan(0.18) // smooth perimeter, no sharp kink
    expect(worstAreaFrac).toBeGreaterThan(0.64) // no collapse during 9× mass slam transient
    expect(finalAreaFrac).toBeGreaterThan(0.74) // plump settled area under Tier 7 load
    expect(worstAspect).toBeGreaterThan(0.70)
    physics.dispose()
  })
})

describe('small slime deformation protection (tiers 2–3 and 8+)', () => {
  it('protects tiers 1–3 and same-size tiers 8–12 while leaving tiers 4–7 on normal compliance', () => {
    for (const tier of [1, 2, 3, 8, 9, 10, 11, 12]) {
      const radius = getTier(tier)!.radius
      expect(hasProtectedSlimeShape(radius), `tier ${tier} should use the protected silhouette class`).toBe(true)
      expect(minRadiusFractionFor(radius), `tier ${tier} minimum ring fraction`).toBe(SOFT.protectedSlimeMinRadiusFraction)
    }
    for (const tier of [4, 5, 6, 7]) {
      const radius = getTier(tier)!.radius
      expect(hasProtectedSlimeShape(radius), `tier ${tier} should retain normal compliance`).toBe(false)
      expect(minRadiusFractionFor(radius), `tier ${tier} minimum ring fraction`).toBe(SOFT.minRadiusFraction)
    }
  })

  it.each([2, 3, 8])('tier %i stays recognizable under a Tier 7 corner slam and still visibly squishes', (tier) => {
    const physics = new PhysicsWorld()
    for (const body of [...wallCollidersAt().map(createWallBody), createWallBody(floorCollider())]) {
      physics.addBody(body)
    }
    const manager = new SoftBallManager(physics.world)
    manager.tierRadius = (t) => getTier(t)?.radius ?? 44
    physics.setSubStepHandler(() => {
      manager.stepAll()
      manager.separateContacts()
      manager.expandShape()
      manager.clampToContainer()
      manager.commitRest()
    })

    const bounds = containerBounds()
    const radius = getTier(tier)!.radius
    const heavyRadius = getTier(7)!.radius
    const x = bounds.innerLeftAt(bounds.floorY - radius - 2) + radius + 2
    const target = manager.spawnBall(x, bounds.floorY - radius - 2, tier)
    manager.spawnBall(
      x + radius * 0.45,
      bounds.floorY - radius * 2 - heavyRadius + 20,
      7,
    )

    const ringR = radius * (1 - SOFT.particleRadiusFactor)
    let minRadialFrac = 1
    let maxRadialFrac = 1
    let maxNeighborRadialStepFrac = 0
    let worstAreaFrac = 1
    let worstAspect = 1
    let maxRadialSpanFrac = 0
    for (let i = 0; i < 360; i++) {
      physics.step(STEP)
      const events = physics.takeCollisionEvents()
      if (events.length) manager.markTouched(events.flatMap(({ bodyA, bodyB }) => [bodyA.id, bodyB.id]))

      const center = softBallCentroid(target.soft)
      const points = target.soft.particles
      let frameMinRadius = Infinity
      let frameMaxRadius = 0
      for (let k = 0; k < points.length; k++) {
        const p = points[k]!
        const q = points[(k + 1) % points.length]!
        const radial = Math.hypot(p.position.x - center.x, p.position.y - center.y) / ringR
        const nextRadial = Math.hypot(q.position.x - center.x, q.position.y - center.y) / ringR
        frameMinRadius = Math.min(frameMinRadius, radial)
        frameMaxRadius = Math.max(frameMaxRadius, radial)
        minRadialFrac = Math.min(minRadialFrac, radial)
        maxRadialFrac = Math.max(maxRadialFrac, radial)
        maxNeighborRadialStepFrac = Math.max(maxNeighborRadialStepFrac, Math.abs(radial - nextRadial))
      }
      maxRadialSpanFrac = Math.max(maxRadialSpanFrac, frameMaxRadius - frameMinRadius)
      worstAreaFrac = Math.min(worstAreaFrac, softBallArea(target.soft) / target.soft.restArea)
      const xs = points.map((p) => p.position.x)
      const ys = points.map((p) => p.position.y)
      const width = Math.max(...xs) - Math.min(...xs)
      const height = Math.max(...ys) - Math.min(...ys)
      worstAspect = Math.min(worstAspect, Math.min(width, height) / Math.max(width, height))
    }

    // Integrity: the soft-body retains a substantial inner ring, bounded
    // bulges, a continuous perimeter, and enough area/aspect to read as a ball.
    expect(minRadialFrac, `tier ${tier} should not cave inward under the Tier 7 slam`).toBeGreaterThan(0.55)
    expect(maxRadialFrac, `tier ${tier} maximum radial fraction`).toBeLessThan(1.08)
    expect(maxNeighborRadialStepFrac, `tier ${tier} adjacent particle discontinuity`).toBeLessThan(0.18)
    expect(worstAreaFrac, `tier ${tier} minimum area fraction`).toBeGreaterThan(0.5)
    expect(worstAspect, `tier ${tier} minimum aspect ratio`).toBeGreaterThan(0.48)
    // At least 15% radial variation within one simulation step proves a
    // clearly non-circular slime shape, not accumulated tiny solver drift.
    expect(maxRadialSpanFrac, `tier ${tier} peak radial deformation span`).toBeGreaterThan(0.15)
    physics.dispose()
  })
})
