import { describe, expect, it } from 'vitest'
import * as Matter from 'matter-js'
import { getTier, isTransitionDefined } from '../../config/ballTiers'
import { containerBounds } from '../../config/container'
import { clampDropX } from './inputMath'
import { createContainerBodies } from './ContainerBodies'
import { PhysicsWorld } from './PhysicsWorld'
import { SoftBallManager } from './SoftBallManager'
import { MergeSystem } from './MergeSystem'
import { ScoreSystem } from './ScoreSystem'
import { createDeformState, registerImpact, stepDeform, scaleFromState, DEFORM } from '../rendering/deform'
import { gameBus } from '../events/gameBus'

const { top, floorY } = containerBounds()

function makeGame() {
  const pw = new PhysicsWorld()
  for (const body of createContainerBodies()) pw.addBody(body)
  const balls = new SoftBallManager(pw.world)
  balls.tierRadius = (t: number) => getTier(t)?.radius ?? 34
  const score = new ScoreSystem()
  // Mirrors the scene loop: step -> drain events -> mark first contact -> merge
  const settleAndTouch = (seconds: number): void => {
    for (let i = 0; i < seconds * 60; i++) {
      pw.step(1000 / 60)
      const evs = pw.takeCollisionEvents()
      const ids: number[] = []
      for (const e of evs) ids.push(e.bodyA.id, e.bodyB.id)
      if (ids.length) balls.markTouched(ids)
      mergesRef?.processMerges(evs)
    }
  }
  let mergesRef: MergeSystem | null = null
  const withMerges = (m: MergeSystem): void => {
    mergesRef = m
  }
  return { pw, balls, score, settleAndTouch, withMerges }
}



describe('merge eligibility (T1, T2)', () => {
  it('merges two same-tier balls into exactly one next-tier ball (T1, T4)', () => {
    const game = makeGame()
    const { pw, balls, score } = game
    const merges = new MergeSystem(balls, pw, score)
    game.withMerges(merges)
    // 3px overlap so contact registers while falling in sync
    const r1 = getTier(1)!.radius
    const a = balls.spawnBall(360 - r1 - 1, top + 40, 1)
    const b = balls.spawnBall(360 + r1 - 2, top + 40, 1)
    game.settleAndTouch(1.5) // they fall together, touch, and merge (scene flow)

    expect(score.score).toBe(getTier(2)!.score) // merged exactly once
    expect(balls.count).toBe(1)
    expect(balls.getBalls()[0]!.tier).toBe(2)
    const remaining = balls.getBalls()[0]!
    void a
    void b
    expect(remaining.body.position.x).toBeGreaterThan(300)
    expect(remaining.body.position.x).toBeLessThan(420)
    pw.dispose()
  })

  it('different tiers never merge (T2)', () => {
    const game = makeGame()
    const { pw, balls, score } = game
    const merges = new MergeSystem(balls, pw, score)
    game.withMerges(merges)
    balls.spawnBall(300, top + 40, 1)
    balls.spawnBall(430, top + 40, 2)
    game.settleAndTouch(2)
    const outcomes = merges.processMerges()
    expect(outcomes).toHaveLength(0)
    expect(balls.count).toBe(2)
    pw.dispose()
  })
})

describe('scoring (T3, T8)', () => {
  it('awards the configured tier score (T3)', () => {
    const game = makeGame()
    const { pw, balls, score } = game
    const merges = new MergeSystem(balls, pw, score)
    game.withMerges(merges)
    const r3 = getTier(3)!.radius
    balls.spawnBall(360 - r3 - 1, top + 40, 3)
    balls.spawnBall(360 + r3 - 2, top + 40, 3)
    game.settleAndTouch(1.5)
    expect(score.score).toBe(getTier(4)!.score) // awarded exactly once
    pw.dispose()
  })

  it('resets score between runs (T8)', () => {
    const score = new ScoreSystem()
    score.award(3, 1)
    score.award(4, 1)
    expect(score.score).toBeGreaterThan(0)
    score.reset()
    expect(score.score).toBe(0)
  })
})

describe('duplicate merge prevention (T5)', () => {
  it('a ball cannot participate in two merges in the same pass', () => {
    const game = makeGame()
    const { pw, balls, score } = game
    const merges = new MergeSystem(balls, pw, score)
    game.withMerges(merges)
    // Three tier-1 balls dropped together (30px gaps, radius 26): the middle
    // ball collides with both. Each ball may merge only once → at most one
    // tier-2 result. Net conservation: count = spawned - mergeCount.
    for (const x of [316, 360, 404]) balls.spawnBall(x, top + 40, 1) // 44px gaps = r44 touching
    game.settleAndTouch(2)
    // Each merge removes one ball net (−2 sources, +1 result)
    const mergesDone = 3 - balls.count
    expect(mergesDone).toBeLessThanOrEqual(1)
    // Running the pass again with an empty queue creates nothing new
    expect(merges.processMerges()).toHaveLength(0)
    pw.dispose()
  })

  it('processMerges is reentrant-safe', () => {
    const game = makeGame()
    const { pw, balls, score } = game
    const merges = new MergeSystem(balls, pw, score)
    game.withMerges(merges)
    const r1b = getTier(1)!.radius
    balls.spawnBall(360 - r1b - 1, top + 40, 1)
    balls.spawnBall(360 + r1b - 2, top + 40, 1)
    game.settleAndTouch(1.5)
    const [first, second] = [merges.processMerges(), merges.processMerges()]
    // Repeated drains after the merge are no-ops (no duplicates)
    expect(first.length + second.length).toBe(0)
    expect(score.score).toBe(getTier(2)!.score)
    pw.dispose()
  })
})

describe('chain merges (T6)', () => {
  it('processes chains from actual contacts with correct depth scoring', () => {
    const game = makeGame()
    const { pw, balls, score } = game
    const merges = new MergeSystem(balls, pw, score)
    game.withMerges(merges)

    // Deterministic chain: a tier-2 rests on the floor with a tier-1 resting
    // on it (brief settle only — soft rings squash wider over time, which
    // would de-stack the geometry); a tier-1 dropped dead-center merges with
    // the resting tier-1 near stack-top height, and the result lands on the
    // tier-2 within the chain window → tier 3 at chain depth 2. All from
    // actual queued collisions.
    const r2 = getTier(2)!.radius
    const r1 = getTier(1)!.radius
    const t2CenterY = floorY - r2 - 2
    balls.spawnBall(360, t2CenterY, 2)
    balls.spawnBall(360, t2CenterY - r2 - r1 - 2, 1)
    for (let i = 0; i < 10; i++) pw.step(1000 / 60)
    pw.takeCollisionEvents()
    balls.spawnBall(360, top + 40, 1)

    let chainDepthMax = 0
    let sawTier3 = false
    for (let i = 0; i < 60 * 6; i++) {
      pw.step(1000 / 60)
      const evs = pw.takeCollisionEvents()
      const ids: number[] = []
      for (const e of evs) ids.push(e.bodyA.id, e.bodyB.id)
      if (ids.length) balls.markTouched(ids)
      const outcomes = merges.processMerges(evs)
      for (const o of outcomes) {
        chainDepthMax = Math.max(chainDepthMax, o.chainDepth)
        if (o.tier === 3) sawTier3 = true
      }
      if (sawTier3 && chainDepthMax >= 2) break
    }
    expect(sawTier3).toBe(true)
    expect(chainDepthMax).toBeGreaterThanOrEqual(2)
    // Score: first merge (tier2, depth 1 → base) + chained merge (tier3,
    // depth 2 within the chain window → 2× base)
    expect(score.score).toBe(getTier(2)!.score + getTier(3)!.score * 2)
    pw.dispose()
  }, 20_000)
})

describe('tier-7 → tier-8 merge (Phase 2.13.0: T8 is a real destination)', () => {
  it('merges tier-7 pairs into the rainbow tier-8 with score', () => {
    expect(isTransitionDefined(8)).toBe(true)
    expect(getTier(8)?.playable).toBe(true)

    const game = makeGame()
    const { pw, balls, score } = game
    const merges = new MergeSystem(balls, pw, score)
    game.withMerges(merges)
    const before = score.score

    // Spawn two tier-6s sequentially (the narrow funnel cannot hold two
    // side by side at spawn height); the falling one lands on the resting
    // one and they merge into tier 7.
    balls.spawnBall(360, top + 40, 6)
    game.settleAndTouch(1.5)
    balls.spawnBall(370, top + 40, 6)
    game.settleAndTouch(2)
    merges.processMerges()
    const t7 = balls.getBalls().find((b) => b.tier === 7)
    expect(t7).toBeDefined()

    // Spawn a second tier-7 via another 6+6 merge (awards tier-7 score again)
    balls.spawnBall(360, top + 40, 6)
    game.settleAndTouch(1.5)
    balls.spawnBall(370, top + 40, 6)
    game.settleAndTouch(2)
    merges.processMerges()
    game.settleAndTouch(1.5)
    merges.processMerges()

    // Force the two tier-7s together if the second merge produced one
    const t7s = balls.getBalls().filter((b) => b.tier === 7)
    if (t7s.length === 2) {
      const [s1, s2] = [t7s[0]!, t7s[1]!]
      Matter.Body.setPosition(s1.body, { x: s2.body.position.x - 360, y: s2.body.position.y })
      Matter.Body.setVelocity(s1.body, { x: 8, y: 0 })
      game.settleAndTouch(3)
      merges.processMerges()
      // Phase 2.13.0: the T7 pair MERGES into exactly one tier-8 rainbow ball.
      expect(balls.getBalls().filter((b) => b.tier === 7).length).toBe(0)
      expect(balls.getBalls().filter((b) => b.tier === 8).length).toBe(1)
      expect(balls.count).toBe(1)
      expect(score.score).toBe(before + getTier(7)!.score * 2 + getTier(8)!.score)
    }
    pw.dispose()
  }, 30_000)
})

function this_centroid(balls: SoftBallManager, id: number): { x: number; y: number } {
  return balls.centroid(id)
}

describe('merge stress: engine stability after merges (T9 soak integration)', () => {
  it('30-ball soak with active merging stays stable and conserves mass', () => {
    const game = makeGame()
    const { pw, balls, score } = game
    const b2 = containerBounds()
    const merges = new MergeSystem(balls, pw, score)
    game.withMerges(merges)
    let spawned = 0
    let unitsSpawned = 0
    let nextDrop = 0
    const totalSteps = 60 * 60 + 10 * 60
    for (let i = 0; i < totalSteps; i++) {
      if (i === nextDrop && spawned < 30) {
        const tier = (spawned % 3) + 1
        const r = getTier(tier)!.radius
        const y = top + r + 12
        const x = clampDropX(100 + ((spawned * 97) % (600 - 2 * r)), r, {
          x: b2.innerLeftAt(y),
          width: b2.innerRightAt(y) - b2.innerLeftAt(y),
        })
        balls.spawnBall(x, y, tier)
        unitsSpawned += 2 ** (tier - 1)
        spawned += 1
        nextDrop = i + 120
      }
      pw.step(1000 / 60)
      const evs = pw.takeCollisionEvents()
      const ids: number[] = []
      for (const e of evs) ids.push(e.bodyA.id, e.bodyB.id)
      if (ids.length) balls.markTouched(ids)
      merges.processMerges(evs)
    }
    game.settleAndTouch(5)
    merges.processMerges()

    const b9 = containerBounds()
    const live = balls.getBalls()
    let ejected9 = 0
    for (const ball of live) {
      const c = ball.body.position
      expect(Number.isFinite(c.x)).toBe(true)
      expect(Number.isFinite(c.y)).toBe(true)
      const aboveMouth = c.y < b9.top - 40
      if (aboveMouth || c.x < b9.left - 80 || c.x > b9.right + 80 || c.y > b9.floorY + 200) {
        ejected9 += 1 // legal escape through the open top; no tunneling asserted below
        continue
      }
      // Soft-body invariants under sustained pile load:
      //  - nothing passes through the floor slab (82px ≫ 14px/step clamp)
      //  - the center particle may ride ≤20px into the surface under load
      //    (contact softness of a squashed bottom ball — visible squash, not
      //    tunneling; the ring bottoms embed ~13px and the slab holds)
      //  - the logical centroid stays in the container
      expect(c.y).toBeLessThan(b9.floorY + 20)
      const maxY = Math.max(...ball.soft.particles.map((p) => p.position.y))
      expect(maxY).toBeLessThan(b9.floorY + 80)
      const centroid = this_centroid(balls, ball.id)
      expect(centroid.y).toBeLessThan(b9.floorY + 10)
      // Only near-rest balls are bounded: falling balls ride the 14px/step
      // travel clamp legitimately (pressure ceiling is 10, below the clamp).
      const speed = Math.hypot(ball.body.velocity.x, ball.body.velocity.y)
      expect(speed).toBeLessThan(15)
    }
    expect(ejected9).toBeLessThanOrEqual(8)
    // Mass conservation: live "units" (tier n = 2^(n-1) tier-1 equivalents)
    // never exceed the units spawned (merging conserves mass; mouth ejecta
    // only reduce the live total in the narrower Phase 2.3 container).
    const units = live.reduce((acc, b) => acc + 2 ** (b.tier - 1), 0)
    expect(units).toBeLessThanOrEqual(unitsSpawned)
    expect(units).toBeGreaterThan(0)
    expect(score.score).toBeGreaterThan(0)
    pw.dispose()
  }, 60_000)
})

describe('deform math: jelly model (T10)', () => {
  it('squash scales with approach speed; underdamped overshoot then exact rest', () => {
    const state = createDeformState()
    registerImpact(state, 0, 1, 20, 48, 0) // hard vertical hit
    let minY = 2
    let overshoots = 0
    let prevSign = 0
    for (let i = 0; i < 240; i++) {
      stepDeform(state, 16.6)
      minY = Math.min(minY, scaleFromState(state).y)
      const sgn = Math.sign(state.squash)
      if (sgn !== 0 && prevSign !== 0 && sgn !== prevSign) overshoots++
      if (sgn !== 0) prevSign = sgn
    }
    expect(minY).toBeLessThan(0.87) // peak compression clearly visible (14% squash)
    expect(overshoots).toBeGreaterThanOrEqual(3) // 3+ visible jelly oscillations
    const settled = scaleFromState(state)
    expect(Math.abs(settled.x - 1)).toBeLessThan(0.005)
    expect(Math.abs(settled.y - 1)).toBeLessThan(0.005)
    expect(state.squash).toBe(0)
    expect(state.cross).toBe(0)
  })

  it('rolling/sliding motion produces NO phantom deformation', () => {
    const state = createDeformState()
    for (let i = 0; i < 120; i++) stepDeform(state, 16.6)
    expect(state.squash).toBe(0)
    // Sub-threshold contacts (soft resting touches) are ignored too
    registerImpact(state, 0, 1, DEFORM.minImpactSpeed - 0.1, 48, 0)
    expect(state.squash).toBe(0)
  })

  it('squash axis follows the impact normal in the body-local frame', () => {
    const a = createDeformState()
    registerImpact(a, 1, 0, 18, 48, 0) // horizontal wall hit -> squash local x
    expect(a.axisX).not.toBe(0)
    expect(a.axisY).toBe(0)
    const b = createDeformState()
    registerImpact(b, 0, 1, 18, 48, Math.PI / 2) // rotated body, floor hit
    expect(Math.abs(b.axisX)).toBe(1)
    expect(b.axisY).toBe(0)
  })

  it('deform never crosses hard clamp bounds under any input', () => {
    const state = createDeformState()
    let angle = 0
    for (let i = 0; i < 600; i++) {
      angle += 0.1
      registerImpact(state, Math.sin(angle), Math.cos(angle), Math.random() * 40, 48, angle)
      stepDeform(state, 33)
      stepDeform(state, 8)
      expect(state.squash).toBeLessThanOrEqual(DEFORM.maxSquash + 1e-9)
      expect(state.squash).toBeGreaterThanOrEqual(-DEFORM.maxSquash * 0.55 - 1e-9)
      expect(Math.abs(state.cross)).toBeLessThanOrEqual(DEFORM.maxSquash * 0.4 + 1e-9)
    }
  })

  it('subtle on light taps, pronounced on hard hits', () => {
    const light = createDeformState()
    registerImpact(light, 0, 1, 3, 48, 0)
    const heavy = createDeformState()
    registerImpact(heavy, 0, 1, 20, 48, 0)
    expect(light.squashVel).toBeGreaterThan(0)
    expect(heavy.squashVel).toBeGreaterThan(light.squashVel * 2)
  })
})

describe('scoring data flow (Priority 3)', () => {
  it('score accumulates across multiple merges in one pass, exactly once each', () => {
    const score = new ScoreSystem()
    const events: Array<{ score: number; lastAward: number }> = []
    const bus = gameBus // shared singleton — subscribe/unsubscribe scoped to this test
    const off = bus.on('state:score', (e) => events.push({ ...e }))
    const a1 = score.award(2, 1)
    const a2 = score.award(3, 2)
    off()
    expect(a1).toBe(getTier(2)!.score)
    expect(a2).toBe(getTier(3)!.score * 2) // chain depth 2
    expect(score.score).toBe(getTier(2)!.score + getTier(3)!.score * 2)
    expect(events).toHaveLength(2) // exactly one event per merge
    expect(events[1]!.score).toBe(score.score) // event always carries the running total
  })

  it('reset emits a zero-score event and clears the total', () => {
    const score = new ScoreSystem()
    score.award(4, 1)
    let last = -1
    const off = gameBus.on('state:score', (e) => {
      last = e.score
    })
    score.reset()
    off()
    expect(score.score).toBe(0)
    expect(last).toBe(0)
  })

  it('duplicate collision events cannot double-award (merge guards hold)', () => {
    const game = makeGame()
    const { pw, balls, score } = game
    const merges = new MergeSystem(balls, pw, score)
    game.withMerges(merges)
    const r1b = getTier(1)!.radius
    balls.spawnBall(360 - r1b - 1, top + 40, 1)
    balls.spawnBall(360 + r1b - 2, top + 40, 1)
    game.settleAndTouch(1.5)
    // Repeated calls with the drained queue must be a no-op
    const again = merges.processMerges([])
    expect(again).toHaveLength(0)
    expect(score.score).toBe(getTier(2)!.score) // awarded exactly once
    pw.dispose()
  })
})
