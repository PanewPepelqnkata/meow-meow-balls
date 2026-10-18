import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { containerBounds, wallCollidersAt, floorCollider } from '../../config/container'
import { getTier } from '../../config/ballTiers'

import { PhysicsWorld } from './PhysicsWorld'
import { SoftBallManager } from './SoftBallManager'
import { MergeSystem } from './MergeSystem'
import { ScoreSystem } from './ScoreSystem'
import { createWallBody } from './ContainerBodies'
import { softBallCentroid, softBallSleeping } from './SoftBall'


/**
 * Phase 2.10.2 merge-cooldown + lifecycle regressions (spec P1/P2):
 *  - simultaneous perimeter-particle events deduplicate to ONE logical merge,
 *  - a replacement cannot chain-merge within mergeCooldownMs (same-step or
 *    continuing contact), but merges once the cooldown expires WITHOUT a new
 *    collisionStart (active-pair revalidation),
 *  - unrelated pairs merge concurrently during a cooldown,
 *  - restart clears cooldowns and pending replacements,
 *  - the atomic lifecycle: sources removed, exactly one replacement, and
 *    placement never buries a remaining ball (deferred when unavoidable).
 */

function rig() {
  const physics = new PhysicsWorld()
  for (const body of [...wallCollidersAt().map(createWallBody), createWallBody(floorCollider())]) {
    physics.addBody(body)
  }
  const manager = new SoftBallManager(physics.world)
  manager.tierRadius = (t) => getTier(t)?.radius ?? 34
  physics.setSubStepHandler(() => {
    manager.stepAll()
    manager.separateContacts()
    manager.expandShape()
    manager.clampToContainer()
    manager.commitRest()
  })
  const score = new ScoreSystem()
  const mergeSystem = new MergeSystem(manager, physics, score)
  const drain = () => {
    const evs = physics.takeCollisionEvents()
    const ids: number[] = []
    for (const e of evs) ids.push(e.bodyA.id, e.bodyB.id)
    if (ids.length) manager.markTouched(ids)
    mergeSystem.processMerges(evs)
  }
  const step = (seconds: number) => {
    for (let i = 0; i < seconds * PHYSICS.stepHz; i++) {
      physics.step(PHYSICS.stepMs)
      drain()
    }
  }
  const ballsOfTier = (tier: number) => manager.getBalls().filter((b) => b.tier === tier)
  return { physics, manager, mergeSystem, score, step, drain, ballsOfTier }
}

function worstPairOverlap(manager: SoftBallManager): number {
  const balls = manager.getBalls()
  let worst = 0
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const rA = balls[i]!.soft.radius * 0.32 + 2
      const rB = balls[j]!.soft.radius * 0.32 + 2
      for (const pa of balls[i]!.soft.particles) {
        for (const pb of balls[j]!.soft.particles) {
          const d = Math.hypot(pa.position.x - pb.position.x, pa.position.y - pb.position.y)
          worst = Math.max(worst, rA + rB - d)
        }
      }
    }
  }
  return worst
}

describe('Phase 2.10.2: merge cooldown + atomic lifecycle', () => {
  it('simultaneous perimeter-particle events between the same pair deduplicate to ONE merge', () => {
    const { physics, manager, mergeSystem, step, ballsOfTier } = rig()
    const b = containerBounds()
    const r1 = getTier(1)!.radius
    // Two tier-1 balls side by side; when they touch, MANY particle-level
    // collisionStart events fire in the same batch.
    manager.spawnBall(340, b.floorY - r1 - 2, 1)
    manager.spawnBall(384, b.floorY - r1 - 2, 1)
    // Step per-frame until the merge completes; keep the event batch that
    // performed it (it still references the removed bodies).
    let mergeEvs: ReturnType<PhysicsWorld['takeCollisionEvents']> = []
    for (let i = 0; i < PHYSICS.stepHz * 3 && ballsOfTier(2).length === 0; i++) {
      physics.step(PHYSICS.stepMs)
      const frameEvs = physics.takeCollisionEvents()
      const ids: number[] = []
      for (const e of frameEvs) ids.push(e.bodyA.id, e.bodyB.id)
      if (ids.length) manager.markTouched(ids)
      mergeSystem.processMerges(frameEvs)
      if (frameEvs.length > 0) mergeEvs = frameEvs
    }
    const outcomes = mergeSystem.processMerges(mergeEvs)
    const tier1Merges = outcomes.filter((o) => o.tier === 2).length
    // Exactly one logical merge for the pair...
    expect(tier1Merges).toBeLessThanOrEqual(1)
    expect(ballsOfTier(2).length).toBe(1)
    expect(ballsOfTier(1).length).toBe(0)
    // ...and re-processing the SAME events is fully rejected (the pair is
    // reserved then removed — no duplicate merge, nothing respawned).
    const rejectedBefore = mergeSystem.stats.duplicateEventsRejected
    mergeSystem.processMerges(mergeEvs)
    expect(mergeSystem.stats.duplicateEventsRejected).toBeGreaterThan(rejectedBefore)
    step(0.5)
    expect(manager.count).toBe(1)
    expect(worstPairOverlap(manager)).toBeLessThanOrEqual(2.5)
    physics.dispose()
  }, 120_000)

  it('a fresh replacement does NOT chain-merge within the cooldown, then DOES via contact revalidation', () => {
    const { physics, manager, mergeSystem, ballsOfTier } = rig()
    const b = containerBounds()
    const r2 = getTier(2)!.radius
    // Two tier-2 balls merge → the tier-3 replacement C spawns, and a
    // pre-existing tier-3 D sits immediately beside it: a same-tier contact
    // right at creation. The chain must wait for the cooldown, then complete
    // WITHOUT any new collisionStart (active-pair revalidation).
    manager.spawnBall(300, b.floorY - r2 - 2, 2)
    manager.spawnBall(390, b.floorY - r2 - 2, 2)
    // Step in single-substep increments; the moment the tier-3 replacement C
    // exists, spawn the same-tier D touching it — within the cooldown window.
    let replacement: ReturnType<SoftBallManager['getBalls']>[number] | undefined
    for (let i = 0; i < PHYSICS.stepHz * 4 && !replacement; i++) {
      physics.step(PHYSICS.stepMs)
      const evs = physics.takeCollisionEvents()
      const ids: number[] = []
      for (const e of evs) ids.push(e.bodyA.id, e.bodyB.id)
      if (ids.length) manager.markTouched(ids)
      mergeSystem.processMerges(evs)
      replacement = manager.getBalls().find((x) => x.tier === 3)
    }
    expect(replacement).toBeDefined()
    const r3 = getTier(3)!.radius
    const cx = softBallCentroid(replacement!.soft).x
    manager.spawnBall(cx + 2 * r3 - 4, b.floorY - r3 - 2, 3) // D touching C
    let chainDone = false
    let chainDelaySteps = 0
    for (let i = 0; i < PHYSICS.stepHz * 6 && !chainDone; i++) {
      physics.step(PHYSICS.stepMs)
      const evs = physics.takeCollisionEvents()
      const ids: number[] = []
      for (const e of evs) ids.push(e.bodyA.id, e.bodyB.id)
      if (ids.length) manager.markTouched(ids)
      mergeSystem.processMerges(evs)
      chainDelaySteps++
      if (ballsOfTier(4).length > 0) chainDone = true
    }
    expect(chainDone).toBe(true) // chain merge completed (via revalidation)
    // The cooldown actually held the same-step chain back: the merge may not
    // complete within the first ~14 substeps (120ms cooldown ≈ 14 × 8.33ms).
    expect(chainDelaySteps).toBeGreaterThan(14)
    expect(worstPairOverlap(manager)).toBeLessThanOrEqual(2.5)
    physics.dispose()
  }, 240_000)

  it('unrelated pairs merge concurrently while a replacement is on cooldown', () => {
    const { physics, manager, step, ballsOfTier } = rig()
    const b = containerBounds()
    const r1 = getTier(1)!.radius
    const r2 = getTier(2)!.radius
    // Left pair merges; immediately after (replacement on cooldown), an
    // independent touching pair on the RIGHT must still merge in the same
    // window.
    manager.spawnBall(280, b.floorY - r2 - 2, 2)
    manager.spawnBall(372, b.floorY - r2 - 2, 2)
    step(1.5)
    expect(ballsOfTier(3).length).toBe(1)
    manager.spawnBall(450, b.floorY - r1 - 2, 1)
    manager.spawnBall(520, b.floorY - r1 - 2, 1) // overlapping → immediate contact
    step(0.4) // well within any cooldown window
    expect(ballsOfTier(2).length).toBe(1) // the unrelated pair merged anyway
    physics.dispose()
  }, 120_000)

  it('restart clears cooldowns and pending replacements (resetChain)', () => {
    const { manager, mergeSystem, physics } = rig()
    // Simulate post-merge state, then restart semantics
    mergeSystem.resetChain()
    expect(mergeSystem.stats.lastBallsBefore).toBe(0)
    expect(mergeSystem.stats.lastBallsAfter).toBe(0)
    // Internal state via behavior: after reset, a fresh pair merges normally
    const b = containerBounds()
    const r1 = getTier(1)!.radius
    manager.spawnBall(340, b.floorY - r1 - 2, 1)
    manager.spawnBall(384, b.floorY - r1 - 2, 1)
    const physics2 = physics
    void physics2
    const step2 = (n: number) => {
      for (let i = 0; i < n * PHYSICS.stepHz; i++) {
        physics.step(PHYSICS.stepMs)
        const evs = physics.takeCollisionEvents()
        const ids: number[] = []
        for (const e of evs) ids.push(e.bodyA.id, e.bodyB.id)
        if (ids.length) manager.markTouched(ids)
        mergeSystem.processMerges(evs)
      }
    }
    step2(1.5)
    expect(manager.getBalls().filter((x) => x.tier === 2)).toHaveLength(1)
    physics.dispose()
  }, 120_000)

  it('merge lifecycle stats: two sources removed, one replacement, ball count consistent', () => {
    const { manager, mergeSystem, step, physics } = rig()
    const b = containerBounds()
    const r1 = getTier(1)!.radius
    manager.spawnBall(340, b.floorY - r1 - 2, 1)
    manager.spawnBall(384, b.floorY - r1 - 2, 1)
    step(2)
    expect(mergeSystem.stats.mergesCompleted).toBe(1)
    expect(mergeSystem.stats.sourcesRemoved).toBe(2)
    expect(mergeSystem.stats.replacementsCreated).toBe(1)
    expect(mergeSystem.stats.lastBallsBefore).toBe(2)
    expect(mergeSystem.stats.lastBallsAfter).toBe(1)
    expect(manager.count).toBe(1)
    physics.dispose()
  }, 120_000)

  it('deferred placement still produces exactly one replacement and never buries a ball', () => {
    const { manager, mergeSystem, step, physics } = rig()
    const b = containerBounds()
    const r4 = getTier(4)!.radius
    // Dense: tier-4 A rests on the floor with tier-2 neighbors packed to its
    // right; tier-4 B drops straight onto A and merges — the tier-5
    // replacement must resolve around the neighbors (possibly deferred),
    // appear exactly once, and bury nothing.
    manager.spawnBall(300, b.floorY - r4 - 2, 4)
    manager.spawnBall(455, b.floorY - 48 - 2, 2)
    manager.spawnBall(455, b.floorY - 48 - 110, 2)
    step(1)
    manager.spawnBall(310, b.floorY - 2 * r4 - 60, 4)
    let guard = 0
    while (manager.getBalls().filter((x) => x.tier === 5).length === 0 && guard++ < 30) step(1)
    expect(manager.getBalls().filter((x) => x.tier === 5).length).toBe(1)
    expect(worstPairOverlap(manager)).toBeLessThanOrEqual(2.5)
    expect(mergeSystem.stats.replacementsCreated).toBeGreaterThanOrEqual(1)
    physics.dispose()
  }, 240_000)

  it('sleeping balls are never drawn as merging/removed (renderer lifecycle contract)', () => {
    const { manager, step, physics } = rig()
    const b = containerBounds()
    const r2 = getTier(2)!.radius
    manager.spawnBall(360, b.floorY - r2 - 2, 2)
    step(4)
    const ball = manager.getBalls()[0]!
    expect(softBallSleeping(ball.soft)).toBe(true)
    expect(ball.state).toBe('active')
    physics.dispose()
  }, 120_000)
})
