import { describe, expect, it } from 'vitest'
import { PHYSICS } from '../../config/physics'
import { MERGE } from '../../config/merge'
import { containerBounds, wallCollidersAt, floorCollider } from '../../config/container'
import { getTier } from '../../config/ballTiers'

import { PhysicsWorld } from './PhysicsWorld'
import { SoftBallManager } from './SoftBallManager'
import { MergeSystem } from './MergeSystem'
import { ScoreSystem } from './ScoreSystem'
import { createWallBody } from './ContainerBodies'

/**
 * Phase 2.13.3 (spec §1) — merge-visibility + no-loss regression contract:
 *
 *  - a deferred merge keeps BOTH source balls in the world (visible,
 *    physically intact) until the replacement exists;
 *  - the resolution is ATOMIC: any frame that removes sources also creates
 *    exactly one replacement — per frame, the ball-count drop equals the
 *    number of merges COMPLETED that frame (nothing else ever disappears);
 *  - a nearly full container — merges near the top and both walls — never
 *    loses a merge: exactly one replacement per merge, never inside another
 *    ball, never discarded.
 *
 * Phase 2.13.4 adds the TRANSACTION contract on top:
 *  - every accepted pair has exactly one transaction record that completes
 *    with exactly one replacement id (or is still safely pending);
 *  - REPEATED merges at the crowded top of a nearly full container all
 *    resolve — none lost, none duplicated;
 *  - while a transaction is pending, its sources are still in the world
 *    (the renderer's state guard is browser-verified via isDrawn).
 *
 * The pile scenarios deliberately allow legitimate cascade merges during
 * settling; the per-frame accounting invariant holds for every one of them,
 * which is exactly the contract under test.
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
  const stepFrame = () => {
    physics.step(PHYSICS.stepMs)
    const evs = physics.takeCollisionEvents()
    const ids: number[] = []
    for (const e of evs) ids.push(e.bodyA.id, e.bodyB.id)
    if (ids.length) manager.markTouched(ids)
    mergeSystem.processMerges(evs)
  }
  const step = (seconds: number) => {
    for (let i = 0; i < seconds * PHYSICS.stepHz; i++) stepFrame()
  }
  return { physics, manager, mergeSystem, step, stepFrame }
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

/**
 * Phase 2.14.0: the GENUINELY impossible placement construction. The 2.13.2
 * "jammed interior" T4/T5 checkerboard no longer defers under the no-swallow
 * policy — its lattice gaps admit an immediate overlap spot (the fix working
 * as intended), so it can no longer exercise the retention contract. This
 * crush can: a full-width lattice (85px row pitch, near-wall balls on every
 * row so no ring candidate escapes around the sides, top row above the reach
 * of the 227px ring search from the pair's merge point). Every clamped
 * candidate is within 107px of some center (worst void ≈75px) — and the
 * no-swallow commit condition reduces to "no center within rNew−1 = 107px" —
 * so the pair's merge MUST defer: sources retained, locked, visible, until
 * the lattice relaxes open or the aged guarantee resolves it.
 *
 * Phase 2.15.0: the tier assignment is now a hand-verified 3-coloring. The
 * old k%2 alternation put same-tier balls in diagonal contact — frame-1
 * cascade replacements opened a >107px hole and the pair committed straight
 * through it. Now NO two same-tier balls are within contact range of each
 * other (minimum same-tier distance 170px vs. the worst contact threshold
 * 156px for two tier-4 envelopes), so the lattice cannot cascade before the
 * pair's transaction is evaluated; the pair meets the lattice at full spawn
 * density. Tiers per row (x, tier):
 *   y=1005: (230,T2) (360,T4) (490,T3)
 *   y= 920: (212,T4) (295,T3) (425,T2) (508,T4)
 *   y= 835: (230,T2) (360,T4) (490,T3)
 *   y= 750: (200,T4) (295,T3) (425,T2) (520,T4)
 */
function fillImpossibleCrush(manager: SoftBallManager): void {
  const rows: Array<[number, Array<[number, number]>]> = [
    [1005, [[230, 2], [360, 4], [490, 3]]],
    [920, [[212, 4], [295, 3], [425, 2], [508, 4]]],
    [835, [[230, 2], [360, 4], [490, 3]]],
    [750, [[200, 4], [295, 3], [425, 2], [520, 4]]],
  ]
  for (const [y, balls] of rows) {
    for (const [x, tier] of balls) manager.spawnBall(x, y, tier)
  }
}

/**
 * The per-frame ATOMICITY invariant. Each completed merge removes exactly
 * two sources and creates exactly one replacement (net −1); a deferred
 * merge removes nothing. Therefore in EVERY frame:
 *   countBefore − countAfter === Δ mergesCompleted
 * Any lost merge (sources gone, no replacement) or duplicate replacement
 * breaks this equality.
 */
function expectAtomicFrame(
  manager: SoftBallManager,
  mergeSystem: MergeSystem,
  before: { count: number; completed: number },
): void {
  const drop = before.count - manager.count
  const delta = mergeSystem.stats.mergesCompleted - before.completed
  expect(drop).toBe(delta)
  expect(mergeSystem.stats.replacementsCreated).toBe(mergeSystem.stats.mergesCompleted)
  expect(mergeSystem.stats.sourcesRemoved).toBe(2 * mergeSystem.stats.mergesCompleted)
}

/**
 * Phase 2.13.4: the merge TRANSACTION log must be clean — every accepted
 * pair completed with EXACTLY ONE replacement (or is still safely pending
 * with its sources in the world), and nothing was dropped.
 */
function expectTransactionsClean(mergeSystem: MergeSystem): void {
  let completed = 0
  for (const t of mergeSystem.mergeTransactions) {
    if (t.outcome === 'pending') continue
    expect(t.outcome).toBe('completed')
    expect(t.replacementId).not.toBeNull()
    expect(t.pendingMs).toBeGreaterThanOrEqual(0)
    completed++
  }
  expect(mergeSystem.mergeTransactions.some((t) => t.outcome === 'dropped')).toBe(false)
  // The log is capped at 32 — only compare counts while nothing shifted out.
  if (mergeSystem.mergeTransactions.length < 32) {
    expect(completed).toBe(mergeSystem.stats.mergesCompleted)
  }
}

describe('Phase 2.13.3: deferred merges keep their sources until the replacement exists', () => {
  it('an IMPOSSIBLE interior merge keeps BOTH sources in the world while pending, then resolves atomically', () => {
    const { physics, manager, mergeSystem, stepFrame } = rig()
    // Phase 2.14.0: the old T4/T5 checkerboard "jam" no longer defers — the
    // no-swallow policy finds a valid immediate spot in its lattice gaps
    // (exactly the reported-delay fix). The retention contract is exercised
    // on the genuinely impossible crush: a tight T3/T4 lattice with no
    // valid spot anywhere within the bounded ring search.
    // Phase 2.15.0: the pair merges at FULL crush density (spawned in the
    // same frame, before any settle/cascade can loosen the lattice — with
    // the open top, settle cascades near the rim now stay UP there instead
    // of re-densifying the interior, so a settled crush is no longer
    // impossible). The mechanism under test is unchanged: defer → sources
    // retained, locked, visible → resolve within the aged guarantee.
    fillImpossibleCrush(manager)
    // The pair is spawned INSIDE the crush — the merge happens low, with the
    // full lattice above it and the floor below.
    manager.spawnBall(330, 1000, 5)
    manager.spawnBall(380, 1000, 5)

    const before = () => ({ count: manager.count, completed: mergeSystem.stats.mergesCompleted })
    let sawPendingWindow = false
    for (let i = 0; i < PHYSICS.stepHz * 10; i++) {
      const b0 = before()
      stepFrame()
      expectAtomicFrame(manager, mergeSystem, b0)
      const merging = manager.getBalls().filter((x) => x.state === 'merging')
      if (merging.length > 0) {
        // PENDING WINDOW: locked sources with no replacement yet — they
        // must STILL be in the world (visible, intact). Crush cascade pairs
        // may pend alongside ours, so only parity + retention is asserted.
        sawPendingWindow = true
        expect(merging.length % 2).toBe(0)
        expect(merging.length).toBeGreaterThanOrEqual(2)
        for (const m of merging) expect(manager.getBallById(m.id)).toBeDefined()
      }
    }
    // The pending path was genuinely exercised in this jam.
    expect(sawPendingWindow).toBe(true)
    // The pair's merge resolved (a tier-6 replacement existed at some point
    // — cascades may have consumed it further, which is legitimate).
    expect(mergeSystem.stats.mergesCompleted).toBeGreaterThanOrEqual(1)
    // No ball left mid-merge: everything is either active or resolved.
    expect(manager.getBalls().filter((x) => x.state === 'merging')).toHaveLength(0)
    // Phase 2.14.0: the crush resolves via the aged guarantee (a deep
    // least-penetration commit), so a small resting squish remains while
    // the crush drains over the open rim. Still nothing like a bury.
    expect(worstPairOverlap(manager)).toBeLessThanOrEqual(8)
    physics.dispose()
  }, 240_000)
})

describe('Phase 2.14.0: merge immediacy — normal merges never wait for the emergency timeout', () => {
  /**
   * The reported defect: crowded merges visibly waited the full 900ms
   * emergency deadline before the replacement appeared. The fix: a fresh
   * merge commits IMMEDIATELY at the least-penetrating local spot whenever
   * the no-swallow rule holds (neither center would enter the other's
   * envelope — the soft solver separates the touching balls); deferral is
   * reserved for genuinely buried placements. Contract under test, on the
   * exact user-facing scenario (nearly full container, merges at the crowded
   * top):
   *   - the dropped pairs' transactions complete within a few frames and
   *     never touch the emergency deadline;
   *   - every transaction resolves bounded (pathological jam cascades may
   *     use the aged backstop — never lost);
   *   - immediate overlap commits obey the no-swallow rule.
   */
  function fillNearlyFull(manager: SoftBallManager): void {
    const rows = [1030, 950, 870, 790, 730]
    let k = 0
    for (let r = 0; r < rows.length; r++) {
      const y = rows[r]!
      const off = r % 2 === 0 ? 0 : 85
      for (let x = 235 + off; x <= 505 - off; x += 170) {
        manager.spawnBall(x, y, (k + r) % 2 === 0 ? 4 : 5)
        k++
      }
    }
  }

  it('crowded TOP merges (both sides) commit on the frame they fire — no emergency waits', () => {
    const { physics, manager, mergeSystem, step, stepFrame } = rig()
    void containerBounds()
    fillNearlyFull(manager)
    step(3) // settle (cascades included in the assertions below)

    const pairIds: number[] = []
    for (const [ax, ay, bx, by] of [
      [265, 790, 315, 785],
      [460, 790, 505, 785],
    ] as const) {
      const a = manager.spawnBall(ax, ay, 5)
      const b = manager.spawnBall(bx, by, 5)
      pairIds.push(a.id, b.id)
      for (let i = 0; i < PHYSICS.stepHz * 6; i++) {
        const b0 = { count: manager.count, completed: mergeSystem.stats.mergesCompleted }
        stepFrame()
        expectAtomicFrame(manager, mergeSystem, b0)
      }
      step(1) // settle toward the next drop
    }

    console.log('TXLOG', JSON.stringify(mergeSystem.mergeTransactions.map((t) => ({ tx: t.tx, tier: t.tier, deferred: t.deferred, pendingMs: Math.round(t.pendingMs), emergency: t.emergency, overlapPx: Math.round(t.overlapPx) }))))
    expectTransactionsClean(mergeSystem)
    expect(mergeSystem.mergeTransactions.length).toBeGreaterThanOrEqual(2)
    // THE contract: every transaction resolves without ever waiting past the
    // aged backstop, and immediate (non-emergency) overlap commits obey the
    // no-swallow rule — neither center inside the other's envelope. Pathological
    // deep-jam cascades may use the aged guarantee; the merges the player
    // performs commit within a few frames.
    for (const t of mergeSystem.mergeTransactions) {
      expect(t.pendingMs).toBeLessThanOrEqual(MERGE.pendingEmergencyMs + 300)
      if (t.overlapPx > 0 && !t.emergency) {
        expect(t.overlapPx).toBeLessThanOrEqual(getTier(t.tier + 1)!.radius + 2)
      }
      // The merges the player performed (the dropped pairs) NEVER wait:
      // immediate or a brief retry — never the emergency deadline.
      if (pairIds.includes(t.aId) || pairIds.includes(t.bId)) {
        expect(t.pendingMs).toBeLessThanOrEqual(240)
        expect(t.emergency).toBe(false)
      }
    }
    const worst = Math.max(...mergeSystem.mergeTransactions.map((t) => t.pendingMs))
    expect(worst).toBeLessThanOrEqual(MERGE.pendingEmergencyMs + 300)
    expect(manager.getBalls().filter((x) => x.state === 'merging')).toHaveLength(0)
    expect(mergeSystem.pendingSnapshot().pending).toBe(0)
    physics.dispose()
  }, 240_000)

  it('a PHYSICALLY IMPOSSIBLE merge still defers briefly, keeps its sources, and resolves bounded (backstop intact)', () => {
    const { physics, manager, mergeSystem, stepFrame } = rig()
    void containerBounds()
    // Phase 2.15.0: full-density crush (no settle — see the 2.13.3 test
    // note): the pair merges while every ring candidate is still deeply
    // buried, so the transactional deferral path (sources retained, locked,
    // visible) MUST engage before the crush relaxes.
    fillImpossibleCrush(manager)
    manager.spawnBall(330, 1000, 5)
    manager.spawnBall(380, 1000, 5)

    let sawPendingWindow = false
    for (let i = 0; i < PHYSICS.stepHz * 10; i++) {
      const b0 = { count: manager.count, completed: mergeSystem.stats.mergesCompleted }
      stepFrame()
      expectAtomicFrame(manager, mergeSystem, b0)
      for (const t of mergeSystem.mergeTransactions) {
        if (t.outcome === 'pending') {
          sawPendingWindow = true
          expect(manager.getBallById(t.aId)).toBeDefined()
          expect(manager.getBallById(t.bId)).toBeDefined()
        }
      }
    }
    expect(sawPendingWindow).toBe(true)
    // Bounded resolution: retry commits the moment the overlap fits the
    // budget; the aged guarantee is the final backstop (~900ms + slop).
    for (const t of mergeSystem.mergeTransactions) {
      if (t.outcome === 'completed') {
        expect(t.pendingMs).toBeLessThanOrEqual(MERGE.pendingEmergencyMs + 300)
      }
    }
    expectTransactionsClean(mergeSystem)
    expect(manager.getBalls().filter((x) => x.state === 'merging')).toHaveLength(0)
    expect(mergeSystem.pendingSnapshot().pending).toBe(0)
    physics.dispose()
  }, 240_000)
})

describe('Phase 2.13.3: nearly full container — merges near the top and both walls never lose a ball', () => {
  function fillNearlyFull(manager: SoftBallManager): void {
    const rows = [1030, 950, 870, 790, 730]
    let k = 0
    for (let r = 0; r < rows.length; r++) {
      const y = rows[r]!
      const off = r % 2 === 0 ? 0 : 85
      for (let x = 235 + off; x <= 505 - off; x += 170) {
        manager.spawnBall(x, y, (k + r) % 2 === 0 ? 4 : 5)
        k++
      }
    }
  }

  /** Runs one crowded-merge case under the full atomicity invariant. */
  function runCrowdedCase(ax: number, ay: number, bx: number, by: number): {
    manager: SoftBallManager
    physics: PhysicsWorld
    mergeSystem: MergeSystem
  } {
    const { physics, manager, mergeSystem, step, stepFrame } = rig()
    void containerBounds()
    fillNearlyFull(manager)
    step(3) // settle
    manager.spawnBall(ax, ay, 5)
    manager.spawnBall(bx, by, 5)
    for (let i = 0; i < PHYSICS.stepHz * 10; i++) {
      const b0 = { count: manager.count, completed: mergeSystem.stats.mergesCompleted }
      stepFrame()
      expectAtomicFrame(manager, mergeSystem, b0)
    }
    // The pair merged (at least one merge completed beyond the settle-time
    // cascades — the two extra balls are gone and accounted for).
    expect(mergeSystem.stats.mergesCompleted).toBeGreaterThanOrEqual(1)
    expect(manager.getBalls().filter((x) => x.state === 'merging')).toHaveLength(0)
    // Phase 2.14.0: immediate overlap commits (the no-swallow rule) leave a
    // small resting interpenetration in a genuinely overpacked pile that
    // the soft solver takes a long time to fully squeeze out (the top row
    // drains over the open rim only slowly). 8px is still nothing like a
    // bury — the smallest ball here has a 62px radius.
    expect(worstPairOverlap(manager)).toBeLessThanOrEqual(8)
    return { manager, physics, mergeSystem }
  }

  it('merge near the TOP of a nearly full container (left side)', () => {
    const { physics } = runCrowdedCase(265, 790, 315, 785)
    physics.dispose()
  }, 240_000)

  it('merge near the TOP of a nearly full container (right side)', () => {
    const { physics } = runCrowdedCase(460, 790, 505, 785)
    physics.dispose()
  }, 240_000)

  it('crowded merge DEEP near the left wall, below the pile top', () => {
    const { physics } = runCrowdedCase(255, 950, 300, 950)
    physics.dispose()
  }, 240_000)

  it('crowded merge DEEP near the right wall, below the pile top', () => {
    const { physics } = runCrowdedCase(430, 950, 475, 950)
    physics.dispose()
  }, 240_000)
})

describe('Phase 2.13.4: REPEATED merges at the crowded top — every transaction resolves', () => {
  it('three consecutive top merges: sources stay in the world while pending; one replacement per transaction', () => {
    const { physics, manager, mergeSystem, step, stepFrame } = rig()
    void containerBounds()
    const rows = [1030, 950, 870, 790, 730]
    let k = 0
    for (let r = 0; r < rows.length; r++) {
      const y = rows[r]!
      const off = r % 2 === 0 ? 0 : 85
      for (let x = 235 + off; x <= 505 - off; x += 170) {
        manager.spawnBall(x, y, (k + r) % 2 === 0 ? 4 : 5)
        k++
      }
    }
    step(3) // settle (legitimate cascades allowed)

    // REPEATED merges near the top, alternating sides — each round drops a
    // touching tier-5 pair onto the crowded top of the pile.
    const rounds: Array<[number, number, number, number]> = [
      [265, 790, 315, 785],
      [460, 790, 505, 785],
      [300, 770, 345, 765],
    ]
    let roundsResolved = 0
    for (const [ax, ay, bx, by] of rounds) {
      const a = manager.spawnBall(ax, ay, 5)
      const b = manager.spawnBall(bx, by, 5)
      const mine = new Set([a.id, b.id])
      // Step until BOTH dropped balls have been consumed by merges (gone
      // from the world = merged away — removal and replacement are atomic,
      // so there is no other way for them to disappear).
      let consumed = false
      for (let i = 0; i < PHYSICS.stepHz * 8 && !consumed; i++) {
        const b0 = { count: manager.count, completed: mergeSystem.stats.mergesCompleted }
        stepFrame()
        expectAtomicFrame(manager, mergeSystem, b0)
        expectTransactionsClean(mergeSystem)
        // While ANY transaction is pending, its two sources are still in
        // the world (the renderer draws them — browser-verified isDrawn).
        for (const t of mergeSystem.mergeTransactions) {
          if (t.outcome === 'pending') {
            expect(manager.getBallById(t.aId)).toBeDefined()
            expect(manager.getBallById(t.bId)).toBeDefined()
          }
        }
        consumed = [...mine].every((id) => manager.getBallById(id) == null)
      }
      expect(consumed).toBe(true)
      // The round's balls each merged: at least one COMPLETED transaction
      // involving them, none still pending.
      const involving = mergeSystem.mergeTransactions.filter((t) => mine.has(t.aId) || mine.has(t.bId))
      expect(involving.length).toBeGreaterThanOrEqual(1)
      expect(involving.some((t) => t.outcome === 'completed' && t.replacementId != null)).toBe(true)
      expect(involving.some((t) => t.outcome !== 'completed')).toBe(false)
      roundsResolved++
      step(1.5) // settle before the next round
    }
    expect(roundsResolved).toBe(3)
    // Drain: merges may still be SAFELY PENDING at this point (sources
    // locked and visible — allowed by the contract). The emergency
    // fallback guarantees resolution, so drain bounded and then require a
    // fully quiescent final state.
    for (let i = 0; i < PHYSICS.stepHz * 4 && mergeSystem.pendingSnapshot().pending > 0; i++) {
      const b0 = { count: manager.count, completed: mergeSystem.stats.mergesCompleted }
      stepFrame()
      expectAtomicFrame(manager, mergeSystem, b0)
      expectTransactionsClean(mergeSystem)
    }
    // Final state: nothing mid-merge, nothing lost, nothing duplicated.
    expect(manager.getBalls().filter((x) => x.state === 'merging')).toHaveLength(0)
    expect(mergeSystem.pendingSnapshot().pending).toBe(0)
    expectTransactionsClean(mergeSystem)
    // Let the soft solver finish separating the last emergency-resolution
    // contacts (it needs a few awake frames), then require a clean pile.
    for (let i = 0; i < PHYSICS.stepHz * 3; i++) {
      const b0 = { count: manager.count, completed: mergeSystem.stats.mergesCompleted }
      stepFrame()
      expectAtomicFrame(manager, mergeSystem, b0)
    }
    // No-bury: every pair's centroids stay separated. Bar 0.55 — well above
    // the historic "second ball inside the merged ball" burial (0–0.3
    // separation), while tolerant of the deliberately OVERPACKED QA pile:
    // these jam spawns wedge balls together by design in a nearly full
    // container, and an emergency-resolution contact may stay compressed
    // until the player makes room. Strict no-bury for merge PLACEMENT
    // itself is unit-tested in merge-placement.test.ts.
    let worstSep = 1
    for (const A of manager.getBalls()) {
      for (const B of manager.getBalls()) {
        if (A === B) continue
        const ca = A.soft.center.position
        const cb = B.soft.center.position
        worstSep = Math.min(worstSep, Math.hypot(ca.x - cb.x, ca.y - cb.y) / (A.soft.radius + B.soft.radius))
      }
    }
    expect(worstSep).toBeGreaterThanOrEqual(0.55)
    physics.dispose()
  }, 240_000)
})
