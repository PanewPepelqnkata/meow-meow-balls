import { describe, expect, it } from 'vitest'
import Matter from 'matter-js'
import { containerBounds } from '../../config/container'
import { getTier } from '../../config/ballTiers'
import { PhysicsWorld } from './PhysicsWorld'
import { BallManager } from './BallManager'
import { createContainerBodies } from './ContainerBodies'

const { top, floorY } = containerBounds()
function makeGame() {
  const pw = new PhysicsWorld()
  for (const body of createContainerBodies()) pw.addBody(body)
  return { pw, balls: new BallManager(pw) }
}

describe('feel scenarios (Step 5)', () => {
  it('S1: floor drop — snappy fall, <=2 bounces, settles quickly', () => {
    const { pw, balls } = makeGame()
    const r1 = getTier(1)!.radius
    const ball = balls.spawnBall(360, top + r1 + 12, 1)
    let bounces = 0, prevVy = 0, landed = -1, settled = -1
    for (let i = 0; i < 60 * 4; i++) {
      pw.step(1000 / 60)
      const vy = ball.body.velocity.y, y = ball.body.position.y
      if (prevVy > 1 && vy < -0.5 && y > floorY - r1 - 30) bounces++
      if (landed < 0 && y > floorY - r1 - 4) landed = i
            if (landed >= 0 && settled < 0 && Math.abs(vy) < 0.3 && Math.abs(ball.body.velocity.x) < 0.3) settled = i // visually still
      prevVy = vy
    }
    const dropS = landed / 60
    expect(dropS).toBeGreaterThan(0.4) // not teleporting
    expect(dropS).toBeLessThanOrEqual(0.9) // snappy
    expect(bounces).toBeLessThanOrEqual(2)
    expect((settled - landed) / 60).toBeLessThan(1.0)
    // Eventually fully at rest (incl. sleeping)
    for (let i = 0; i < 60 * 3; i++) pw.step(1000 / 60)
    expect(Math.hypot(ball.body.velocity.x, ball.body.velocity.y)).toBeLessThan(0.05)
    pw.dispose()
  })

  it('S2: rolls down each sloped wall toward the center', () => {
    const { pw, balls } = makeGame()
    const b = containerBounds()
    const r1 = getTier(1)!.radius
    for (const side of ['L', 'R'] as const) {
      const x = side === 'L' ? b.innerLeftAt(b.top + 120) + r1 + 4 : b.innerRightAt(b.top + 120) - r1 - 4
      const ball = balls.spawnBall(x, b.top + 120, 1)
      let reached = -1
      for (let i = 0; i < 60 * 6; i++) {
        pw.step(1000 / 60)
        if (ball.body.position.y > b.floorY - r1 - 6) { reached = i; break }
      }
      expect(reached).toBeGreaterThan(0)
      expect(reached / 60).toBeLessThan(4)
      expect(ball.body.position.x).toBeGreaterThan(b.innerLeftAt(b.floorY)) // rolled inward (center-ish)
      balls.removeBall(ball.id)
    }
    pw.dispose()
  })

  it('S3: two balls collide and push apart with momentum transfer', () => {
    const { pw, balls } = makeGame()
    const a = balls.spawnBall(250, floorY - getTier(1)!.radius - 2, 1)
    const b = balls.spawnBall(430, floorY - getTier(1)!.radius - 2, 1)
    for (let i = 0; i < 30; i++) pw.step(1000 / 60)
    Matter.Body.setVelocity(a.body, { x: 12, y: 0 })
    let maxB = 0
    for (let i = 0; i < 60; i++) {
      pw.step(1000 / 60)
      maxB = Math.max(maxB, Math.abs(b.body.velocity.x))
    }
    expect(maxB).toBeGreaterThan(3) // B was pushed
    expect(a.body.position.x).toBeLessThan(b.body.position.x) // no pass-through
    pw.dispose()
  })

  it('S4+S5: ball lands on a pile — pile displaces, nothing explodes, settles', () => {
    const { pw, balls } = makeGame()
    const r1 = getTier(1)!.radius
    balls.spawnBall(330, floorY - r1 - 2, 1)
    balls.spawnBall(400, floorY - r1 - 2, 1)
    for (let i = 0; i < 60; i++) pw.step(1000 / 60)
    const before = balls.getBalls().map((b) => ({ x: b.body.position.x, y: b.body.position.y }))
    balls.spawnBall(365, top + r1 + 12, 1)
    let displaced = false
    for (let i = 0; i < 60 * 4; i++) {
      pw.step(1000 / 60)
      if (!displaced) {
        for (let k = 0; k < 2; k++) {
          const p = balls.getBalls()[k]!.body.position
          if (Math.hypot(p.x - before[k]!.x, p.y - before[k]!.y) > 10) displaced = true
        }
      }
    }
    expect(displaced).toBe(true) // pile rearranged
    for (const ball of balls.getBalls()) {
      expect(Number.isFinite(ball.body.position.y)).toBe(true)
      expect(ball.body.position.y).toBeLessThan(floorY)
      expect(Math.hypot(ball.body.velocity.x, ball.body.velocity.y)).toBeLessThan(1)
    }
    pw.dispose()
  })

  it('S8: nearly-full container settles without persistent jitter', () => {
    const { pw, balls } = makeGame()
    const b = containerBounds()
    // Phase 2.3 container area = 244,850 u2; 8t1+5t2+3t3 = 180,120 u2 = 74%
    // fill — crowded, stacks form, but below the jamming/overflow regime.
    const mix = [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3]
    let n = 0
    for (let i = 0; i < 60 * 30 && n < mix.length; i++) {
      if (i % 72 === 0) {
        const tier = mix[n]!
        const r = getTier(tier)!.radius
        const y = b.top + r + 12
        const x = 120 + ((n * 89) % (b.right - b.left - 2 * r))
        const cx = Math.min(Math.max(x, b.innerLeftAt(y) + r + 1), b.innerRightAt(y) - r - 1)
        balls.spawnBall(cx, y, tier)
        n++
      }
      pw.step(1000 / 60)
    }
    for (let i = 0; i < 60 * 5; i++) pw.step(1000 / 60)
    const speeds = balls.getBalls().map((b2) => Math.hypot(b2.body.velocity.x, b2.body.velocity.y))
    const maxSpeed = Math.max(...speeds)
    const avgSpeed = speeds.reduce((a, c) => a + c, 0) / speeds.length
    expect(avgSpeed).toBeLessThan(0.15)
    expect(maxSpeed).toBeLessThan(0.8) // no persistent jitter
    pw.dispose()
  }, 30_000)
})
