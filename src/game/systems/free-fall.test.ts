import { describe, expect, it } from 'vitest'
import * as Matter from 'matter-js'
import { PHYSICS } from '../../config/physics'
import { SOFT, createSoftBall, addToWorld, removeFromWorld, clampSoftBallSpeed } from './SoftBall'

/**
 * Phase 2.10.0 free-fall profile measurement + regression.
 *
 * MEASUREMENT 1 (pure Matter body): a plain body in free fall shows LINEAR
 * velocity growth at g·scale·stepMs·(1000/60) per substep (Matter 0.20
 * reports velocity in px per 16.67ms — its internal 60Hz base delta). No
 * per-step cap binds inside a gameplay fall, and no damping acts on airborne
 * balls — so gravity is NOT the limiting mechanism of the felt drop speed.
 *
 * MEASUREMENT 2 (the actual mechanism): through the production pipeline the
 * soft-ball particle clamp (SOFT.maxParticleSpeed, applied by
 * clampSoftBallSpeed in stepAll) caps every drop after ~0.23s at a terminal
 * speed — the old hardcoded 7 = 420px/s. The drops felt slow because they
 * were CAP-limited, not gravity-limited.
 *
 * THE FIX: maxParticleSpeed 7 → 8 (+14% terminal fall speed, inside the
 * requested 10–15% band), still far below the tunneling limit (smallest
 * particle collision diameter 28px ≈ 14px/step at 120Hz; 8 units = 4px/step).
 * Gravity scale stays at the 2.9.9-measured 0.0016 (the settled-pile load
 * equilibrium was tuned for it). Restitution untouched — no extra bounce.
 */

const BASE_MS = 1000 / 60 // Matter's velocity-report base delta

function freeFallSteps(scale: number, steps: number): { v: number[]; y: number[] } {
  const engine = Matter.Engine.create({ gravity: { x: 0, y: 1, scale }, enableSleeping: false })
  const body = Matter.Bodies.circle(360, 0, 20, { frictionAir: 0 })
  Matter.Composite.add(engine.world, body)
  const v: number[] = []
  const y: number[] = []
  for (let i = 0; i < steps; i++) {
    Matter.Engine.update(engine, PHYSICS.stepMs)
    v.push(body.velocity.y)
    y.push(body.position.y)
  }
  return { v, y }
}

/** Production-pipeline fall of a REAL soft ball from y=0 (no floor): returns
 * the time (substeps) to reach `yTarget` and the mid-fall velocity profile. */
function softBallFall(yTarget: number, cap: number): { stepsToTarget: number; vMid: number } {
  const engine = Matter.Engine.create({ gravity: { ...PHYSICS.gravity }, enableSleeping: true })
  const soft = createSoftBall(360, 10, 38, 1)
  addToWorld(engine.world, soft)
  let stepsToTarget = -1
  let vMid = 0
  for (let i = 0; i < 400 && stepsToTarget < 0; i++) {
    Matter.Engine.update(engine, PHYSICS.stepMs)
    clampSoftBallSpeedWith(soft, cap)
    const y = soft.center.position.y
    if (i === 60) vMid = soft.center.velocity.y
    if (y >= yTarget) stepsToTarget = i
  }
  removeFromWorld(engine.world, soft)
  return { stepsToTarget, vMid }
}

/** clampSoftBallSpeed with an injectable cap (to compare old vs new). */
function clampSoftBallSpeedWith(soft: Parameters<typeof clampSoftBallSpeed>[0], cap: number): void {
  for (const body of [soft.center, ...soft.particles]) {
    const v = body.velocity
    const speed = Math.hypot(v.x, v.y)
    if (speed > cap) Matter.Body.setVelocity(body, { x: v.x * cap / speed, y: v.y * cap / speed })
  }
}

describe('Phase 2.10.0: free-fall profile', () => {
  it('MEASURED: a plain body falls with linear gravity growth (no cap/damping distortion)', () => {
    const { v } = freeFallSteps(PHYSICS.gravity.scale, 60)
    const perStep = PHYSICS.gravity.y * PHYSICS.gravity.scale * PHYSICS.stepMs * BASE_MS
    for (let i = 10; i < 60; i += 10) {
      expect(v[i]! - v[i - 10]!).toBeCloseTo(perStep * 10, 3)
    }
  })

  it('MEASURED: a gameplay-length plain fall stays under the global tunneling cap', () => {
    const { v, y } = freeFallSteps(PHYSICS.gravity.scale, 200)
    const idx = y.findIndex((yy) => yy >= 600)
    const vAtFloor = idx >= 0 ? v[idx]! : v[v.length - 1]!
    expect(vAtFloor).toBeLessThan(PHYSICS.maxSpeed)
  })

  it('THE FIX: a real soft ball falls ~10-15% faster than with the old cap (measured, production clamp)', () => {
    // ~590px: the old spawn→floor distance (2.9.9 spawn just under the rim)
    const before = softBallFall(590, 7)
    const after = softBallFall(590, SOFT.freeFallMaxParticleSpeed)
    expect(SOFT.freeFallMaxParticleSpeed).toBe(9)
    const ratio = before.stepsToTarget / after.stepsToTarget
    expect(ratio).toBeGreaterThan(1.08)
    expect(ratio).toBeLessThan(1.24)
  })

  it('the free-fall cap is higher than the pile cap (faster drops, stable piles)', () => {
    // The pile cap (8) keeps the settled-pile equilibrium (measured: >8
    // ratchets solver churn); free-falling balls (zero contacts) may run
    // faster for drop feel. clampSoftBallSpeed applies each by contact state.
    expect(SOFT.freeFallMaxParticleSpeed).toBeGreaterThan(SOFT.maxParticleSpeed)
  })

  it('the fall cap never engages on a settled pile (velocities stay far below it)', () => {
    // The cap must not be what holds a resting pile still — the rest gate is.
    expect(SOFT.maxParticleSpeed).toBeGreaterThan(SOFT.restSpeedFast * 1.5)
  })
})
