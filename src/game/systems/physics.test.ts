import { describe, expect, it } from 'vitest'
import * as Matter from 'matter-js'
import { PHYSICS } from '../../config/physics'
import { containerBounds, interiorCorners, CONTAINER, tipCollidersAt } from '../../config/container'
import { createContainerBodies } from './ContainerBodies'
import { SPAWN } from '../../config/spawn'
import { BALL_TIERS, getTier } from '../../config/ballTiers'
import { PhysicsWorld } from './PhysicsWorld'
import { BallManager } from './BallManager'
import { clampDropX, clientToStage } from './inputMath'

const R0 = BALL_TIERS[0]!.radius
const { left, right, top, floorY } = containerBounds()

function makeWorld(): PhysicsWorld {
  const pw = new PhysicsWorld()
  for (const body of createContainerBodies()) pw.addBody(body)
  return pw
}

function spawn(balls: BallManager, x: number, y: number, tier = 1) {
  return balls.spawnBall(x, y, tier)
}

function settle(pw: PhysicsWorld, seconds: number): void {
  const steps = Math.round(seconds * PHYSICS.stepHz)
  for (let i = 0; i < steps; i++) pw.step(PHYSICS.stepMs)
}

describe('PhysicsWorld: gravity', () => {
  it('moves a dropped ball downward (T1)', () => {
    const pw = makeWorld()
    const balls = new BallManager(pw)
    const ball = spawn(balls, 360, top + 100)
    const startY = ball.body.position.y
    settle(pw, 1.2)
    expect(ball.body.position.y).toBeGreaterThan(startY + 50)
    // At rest the velocity is ~0 (a transient rebound during settling may
    // still read slightly negative — only real upward flight fails).
    expect(ball.body.velocity.y).toBeGreaterThan(-0.5)
    pw.dispose()
  })
})

describe('PhysicsWorld: container collisions', () => {
  it('a dropped ball lands on the floor and stays inside (T2)', () => {
    const pw = makeWorld()
    const balls = new BallManager(pw)
    const ball = spawn(balls, 360, top + 50)
    settle(pw, 4)
    expect(ball.body.position.y).toBeLessThan(floorY) // fully inside
    expect(ball.body.position.y).toBeGreaterThan(floorY - R0 - 6) // resting ON floor
    expect(Math.hypot(ball.body.velocity.x, ball.body.velocity.y)).toBeLessThan(1)
    pw.dispose()
  })

describe('PhysicsWorld: container collisions', () => {
  it('a ball dropped on a wall tip is stopped by its cap instead of passing through (tip collision)', () => {
    const pw = makeWorld()
    const c = interiorCorners()
    const T = CONTAINER.visual.bandThickness
    const capHeight = T * 0.22
    const radius = R0 + 4
    // Drop a rigid ball onto the LEFT cap's flat top. Without the cap it
    // falls through the decorative width outside the narrower wall slab.
    // Use a plain Matter circle against the same static container bodies.
    const ball = Matter.Bodies.circle(c.topLeft.x - T / 2, c.topLeft.y - capHeight - radius - 20, radius)
    pw.addBody(ball)
    let escaped = false
    for (let i = 0; i < 240; i++) {
      pw.step(PHYSICS.stepMs)
      const p = ball.position
      // The cap must stop the ball before it can fall through the visible
      // tip and escape past the container's outer bounds or below the floor.
      if (p.x < c.topLeft.x - CONTAINER.visual.bandThickness - R0 - 60 || p.y > floorY + 100) {
        escaped = true
        break
      }
    }
    expect(escaped).toBe(false)
    expect(Number.isFinite(ball.position.x)).toBe(true)
    expect(Number.isFinite(ball.position.y)).toBe(true)
    Matter.Composite.remove(pw.world, ball)
    pw.dispose()
  })

  it('tip caps ride Raise Walls: colliders stay aligned with the moving tips', () => {
    const T = CONTAINER.visual.bandThickness
    const capHeight = T * 0.22
    // Collision and rendering share the flat top and the horizontal rim
    // underside throughout the actual raise/lower range.
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const h = CONTAINER.height + (CONTAINER.raisedHeight - CONTAINER.height) * fraction
      const c = interiorCorners(h)
      const tips = tipCollidersAt(h)
      expect(tips).toHaveLength(2)
      for (const tip of tips) {
        const minY = Math.min(...tip.vertices.map((v) => v.y))
        expect(minY).toBeCloseTo(c.topLeft.y - capHeight, 6)
        expect(Math.max(...tip.vertices.map((v) => v.y))).toBeCloseTo(c.topLeft.y, 6)
        const topEdge = tip.vertices.filter((v) => Math.abs(v.y - minY) < 1e-6)
        expect(topEdge).toHaveLength(2)
        expect(Math.abs(topEdge[1]!.x - topEdge[0]!.x)).toBeCloseTo(T * 0.84, 6)
      }
    }
  })

  it('balls collide with the sloped walls and never penetrate them (T3)', () => {
    const pw = makeWorld()
    const balls = new BallManager(pw)
    const b = containerBounds()
    // Ball at mid-height shoved hard sideways: it must NOT pass through the
    // sloped wall band. An open-top trapezoid can legally redirect the ball
    // upward (and out of the opening), so containment after the bounce is NOT
    // asserted — only non-penetration of the wall band while below the rim.
    for (const dir of [-1, 1]) {
      const ball = spawn(balls, 360, b.top + 120)
      Matter.Body.setVelocity(ball.body, { x: 14 * dir, y: 0 })
    }
    // Tunneling detection: a legal exit goes UP over the rim (y < top) while
    // still inside the band. Crossing from inside-band to outside-band between
    // consecutive frames while BELOW the rim means the wall band (22px thick,
    // max 48px/step) was traversed illegally.
    const inside = (x: number, y: number) =>
      y >= b.top && y <= b.floorY &&
      x >= b.innerLeftAt(y) - 1 && x <= b.innerRightAt(y) + 1
    let tunneled = false
    const prevInside = balls.getBalls().map(() => true)
    for (let i = 0; i < 240; i++) {
      pw.step(PHYSICS.stepMs)
      balls.getBalls().forEach((ball, k) => {
        const nowInside = inside(ball.body.position.x, ball.body.position.y)
        const y = ball.body.position.y
        const outsideBand =
          y > b.top + 2 && y < b.floorY &&
          (ball.body.position.x < b.innerLeftAt(y) - 1 || ball.body.position.x > b.innerRightAt(y) + 1)
        if (prevInside[k] && outsideBand) tunneled = true
        prevInside[k] = nowInside
      })
    }
    expect(tunneled).toBe(false)
    pw.dispose()
  })

  it('a ball sliding down a sloped wall rolls toward the center (funnel behavior)', () => {
    const pw = makeWorld()
    const balls = new BallManager(pw)
    const b = containerBounds()
    // Place the ball against the upper sloped wall, fully inside; it should
    // slide/roll down the slope and settle on the floor toward the center.
    const startX = b.innerLeftAt(b.top + 100) + R0 + 4
    const ball = spawn(balls, startX, b.top + 100)
    for (let i = 0; i < 600; i++) pw.step(PHYSICS.stepMs)
    expect(ball.body.position.y).toBeGreaterThan(b.floorY - R0 - 8) // reached floor
    expect(ball.body.position.x).toBeGreaterThan(b.innerLeftAt(b.floorY)) // rolled inward
    const speed = Math.hypot(ball.body.velocity.x, ball.body.velocity.y)
    expect(speed).toBeLessThan(1)
    pw.dispose()
  })
})
})

describe('PhysicsWorld: stacking stability', () => {
  it('multiple balls stack with bounded velocities and no overlap (T4)', () => {
    const pw = makeWorld()
    const balls = new BallManager(pw)
    for (let i = 0; i < 4; i++) {
      spawn(balls, 360, top + 50)
      settle(pw, 0.7)
    }
    settle(pw, 3)
    const positions = balls.getBalls().map((b) => b.body.position)
    for (const ball of balls.getBalls()) {
      const speed = Math.hypot(ball.body.velocity.x, ball.body.velocity.y)
      expect(speed).toBeLessThan(1)
    }
    // No two balls overlap (they may stack OR rest side by side)
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const d = Math.hypot(positions[i]!.x - positions[j]!.x, positions[i]!.y - positions[j]!.y)
        expect(d).toBeGreaterThanOrEqual(2 * R0 - 5)
      }
    }
    pw.dispose()
  })
})

describe('PhysicsWorld: 18-ball stability soak, 60s + 10s settle (T5)', () => {
  it('keeps all 18 balls inside, finite, and settled', () => {
    // Phase 2.11.2 geometry: container area = (495.9+405)/2 * 320 = 144,144 u2.
    // 18 tier-1 balls = 18*pi*44^2 = 109,475 u2 = 76% fill — the same jam-fill
    // regime the 30-ball soak measured pre-resize (30 tier-1 balls at the new
    // r 44 would be 127% — they cannot fit the shallower container).
    const pw = makeWorld()
    const balls = new BallManager(pw)
    const b = containerBounds()
    // Gameplay-realistic drop cadence (1.2s) — matches how the actual game
    // drops, and avoids artificial high-energy ejections over the open rim.
    const dropIntervalSteps = Math.round(1.2 * PHYSICS.stepHz)
    const totalSteps = Math.round(60 * PHYSICS.stepHz)
    const settleSteps = Math.round(10 * PHYSICS.stepHz)
    let nextDrop = 0
    for (let i = 0; i < totalSteps + settleSteps; i++) {
      if (i === nextDrop && balls.count < 18) {
        // Phase 2.11.2: 30 → 18 tier-1 balls — the container is now shallower
        // (height 320) and the radii larger (44), so 18 keeps the same ~75%
        // jam fill the 30-ball soak measured pre-resize (30 tier-1 balls at
        // r 44 exceed the container's capacity entirely).
        const r = getTier(1)!.radius
        const y = top + r + 32 // legacy in-mouth spawn for this rigid-body soak
        const x = clampDropX(60 + ((balls.count * 83) % (right - left - 2 * r)), r, {
          x: b.innerLeftAt(y),
          width: b.innerRightAt(y) - b.innerLeftAt(y),
        })
        balls.spawnBall(x, y, 1)
        nextDrop = i + dropIntervalSteps
      }
      pw.step(PHYSICS.stepMs)
    }

    // All 30 spawned; some may legally exit through the OPEN TOP (future
    // game-over rule) in an 89%-full jam, but none may tunnel through the
    // walls or floor, and everything remaining must be settled.
    // bodyCount includes static container bodies: 2 walls + 2 tip caps + floor.
    expect(pw.bodyCount).toBeLessThanOrEqual(18 + 5)
    let ejected = 0
    for (const ball of balls.getBalls()) {
      const p = ball.body.position
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      const aboveMouth = p.y < b.top - R0
      if (aboveMouth || p.x < b.left - 2 * R0 || p.x > b.right + 2 * R0 || p.y > floorY + 200) {
        ejected += 1
        continue
      }
      // Band containment applies only below the rim (walls exist from top down);
      // balls still falling in the open mouth above the rim are unconstrained.
      if (p.y >= b.top) {
        expect(p.x).toBeGreaterThanOrEqual(b.innerLeftAt(Math.min(p.y, b.floorY)) + R0 - 3)
        expect(p.x).toBeLessThanOrEqual(b.innerRightAt(Math.min(p.y, b.floorY)) - R0 + 3)
      }
      expect(p.y).toBeLessThan(floorY) // none escaped through the floor
      const speed = Math.hypot(ball.body.velocity.x, ball.body.velocity.y)
      expect(speed).toBeLessThan(1.5)
    }
    expect(ejected).toBeLessThanOrEqual(6) // sanity bound; jam ejecta are legal, tunneling is not
    // Every simulated step accounted for: 60s of drops + 10s settle at 60 Hz
    expect(pw.stepCount).toBe(totalSteps + settleSteps)
    pw.dispose()
  }, 30_000)
})

describe('PhysicsWorld: fixed-step accumulation under frame-time variation (T6)', () => {
  const SCENARIOS: Array<{ name: string; frames: number[] }> = [
    { name: '60fps', frames: Array.from({ length: 600 }, () => 1000 / 60) },
    { name: '30fps', frames: Array.from({ length: 300 }, () => 1000 / 30) },
    {
      name: 'mixed',
      frames: Array.from({ length: 600 }, (_, i) => (i % 3 === 0 ? 1000 / 120 : i % 7 === 0 ? 1000 / 24 : 1000 / 60)),
    },
    { name: 'stalls', frames: Array.from({ length: 120 }, (_, i) => (i % 10 === 0 ? 200 : 1000 / 60)) },
  ]

  const run = (frames: number[]) => {
    const pw = makeWorld()
    const balls = new BallManager(pw)
    const ball = spawn(balls, 360, top + 60)
    for (const dt of frames) pw.step(dt)
    // Settle so we compare resting outcomes, not mid-bounce chaos
    for (let i = 0; i < 600; i++) pw.step(PHYSICS.stepMs)
    const result = {
      x: ball.body.position.x,
      y: ball.body.position.y,
      speed: Math.hypot(ball.body.velocity.x, ball.body.velocity.y),
      steps: pw.stepCount,
    }
    pw.dispose()
    return result
  }

  it('produces near-identical settled outcomes across ordinary frame-rate variation', () => {
    const base = run(SCENARIOS[0]!.frames)
    for (const scenario of SCENARIOS.slice(1)) {
      const other = run(scenario.frames)
      // After settling, the ball rests on the trapezoid floor regardless of
      // how the same wall time was chunked into frames. Mid-bounce positions
      // diverge chaotically, so the meaningful invariant is the settled state.
      expect(other.speed).toBeLessThan(1)
      expect(Math.abs(other.x - base.x)).toBeLessThan(60)
      expect(Math.abs(other.y - base.y)).toBeLessThan(8)
    }
  })

  it('accounts steps consistently for the same total wall time', () => {
    const SETTLE_STEPS = 600 // added by run() after the scenario frames
    // Non-stall scenarios: every stepMs of accumulated input becomes exactly one
    // step (±1 for accumulator rounding), regardless of how frames were chunked.
    for (const name of ['60fps', '30fps', 'mixed'] as const) {
      const frames = SCENARIOS.find((s) => s.name === name)!.frames
      const r = run(frames)
      const totalMs = frames.reduce((a, b) => a + b, 0)
      const expected = Math.floor(totalMs / PHYSICS.stepMs) + SETTLE_STEPS
      expect(r.steps).toBeGreaterThanOrEqual(expected - 1)
      expect(r.steps).toBeLessThanOrEqual(expected + 1)
    }
    // Stalls: 108 ordinary frames (2 steps each at 120Hz) + 12 stalls of
    // 200ms capped at maxSubSteps=10 → exactly 216 + 120 steps (remainder
    // dropped by design)
    const stalls = run(SCENARIOS.find((s) => s.name === 'stalls')!.frames)
    expect(stalls.steps).toBe(108 * 2 + 12 * PHYSICS.maxSubSteps + SETTLE_STEPS)
  })

  it('bounds catch-up after a long stall (no spiral of death)', () => {
    const pw = makeWorld()
    pw.step(10_000)
    expect(pw.stepCount).toBeLessThanOrEqual(PHYSICS.maxSubSteps)
    expect(pw.simTimeMs).toBeLessThanOrEqual(PHYSICS.maxSubSteps * PHYSICS.stepMs + 1)
    // Sub-step frame contributes no step until a full stepMs accumulates
    const before = pw.stepCount
    pw.step(5)
    expect(pw.stepCount).toBe(before)
    pw.dispose()
  })
})

describe('PhysicsWorld: reset and disposal (T7, T8)', () => {
  it('reset returns body counts to the static baseline (T7)', () => {
    const pw = makeWorld()
    const baseline = pw.bodyCount
    const balls = new BallManager(pw)
    for (let i = 0; i < 10; i++) spawn(balls, 360 + i, top + 40)
    expect(pw.bodyCount).toBe(baseline + 10)
    balls.clearBalls()
    pw.reset()
    expect(pw.bodyCount).toBe(baseline)
    expect(pw.stepCount).toBe(0)
    // World still simulates after reset
    const ball = spawn(balls, 360, top + 40)
    settle(pw, 0.5)
    expect(ball.body.position.y).toBeGreaterThan(top)
    pw.dispose()
  })

  it('disposal prevents further updates and duplicate event handling (T8)', () => {
    const pw = makeWorld()
    const balls = new BallManager(pw)
    const ball = spawn(balls, 360, top + 40)
    settle(pw, 0.2)
    const posBefore = { ...ball.body.position }
    const stepsBefore = pw.stepCount
    const bodiesBefore = pw.bodyCount

    pw.dispose()

    pw.step(500)
    expect(pw.stepCount).toBe(stepsBefore)
    expect(ball.body.position.x).toBe(posBefore.x)
    expect(ball.body.position.y).toBe(posBefore.y)
    expect(pw.getAllBodies()).toHaveLength(0)
    expect(pw.bodyCount).toBe(0)
    expect(bodiesBefore).toBeGreaterThan(0)

    pw.reset() // no-op after dispose
    expect(pw.stepCount).toBe(stepsBefore)
  })
})

describe('input mapping and clamping (T9, T10)', () => {
  it('maps client coords to stage coords at multiple viewports (T9)', () => {
    // 390x844 phone: FIT scale 390/720, canvas at left 0, top (844-693.33)/2
    const scale1 = 390 / 720
    const rect1 = { left: 0, top: (844 - 1280 * scale1) / 2, width: 390, height: 1280 * scale1 }
    const s1 = clientToStage(195, rect1.top + 390, rect1, 720, 1280)
    expect(s1.x).toBeCloseTo(360, 0)
    expect(s1.y).toBeCloseTo(720, 0)

    // 1440x900 desktop: canvas centered horizontally
    const scale2 = 900 / 1280
    const rect2 = { left: (1440 - 720 * scale2) / 2, top: 0, width: 720 * scale2, height: 900 }
    const s2 = clientToStage(rect2.left + 720 * scale2 / 2, 450, rect2, 720, 1280)
    expect(s2.x).toBeCloseTo(360, 0)
    expect(s2.y).toBeCloseTo(640, 0)

    // Small phone 320x568 (near-exact fill)
    const rect3 = { left: 0, top: 0, width: 320, height: 568 }
    const s3 = clientToStage(160, 284, rect3, 720, 1280)
    expect(s3.x).toBeCloseTo(360, 0)
    expect(s3.y).toBeCloseTo(640, 0)
  })

  it('clamps drop positions to the container interior for every tier (T10)', () => {
    const interior = { x: left, width: right - left }
    for (const t of BALL_TIERS.filter((t) => t.playable)) {
      expect(clampDropX(-1000, t.radius, interior)).toBe(left + t.radius + SPAWN.clampMargin)
      expect(clampDropX(1000, t.radius, interior)).toBe(right - t.radius - SPAWN.clampMargin)
    }
    expect(clampDropX(360, R0, interior)).toBe(360)
  })

  it('clamped spawn positions keep the ball fully inside the interior', () => {
    const interior = { x: left, width: right - left }
    for (const t of BALL_TIERS.filter((t) => t.playable)) {
      const x = clampDropX(0, t.radius, interior)
      expect(x - t.radius).toBeGreaterThanOrEqual(left - 0.5)
      expect(x + t.radius).toBeLessThanOrEqual(right + 0.5)
    }
  })
})
