import { describe, expect, it } from 'vitest'
import { BALL_EMOTION, emotionLevelFor } from '../../config/ballEmotion'
import { CONTAINER } from '../../config/container'
import { BallEmotionSystem } from './BallEmotion'
import type { SoftBallEntity } from './SoftBallManager'
import type { SoftBall } from './SoftBall'

/**
 * BALL EMOTION (danger/panic) tests.
 *
 * Semantics: a ball panics ONLY when its visual top is ABOVE the live
 * container rim (escape risk) — and only after the spawn grace period
 * (activationDelayMs) has elapsed. Ladder: normal → worried → scared →
 * panic with hysteresis on downgrades. The system is visual-only: it
 * never mutates physics state.
 *
 * Covers: per-ball independence, radius-awareness, the grace period,
 * entering/leaving the danger region, hysteresis, merges, Raise Walls
 * zone-riding, gradual easing, and the physics purity guarantee.
 */

/** The physics-shaped fields the emotion system actually reads. */
interface EmotionBody {
  position: { x: number; y: number }
  velocity: { x: number; y: number }
}

/**
 * Minimal read-only stand-in for a SoftBallEntity (position + radius).
 * The casts to Matter body/composite are the documented boundary: this
 * test exercises the pure emotion math, and the system only ever reads
 * `.position`/`.velocity`/`.radius` — the EmotionBody fields above, typed
 * and checked here.
 */
function fakeBall(id: number, x: number, y: number, radius: number): SoftBallEntity {
  const center: EmotionBody = { position: { x, y }, velocity: { x: 0, y: 0 } }
  const particles: EmotionBody[] = [
    { position: { x: x - radius * 0.5, y }, velocity: { x: 0, y: 0 } },
    { position: { x: x + radius * 0.5, y }, velocity: { x: 0, y: 0 } },
  ]
  return {
    id,
    tier: 1,
    seed: id * 7919,
    body: center as unknown as SoftBallEntity['body'],
    composite: {} as SoftBallEntity['composite'],
    soft: { center, particles, radius } as unknown as SoftBall,
    state: 'active',
    touched: true,
  }
}

/** Typed mutator for a fake ball's center velocity (test seam). */
function setVelocity(ball: SoftBallEntity, vx: number, vy: number): void {
  const body = ball.soft.center as unknown as EmotionBody
  body.velocity.x = vx
  body.velocity.y = vy
}

/** Rig with a frozen clock: `frames(n)` runs n update calls at 16ms each
 * (the easing advances one step per update — the real renderer cadence). */
function rig() {
  let t = 1_000_000
  const sys = new BallEmotionSystem()
  sys.setClock(() => t)
  const balls: SoftBallEntity[] = []
  return {
    sys,
    balls,
    /** Run n frames, each advancing the clock by `step` ms. */
    frames(n: number, step = 16): void {
      for (let i = 0; i < n; i++) {
        t += step
        sys.update(balls)
      }
    },
    /** Run n frames with a LARGE step (fast-forward through the grace). */
    fastForward(n: number, step: number): void {
      for (let i = 0; i < n; i++) {
        t += step
        sys.update(balls)
      }
    },
    time: () => t,
  }
}

const TOP = CONTAINER.topY
const SPAN = BALL_EMOTION.aboveRimPx

/**
 * y for a ball whose VISUAL TOP sits `measure`·SPAN above the rim
 * (inverse of the system's measure formula: measure = (rim − top)/span,
 * top = y − r − margin).
 */
function yAboveRim(measure: number, r: number): number {
  return TOP + r + BALL_EMOTION.clearMargin - SPAN * measure
}

describe('ball emotion: per-ball independence', () => {
  it('a ball above the rim panics while a ball below stays normal', () => {
    const { sys, balls, fastForward } = rig()
    balls.push(fakeBall(1, 360, TOP + 300, 40)) // deep inside the container
    balls.push(fakeBall(2, 360, yAboveRim(0.9, 40), 40)) // well above the rim
    sys.wallTopY = TOP
    fastForward(60, 50) // past the grace period + converge
    expect(sys.levelOf(1)).toBe('normal')
    expect(sys.levelOf(2)).toBe('panic')
    expect(sys.panicOf(2)).toBeGreaterThan(0.7)
    expect(sys.panicOf(1)).toBe(0)
  })

  it('panic measure is radius-aware: a bigger ball crosses the rim at the same visual moment', () => {
    const { sys } = rig()
    sys.wallTopY = TOP
    // Same CENTER: the bigger ball's top is higher → higher measure.
    const small = fakeBall(1, 360, TOP + 20, 30)
    const big = fakeBall(2, 360, TOP + 20, 60)
    expect(sys.measureFor(big, TOP)).toBeGreaterThan(sys.measureFor(small, TOP))
    expect(sys.measureFor(small, TOP)).toBeGreaterThanOrEqual(0)
    expect(sys.measureFor(big, TOP)).toBeLessThanOrEqual(1)
  })

  it('every ball tracks its own state key — no cross-contamination', () => {
    const { sys, balls, fastForward } = rig()
    balls.push(fakeBall(11, 360, yAboveRim(0.9, 40), 40))
    balls.push(fakeBall(12, 360, TOP + 200, 40))
    sys.wallTopY = TOP
    fastForward(60, 50)
    expect(sys.levelOf(11)).toBe('panic')
    expect(sys.levelOf(12)).toBe('normal')
  })
})

describe('ball emotion: spawn grace period', () => {
  it('a newly spawned ball above the rim does NOT panic until the delay elapses', () => {
    const { sys, balls, frames } = rig()
    sys.wallTopY = TOP
    balls.push(fakeBall(1, 360, yAboveRim(0.9, 40), 40)) // visually above the rim
    // Within the grace period: normal face regardless of position.
    frames(40) // 640ms < 1500ms
    expect(sys.levelOf(1)).toBe('normal')
    expect(sys.panicOf(1)).toBe(0)
  })

  it('after the grace period the ball starts panicking if still above the rim', () => {
    const { sys, balls, fastForward } = rig()
    sys.wallTopY = TOP
    balls.push(fakeBall(1, 360, yAboveRim(0.9, 40), 40))
    // Cross the 1500ms boundary in small steps and check the switchover.
    fastForward(85, 16) // 1360ms — still gated
    expect(sys.panicOf(1)).toBe(0)
    fastForward(20, 16) // now past 1500ms total
    expect(sys.panicOf(1)).toBeGreaterThan(0)
    fastForward(50, 40) // converge
    expect(sys.levelOf(1)).toBe('panic')
  })

  it('a ball that falls back inside the container during the grace period stays normal forever', () => {
    const { sys, balls, fastForward } = rig()
    sys.wallTopY = TOP
    const ball = fakeBall(1, 360, yAboveRim(0.9, 40), 40)
    balls.push(ball)
    // It falls below the rim while still in the grace period.
    fastForward(30, 50)
    ball.soft.center.position.y = TOP + 200
    fastForward(60, 50) // grace long over
    expect(sys.levelOf(1)).toBe('normal')
    expect(sys.panicOf(1)).toBe(0)
  })
})

describe('ball emotion: entering/leaving the danger region', () => {
  it('a ball pushed above the rim climbs normal → worried → scared → panic', () => {
    const { sys, balls, fastForward } = rig()
    sys.wallTopY = TOP
    const r = 40
    const ball = fakeBall(1, 360, TOP + 100, r) // below the rim: safe
    balls.push(ball)
    fastForward(60, 50)
    expect(sys.levelOf(1)).toBe('normal')
    const mid = (a: number, b: number): number => (a + b) / 2
    // worried: measure 0.33
    ball.soft.center.position.y = yAboveRim(mid(BALL_EMOTION.worriedAt, BALL_EMOTION.scaredAt), r)
    fastForward(25, 40)
    expect(sys.levelOf(1)).toBe('worried')
    // scared: measure 0.64
    ball.soft.center.position.y = yAboveRim(mid(BALL_EMOTION.scaredAt, BALL_EMOTION.panicAt), r)
    fastForward(25, 40)
    expect(sys.levelOf(1)).toBe('scared')
    // panic: measure 0.92
    ball.soft.center.position.y = yAboveRim(0.92, r)
    fastForward(25, 40)
    expect(sys.levelOf(1)).toBe('panic')
  })

  it('hysteresis: the level does not flicker when the measure dips just below a threshold', () => {
    const { sys, balls, fastForward } = rig()
    sys.wallTopY = TOP
    const r = 40
    const ball = fakeBall(1, 360, yAboveRim(0.95, r), r)
    balls.push(ball)
    fastForward(60, 50)
    expect(sys.levelOf(1)).toBe('panic')
    const band = BALL_EMOTION.hysteresis / BALL_EMOTION.aboveRimPx
    // Dip to just below the panic entry but above (panic − band): STAYS panic.
    ball.soft.center.position.y = yAboveRim(BALL_EMOTION.panicAt - band * 0.5, r)
    fastForward(15, 40)
    expect(sys.levelOf(1)).toBe('panic')
    // Fall below the SCARED threshold but stay above (scared − band) —
    // the hysteresis guard must hold the level at exactly scared.
    ball.soft.center.position.y = yAboveRim((BALL_EMOTION.scaredAt - band + BALL_EMOTION.scaredAt) / 2, r)
    fastForward(15, 40)
    expect(sys.levelOf(1)).toBe('scared')
  })

  it('a ball that falls back inside the container returns to normal', () => {
    const { sys, balls, fastForward } = rig()
    sys.wallTopY = TOP
    const ball = fakeBall(1, 360, yAboveRim(0.9, 40), 40)
    balls.push(ball)
    fastForward(60, 50)
    expect(sys.levelOf(1)).toBe('panic')
    ball.soft.center.position.y = TOP + 200
    fastForward(60, 50)
    expect(sys.levelOf(1)).toBe('normal')
    expect(sys.panicOf(1)).toBeLessThan(0.02)
  })
})

describe('ball emotion: eased transition', () => {
  it('panic rises gradually, not instantaneously', () => {
    const { sys, balls, fastForward } = rig()
    sys.wallTopY = TOP
    const ball = fakeBall(1, 360, yAboveRim(0.9, 40), 40)
    balls.push(ball)
    // Skip the grace period first, then observe the eased rise.
    fastForward(40, 50)
    const first = sys.panicOf(1)
    fastForward(1, 16)
    const second = sys.panicOf(1)
    expect(second).toBeGreaterThan(first)
    expect(second).toBeLessThanOrEqual(1) // near-converged at most
    // At measure 0.9 the eased value converges toward 0.9, never beyond.
    fastForward(60, 40)
    expect(sys.panicOf(1)).toBeGreaterThan(0.8)
    expect(sys.panicOf(1)).toBeLessThanOrEqual(0.9001)
  })
})

describe('ball emotion: merges and Raise Walls', () => {
  it('merged-source ids drop their state; the replacement starts its own grace period', () => {
    const { sys, balls, fastForward } = rig()
    sys.wallTopY = TOP
    balls.push(fakeBall(1, 360, yAboveRim(0.9, 40), 40))
    fastForward(60, 50)
    expect(sys.levelOf(1)).toBe('panic')
    // Merge: source id 1 disappears, replacement id 2 spawns (fresh clock).
    balls.length = 0
    balls.push(fakeBall(2, 360, yAboveRim(0.5, 55), 55))
    fastForward(10, 40) // replacement still in ITS grace period
    expect(sys.stateOf(1)).toBeUndefined()
    expect(sys.levelOf(2)).toBe('normal')
    fastForward(60, 50) // its grace elapses
    expect(sys.levelOf(2)).not.toBe('normal')
  })

  it('Raise Walls moves the rim: a panicking ball calms when the rim rises above it', () => {
    const { sys, balls, fastForward } = rig()
    sys.wallTopY = TOP
    const ball = fakeBall(1, 360, yAboveRim(0.9, 40), 40)
    balls.push(ball)
    fastForward(60, 50)
    expect(sys.levelOf(1)).toBe('panic')
    // Raise Walls moves the rim UP past the ball — it is now safely inside
    // the container and must calm down.
    sys.wallTopY = TOP - (CONTAINER.raisedHeight - CONTAINER.height)
    fastForward(60, 50)
    expect(sys.levelOf(1)).toBe('normal')
    // Walls lower back → the ball is above the rim again → panic returns.
    sys.wallTopY = TOP
    fastForward(60, 50)
    expect(sys.levelOf(1)).toBe('panic')
  })
})

describe('ball emotion: physics purity', () => {
  it('update() never mutates position or velocity of any ball body', () => {
    const { sys, balls, fastForward } = rig()
    sys.wallTopY = TOP
    balls.push(
      fakeBall(1, 360, yAboveRim(0.9, 40), 40),
      fakeBall(2, 300, TOP + 120, 44),
      fakeBall(3, 420, TOP + 300, 55),
    )
    // Give them non-zero velocities to prove nothing is zeroed/changed.
    for (const b of balls) setVelocity(b, 3.3, -7.7)
    const snapshot = balls.map((b) => ({
      center: { ...b.soft.center.position, vx: b.soft.center.velocity.x, vy: b.soft.center.velocity.y },
      particles: b.soft.particles.map((p) => ({ ...p.position, vx: p.velocity.x, vy: p.velocity.y })),
    }))
    // Run long enough to cross the grace period and converge emotions.
    fastForward(40, 50)
    balls.forEach((b, i) => {
      expect(b.soft.center.position.x).toBe(snapshot[i]!.center.x)
      expect(b.soft.center.position.y).toBe(snapshot[i]!.center.y)
      expect(b.soft.center.velocity.x).toBe(snapshot[i]!.center.vx)
      expect(b.soft.center.velocity.y).toBe(snapshot[i]!.center.vy)
      b.soft.particles.forEach((p, k) => {
        expect(p.position.x).toBe(snapshot[i]!.particles[k]!.x)
        expect(p.position.y).toBe(snapshot[i]!.particles[k]!.y)
        expect(p.velocity.x).toBe(snapshot[i]!.particles[k]!.vx)
        expect(p.velocity.y).toBe(snapshot[i]!.particles[k]!.vy)
      })
    })
  })

  it('a panicking ball and a calm ball with identical velocities keep those velocities', () => {
    const { sys, balls, fastForward } = rig()
    sys.wallTopY = TOP
    balls.push(fakeBall(1, 360, yAboveRim(0.9, 40), 40))
    balls.push(fakeBall(2, 360, TOP + 300, 40))
    for (const b of balls) setVelocity(b, 5, 5)
    fastForward(40, 50)
    expect(balls[0]!.soft.center.velocity.x).toBe(5)
    expect(balls[0]!.soft.center.velocity.y).toBe(5)
    expect(balls[1]!.soft.center.velocity.x).toBe(5)
    expect(balls[1]!.soft.center.velocity.y).toBe(5)
    // The emotions differ — the physics equality is not from identical states.
    expect(sys.panicOf(1)).toBeGreaterThan(sys.panicOf(2))
  })
})

describe('ball emotion: config thresholds', () => {
  it('level thresholds are ordered and inside the unit interval', () => {
    expect(BALL_EMOTION.worriedAt).toBeGreaterThan(0)
    expect(BALL_EMOTION.scaredAt).toBeGreaterThan(BALL_EMOTION.worriedAt)
    expect(BALL_EMOTION.panicAt).toBeGreaterThan(BALL_EMOTION.scaredAt)
    expect(BALL_EMOTION.panicAt).toBeLessThanOrEqual(1)
  })

  it('activation delay is positive', () => {
    expect(BALL_EMOTION.activationDelayMs).toBeGreaterThan(0)
  })

  it('emotionLevelFor maps the full ladder', () => {
    expect(emotionLevelFor(0)).toBe('normal')
    expect(emotionLevelFor(BALL_EMOTION.worriedAt)).toBe('worried')
    expect(emotionLevelFor(BALL_EMOTION.scaredAt)).toBe('scared')
    expect(emotionLevelFor(BALL_EMOTION.panicAt)).toBe('panic')
    expect(emotionLevelFor(1)).toBe('panic')
  })
})
