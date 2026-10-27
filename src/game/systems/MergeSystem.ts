import * as Matter from 'matter-js'
import { isTransitionDefined, getTier } from '../../config/ballTiers'
import { containerBounds } from '../../config/container'
import { MERGE } from '../../config/merge'
import { SOFT, softBallCentroid } from './SoftBall'
import { placeMergedBall, MAX_PUSH } from './mergePlacement'
import type { PlacementObstacle, PlacementResult } from './mergePlacement'
import type { BallManager } from './BallManager'
import type { CollisionPair, PhysicsWorld } from './PhysicsWorld'
import type { SoftBallManager } from './SoftBallManager'
import type { ScoreSystem } from './ScoreSystem'
import { gameBus } from '../events/gameBus'

/** Callbacks the scene provides to drive visuals/audio for each merge. */
export interface MergeHooks {
  /** `seed` is the replacement ball's appearance seed — the discovery modal
   * and any per-merge visuals show the EXACT character that was spawned. */
  onMerge?: (tier: number, x: number, y: number, chainDepth: number, points: number, seed: number) => void
}

export interface MergeOutcome {
  tier: number
  x: number
  y: number
  chainDepth: number
  points: number
}

/**
 * Phase 2.13.4 DEV/QA record: ONE entry per ACCEPTED merge transaction —
 * from reservation to the replacement's creation (or the defensive drop).
 * Lets browser QA prove: every reserved pair produced exactly one
 * replacement, sources stayed visible while pending, and no transaction
 * was lost. `outcome` is live: 'pending' entries are still unresolved at
 * read time.
 */
export interface MergeTransactionRecord {
  /** Sequence id (monotonic across restarts). */
  tx: number
  /** SOURCE tier (the replacement is tier + 1). */
  tier: number
  aId: number
  bId: number
  /** Did the placement defer (sources stayed visible while pending)? */
  deferred: boolean
  /** Total pending duration (0 for immediate resolutions). */
  pendingMs: number
  /** Resolved via the aged-pending least-penetration fallback. */
  emergency: boolean
  /**
   * Phase 2.14.0: worst envelope overlap (px) at the replacement's spawn
   * spot. 0 = clear/strict placement; > 0 = an overlap commit (immediate
   * crowded commit within the budget, or the aged guarantee) that the
   * soft-body solver separates over the next frames.
   */
  overlapPx: number
  /** The replacement's ball id once spawned, else null. */
  replacementId: number | null
  outcome: 'pending' | 'completed' | 'dropped'
  startedAtSimMs: number
}

/** Phase 2.13.1 DEV/QA record: one completed merge's locality data. */
export interface MergeLocalityRecord {
  tier: number
  /** Source midpoint (clamped base) the merge happened at. */
  cx: number
  cy: number
  /** Where the replacement actually spawned. */
  x: number
  y: number
  /** Neighbors pushed aside (bounded clearance). Phase 2.13.3: with the
   * sources retained until resolution, a wedged pair's replacement claims
   * the pair's exact space — a crowded core can legitimately nudge a few
   * more neighbors than the old remove-first flow. The SAFETY bounds are
   * per-push magnitude (≤ MAX_PUSH, unit-enforced), never burying, and
   * ring locality — mirrored here as `maxPushPx`. */
  pushed: number
  /** Largest single neighbor displacement for this merge (px, ≤ 60). */
  maxPushPx: number
  deferredMs: number
  /** Phase 2.13.2: true when an aged pending resolved via the guaranteed
   * least-penetration overlap spot (never a lost replacement). */
  emergency: boolean
}

/** Minimal view of a logical ball for placement (both manager types). */
interface PlacementEntity {
  id: number
  body: Matter.Body
}

/**
 * A merge whose replacement could not yet be placed with GUARANTEED envelope
 * clearance (dense pile). Phase 2.13.3 (spec §1): BOTH source balls REMAIN
 * IN THE WORLD — visible, physically intact — while the placement is
 * retried. They are locked in 'merging' state (no other merge can take
 * them), and their bodies keep holding the pocket open, so a settling pile
 * can never close the space the replacement needs. When placement resolves,
 * the sources are removed and EXACTLY ONE replacement is created in the
 * SAME frame — a fully atomic transaction with no intermediate state where
 * balls are missing.
 */
interface PendingReplacement {
  tier: number
  aId: number
  bId: number
  /** Merge-time anchor (the live pair's midpoint is recomputed per retry). */
  cx: number
  cy: number
  avgVx: number
  avgVy: number
  /** Simulated time of the logical merge (deferral timeout accounting). */
  atSimMs: number
  /** Phase 2.13.4: the live transaction record (completed on resolution). */
  tx: MergeTransactionRecord
}

/**
 * Collision-driven merging (ARCHITECTURE.md §3.5) — Phase 2.10.2 ATOMIC
 * TRANSACTION semantics.
 *
 * Every merge is exactly: two active logical balls → one next-tier ball.
 *
 * Pipeline per frame (processMerges, called exactly once after step()):
 *  1. deferred replacements from earlier frames retry their placement,
 *  2. event-driven merges: collisionStart pairs, deduplicated by canonical
 *     logical pair key (many perimeter particles contacting the same
 *     neighbor in one step collapse to ONE logical contact),
 *  3. contact revalidation: currently-touching pairs (active Matter pairs)
 *     whose merge was blocked by the replacement cooldown merge as soon as
 *     the cooldown expires — no fresh collisionStart is required.
 *
 * Guards, in order, for every candidate pair: both logical balls exist,
 * are DISTINCT, lifecycle state 'active' (markMerging reserves the pair
 * IMMEDIATELY and idempotently — a ball can never join two merges), both
 * touched, same tier, transition defined, and neither ball is inside its
 * post-merge cooldown (the REPLACEMENT carries a per-ball cooldown —
 * unrelated pairs merge normally during it).
 *
 * Placement (Phase 2.10.0 anti-trap, 2.10.2 hardened): the replacement's
 * position is chosen by `placeMergedBall` AFTER the sources are removed,
 * against every remaining ball's DEFORMED collision envelope plus the floor
 * and both slanted walls. Neighbors are pushed exactly to envelope
 * clearance (bounded, velocity-preserving); if clearance cannot be
 * guaranteed the replacement is DEFERRED — never buried inside another ball.
 *
 * Chain scoring is unchanged: chain depth escalates when merges happen
 * within `MERGE.chainWindowMs` of simulated time.
 */
export class MergeSystem {
  private merging = false
  private lastMergeSimMs: number | null = null
  private chainDepth = 0
  /** Per-ball merge cooldown (simulated ms deadline), replacements only. */
  private readonly cooldownUntil = new Map<number, number>()
  /** Matter body ids owned by balls removed in a merge — event lookups that
   * hit these are stale duplicates (the pair is already merged) and are
   * counted in diagnostics. Cleared on resetChain. */
  private readonly removedBodyIds = new Set<number>()
  /** Merges whose replacement awaits a guaranteed-clear placement. */
  private readonly pending: PendingReplacement[] = []
  /**
   * Phase 2.13.4 QA log (read-only): one record per accepted merge
   * transaction, from reservation to replacement creation. Capped; cleared
   * on resetChain. Ids stay monotonic across clears.
   */
  readonly mergeTransactions: MergeTransactionRecord[] = []
  private txSeq = 0
  /** Phase 2.10.2 lifecycle diagnostics (read-only, QA + tests). */
  readonly stats = {
    mergesCompleted: 0,
    sourcesRemoved: 0,
    replacementsCreated: 0,
    duplicateEventsRejected: 0,
    deferredReplacements: 0,
    lastBallsBefore: 0,
    lastBallsAfter: 0,
  }

  /**
   * Phase 2.13.1 QA record (read-only): the last ~24 completed merges'
   * locality data — source midpoint vs actual replacement position and the
   * bounded-neighbor-push count. Browser QA verifies |placement − midpoint|
   * stays local across real (chaotic, cascading) gameplay.
   */
  readonly lastMerges: MergeLocalityRecord[] = []

  /**
   * Phase 2.13.3 DEV/QA hook (read-only): LIVE pending-merge state — how
   * many deferred merges are awaiting a valid local position, and which
   * balls are locked 'merging' (their sources are still in the world and
   * rendered until the replacement exists).
   */
  pendingSnapshot(): { pending: number; mergingIds: number[] } {
    const soft = this.balls as SoftBallManager
    const mergingIds =
      typeof soft.getBalls === 'function'
        ? soft.getBalls().filter((e) => e.state === 'merging').map((e) => e.id)
        : []
    return { pending: this.pending.length, mergingIds }
  }

  constructor(
    private readonly balls: BallManager | SoftBallManager,
    private readonly physicsWorld: PhysicsWorld,
    private readonly score: ScoreSystem,
    private readonly hooks: MergeHooks = {},
  ) {}

  /** Process collision events; returns list of merge results.
   * `events` may be pre-drained by the scene (so visual impact feeding can
   * share the same per-frame queue); when omitted, drains internally. */
  processMerges(events?: CollisionPair[]): MergeOutcome[] {
    if (this.merging) return []
    this.merging = true
    try {
      const outcomes: MergeOutcome[] = []
      // 1. Deferred replacements first — the pile has had another frame to
      // relax; retry their placement before anything else merges.
      outcomes.push(...this.processDeferred())
      // 2. Event-driven merges (collisionStart of this frame).
      outcomes.push(...this.processMergesInner(events ?? this.physicsWorld.takeCollisionEvents()))
      // 3. Contact revalidation: still-touching pairs (cooldown expiry,
      // reserved-ball misses) merge without needing a new collisionStart.
      outcomes.push(...this.revalidateContacts())
      return outcomes
    } finally {
      this.merging = false
    }
  }

  /** Canonical logical pair key (order-independent). */
  private static pairKey(aId: number, bId: number): string {
    return aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`
  }

  private cooldownOk(id: number): boolean {
    const until = this.cooldownUntil.get(id)
    return until == null || this.physicsWorld.simTimeMs >= until
  }

  /**
   * The full merge transaction for one candidate pair. Returns the outcome,
   * or null when the pair is not eligible (reason counted in diagnostics).
   * Reserve → validate → remove sources → place → create EXACTLY one
   * replacement (+ renderer via the scene's registration sync).
   */
  private tryMerge(a: PlacementEntity & { touched: boolean; tier: number }, b: PlacementEntity & { touched: boolean; tier: number }): MergeOutcome | null {
    if (a === b || a.id === b.id) {
      this.stats.duplicateEventsRejected++
      return null
    }
    const ea = this.balls.getBallById(a.id)
    const eb = this.balls.getBallById(b.id)
    if (!ea || !eb || ea.state !== 'active' || eb.state !== 'active') {
      // Already merging or removed — a duplicate event for the same logical
      // balls (multiple perimeter particles, or a revalidated pair).
      this.stats.duplicateEventsRejected++
      return null
    }
    if (!ea.touched || !eb.touched) return null // airborne drops never merge
    if (ea.tier !== eb.tier) return null // different tiers never merge
    if (!this.cooldownOk(ea.id) || !this.cooldownOk(eb.id)) return null
    const tier = ea.tier
    if (!isTransitionDefined(tier + 1)) {
      // Reserved-tier hold (GAME_SPEC §3): two tier-7 balls stay as-is.
      // Documented temporary behavior. Revisit when the user enables 8+.
      return null
    }

    // RESERVE both sources atomically: if either ball fails reservation
    // (e.g. already reserved in a concurrent 3-way collision race),
    // the first ball is immediately rolled back to 'active' to prevent ghost balls.
    const reservedA = this.reserve(ea)
    if (!reservedA) {
      this.stats.duplicateEventsRejected++
      return null
    }
    const reservedB = this.reserve(eb)
    if (!reservedB) {
      this.unreserve(ea)
      this.stats.duplicateEventsRejected++
      return null
    }

    // Phase 2.13.4: open the transaction record the moment the pair is
    // reserved (the browser QA log proves every reserved pair produces
    // exactly one replacement — or stays safely pending with its sources
    // visible).
    const tx: MergeTransactionRecord = {
      tx: ++this.txSeq,
      tier,
      aId: ea.id,
      bId: eb.id,
      deferred: false,
      pendingMs: 0,
      emergency: false,
      overlapPx: 0,
      replacementId: null,
      outcome: 'pending',
      startedAtSimMs: this.physicsWorld.simTimeMs,
    }
    this.mergeTransactions.push(tx)
    if (this.mergeTransactions.length > 32) this.mergeTransactions.shift()

    // Source midpoint + preserved average motion.
    const ca = this.centroidOf(ea)
    const cb = this.centroidOf(eb)
    const cx = (ca.x + cb.x) / 2
    const cy = (ca.y + cb.y) / 2
    const avgVx = (ea.body.velocity.x + eb.body.velocity.x) / 2
    const avgVy = (ea.body.velocity.y + eb.body.velocity.y) / 2

    // Phase 2.13.3 (spec §1) TRANSACTIONAL ORDER: find a valid nearby
    // position BEFORE removing the sources. The placement search never sees
    // the two reserved sources as obstacles ('merging' state — they are
    // about to vanish, their envelopes must not block the replacement). On
    // success the sources leave the world and the replacement spawns in the
    // SAME frame — no pending window at all. Phase 2.14.0: the immediate
    // overlap budget means crowded merges commit on this very frame at a
    // solver-separable spot; only genuinely buried placements defer (sources
    // STAY — visible, locked against every other merge — and the placement
    // is retried each frame until it fits or the aged guarantee fires).
    const placement = this.computePlacement(tier, cx, cy, new Set([ea.id, eb.id]), false)
    if (placement == null) {
      // No guaranteed-clear position yet: keep BOTH sources in the world
      // (nothing disappears) and retry next frame. The pair resolves
      // atomically — removeSources + spawn in ONE frame — the moment a
      // valid local position exists, and ALWAYS (aged pendings fall back to
      // the least-penetrating local spot).
      tx.deferred = true
      this.pending.push({ tier, aId: ea.id, bId: eb.id, cx, cy, avgVx, avgVy, atSimMs: this.physicsWorld.simTimeMs, tx })
      this.stats.deferredReplacements++
      return null
    }
    this.removeSources(ea, eb)
    return this.commitPlacement(tier, placement, cx, cy, avgVx, avgVy, undefined, tx)
  }

  /** Remove both merge sources atomically (composites, constraints, all). */
  private removeSources(
    ea: PlacementEntity & { touched: boolean; tier: number },
    eb: PlacementEntity & { touched: boolean; tier: number },
  ): void {
    // Record every removed body id first: collision events still referencing
    // these bodies (same-frame duplicates, re-drained queues) are stale and
    // must spawn nothing.
    const soft = this.balls as SoftBallManager
    for (const src of [ea, eb]) {
      const entity = soft.getBallById?.(src.id)
      if (entity && 'soft' in entity) {
        for (const p of entity.soft.particles) this.removedBodyIds.add(p.id)
        this.removedBodyIds.add(entity.soft.center.id)
      } else {
        this.removedBodyIds.add(src.body.id)
      }
    }
    this.balls.removeBall(ea.id)
    this.balls.removeBall(eb.id)
    this.stats.sourcesRemoved += 2
    this.stats.lastBallsBefore = this.balls.count + 2
  }

  /** Reserve a ball for merging (active → merging, idempotent-first-wins). */
  private reserve(e: { id: number } | undefined): boolean {
    const soft = this.balls as SoftBallManager
    if (typeof soft.markMerging === 'function') return soft.markMerging(e!.id)
    return true // legacy rigid manager: no lifecycle states
  }

  /** Rollback reservation when paired source reservation fails. */
  private unreserve(e: { id: number } | undefined): void {
    const soft = this.balls as SoftBallManager
    if (typeof soft.rollbackMerging === 'function') soft.rollbackMerging(e!.id)
  }

  private centroidOf(ball: PlacementEntity): { x: number; y: number } {
    const soft = this.balls as SoftBallManager
    const c = soft.centroid?.(ball.id)
    if (c && (c.x !== 0 || c.y !== 0)) return c
    return ball.body.position
  }

  /**
   * Phase 2.13.2 (spec §1): compute the replacement placement for a merge of
   * `tier` sources near (cx, cy). `exclude` omits ids that must not count as
   * obstacles (the two reserved sources of a fresh merge — they are about to
   * vanish). Returns null when the placement must be deferred (caller
   * anchors the pending replacement at the merge location and retries).
   *
   * Phase 2.14.0 (spec §1 — MERGE DELAY): `aged` selects the overlap
   * policy. Aged pendings get 'always' (the guaranteed least-penetration
   * commit — the 2.13.2 merge-loss backstop). Fresh merges and retries get
   * 'bounded' (the no-swallow rule: commit the moment neither center would
   * enter the other's envelope). Normal crowded merges therefore commit on
   * the SAME frame instead of waiting for the emergency deadline; only
   * genuinely buried placements defer.
   */
  private computePlacement(
    tier: number,
    cx: number,
    cy: number,
    exclude: Set<number>,
    aged: boolean,
  ): PlacementResult | null {
    const rNew = getTier(tier + 1)!.radius
    const pairs = this.balls
      .getBalls()
      .filter((e) => e.state === 'active' && !exclude.has(e.id))
      .map((e) => ({ entity: e as unknown as PlacementEntity, obstacle: this.envelopeOf(e as unknown as PlacementEntity) }))
    const obstacles = pairs.map((p) => p.obstacle)
    // The placement search works on the full collision envelope (radius +
    // contact skin) so the rendered ball also clears its neighbors. Phase
    // 2.13.1: NO age-based push loosening — pushes stay bounded at
    // MAX_PUSH; a packed pile defers (with the area woken so it genuinely
    // relaxes) until bounded clearance is possible, and aged pendings fall
    // back to the guaranteed local emergency spot (2.13.2).
    const placement = placeMergedBall(
      cx,
      cy,
      rNew + SOFT.contactSkin,
      obstacles,
      containerBounds(),
      MAX_PUSH,
      { overlap: aged ? 'always' : 'bounded' },
    )
    if (placement.deferred) {
      // Wake the merge area so a sleeping pile actually relaxes and the
      // deferred retry finds space (otherwise a settled pile never changes
      // and the replacement would stall).
      const softMgr0 = this.balls as SoftBallManager
      softMgr0.wakeNear?.(cx, cy, rNew + 80)
      return null
    }

    // Controlled neighbor clearance BEFORE the replacement exists — the
    // new ball never spawns inside another ball, not even partially.
    for (const d of placement.displaced) {
      const hit = pairs.find((p) => p.obstacle === d.obstacle)
      if (hit) this.displaceBall(hit.entity, d.dx, d.dy)
    }
    return placement
  }

  /** Spawn the replacement at a computed placement + score/record/effects. */
  private commitPlacement(
    tier: number,
    placement: PlacementResult,
    cx: number,
    cy: number,
    avgVx: number,
    avgVy: number,
    mergedAtSimMs: number | undefined,
    tx?: MergeTransactionRecord,
  ): MergeOutcome {
    const rNew = getTier(tier + 1)!.radius

    // Spawn EXACTLY ONE replacement and give it the parents' average velocity.
    const nb = this.balls.spawnBall(placement.x, placement.y, tier + 1, true)
    Matter.Body.setVelocity(nb.body, { x: avgVx, y: avgVy })
    // Per-replacement merge cooldown: no same-step chain merges.
    this.cooldownUntil.set(nb.id, this.physicsWorld.simTimeMs + MERGE.mergeCooldownMs)
    // Wake the balls around the insertion (removeBall already woke the
    // area around the sources; this covers the displacement zone) — and,
    // for the emergency overlap spot, so the contact solver actively
    // separates the touching balls over the next frames.
    const softMgr = this.balls as SoftBallManager
    softMgr.wakeNear?.(placement.x, placement.y, rNew)

    // Chain depth: consecutive merges within the window escalate.
    const nowSimMs = this.physicsWorld.simTimeMs
    this.chainDepth =
      this.lastMergeSimMs != null && nowSimMs - this.lastMergeSimMs <= MERGE.chainWindowMs
        ? this.chainDepth + 1
        : 1
    this.lastMergeSimMs = nowSimMs

    const points = this.score.award(tier + 1, this.chainDepth)
    this.stats.mergesCompleted++
    this.stats.replacementsCreated++
    this.stats.lastBallsAfter = this.balls.count
    const emergency =
      placement.squeezed === false && placement.displaced.length === 0 && mergedAtSimMs != null && nowSimMs - mergedAtSimMs >= MERGE.pendingEmergencyMs
    // Phase 2.13.4: close the transaction record — exactly one replacement,
    // created now, from this pair.
    if (tx) {
      tx.outcome = 'completed'
      tx.replacementId = nb.id
      tx.pendingMs = Math.max(0, nowSimMs - tx.startedAtSimMs)
      tx.emergency = emergency
      tx.overlapPx = placement.overlapPx
    }
    // Phase 2.13.1 QA locality record (bounded ring, capped list). Phase
    // 2.13.2: `emergency` marks the guaranteed-resolution overlap spawn.
    this.lastMerges.push({
      tier: tier + 1,
      cx,
      cy,
      x: placement.x,
      y: placement.y,
      pushed: placement.displaced.length,
      maxPushPx: placement.displaced.reduce((m, d) => Math.max(m, Math.hypot(d.dx, d.dy)), 0),
      deferredMs: mergedAtSimMs != null ? Math.max(0, nowSimMs - mergedAtSimMs) : 0,
      emergency,
    })
    if (this.lastMerges.length > 24) this.lastMerges.shift()
    // Effects fire at the ACTUAL replacement position (the midpoint can be
    // displaced in a dense pile — the popup must match the new ball). The
    // soft-body entity carries the appearance seed (the legacy rigid Ball
    // does not — production always runs the soft-body manager).
    this.hooks.onMerge?.(tier + 1, placement.x, placement.y, this.chainDepth, points, 'seed' in nb ? nb.seed : 0)
    gameBus.emit('fx:merge', { tier: tier + 1, x: placement.x, y: placement.y, chainDepth: this.chainDepth })

    return { tier: tier + 1, x: placement.x, y: placement.y, chainDepth: this.chainDepth, points }
  }

  /**
   * Retry deferred merges against the CURRENT pile state. Phase 2.13.3
   * (spec §1): both sources are still in the world (locked 'merging'),
   * holding the pocket open. Each retry recomputes the live pair midpoint,
   * then — the moment a valid local position exists — removes BOTH sources
   * and creates EXACTLY ONE replacement in the SAME frame (atomic: there is
   * never a frame where the merge's balls are missing). A pending older
   * than MERGE.pendingEmergencyMs switches to the guaranteed-resolution
   * emergency mode (least-penetrating LOCAL spot — with the sources excluded
   * that is their own pocket — and the soft solver separates).
   */
  private processDeferred(): MergeOutcome[] {
    const outcomes: MergeOutcome[] = []
    if (this.pending.length === 0) return outcomes
    const stillPending: PendingReplacement[] = []
    for (const p of this.pending) {
      const softMgr = this.balls as SoftBallManager
      const a = softMgr.getBallById?.(p.aId)
      const b = softMgr.getBallById?.(p.bId)
      if (!a || !b || a.state === 'removed' || b.state === 'removed') {
        // Unreachable in production: only restart/removal clears balls, and
        // the same flow clears `pending`. Defensive: a stale entry can never
        // produce a lost replacement — it is dropped without spawning.
        p.tx.outcome = 'dropped'
        continue
      }
      // Live midpoint: the still-present pair may have settled slightly —
      // the replacement must follow the ACTUAL merge location.
      const ca = this.centroidOf(a as never)
      const cb = this.centroidOf(b as never)
      const cx = (ca.x + cb.x) / 2
      const cy = (ca.y + cb.y) / 2
      const age = Math.max(0, this.physicsWorld.simTimeMs - p.atSimMs)
      // Phase 2.14.0: retries use the IMMEDIATE budget (commit the moment a
      // solver-separable spot exists); only aged pendings get the Infinity
      // guarantee. Deferrals are therefore brief and rare.
      const placement = this.computePlacement(
        p.tier,
        cx,
        cy,
        new Set([p.aId, p.bId]),
        age >= MERGE.pendingEmergencyMs,
      )
      if (!placement) {
        stillPending.push(p)
        continue
      }
      // ATOMIC resolution: both sources leave the world and exactly one
      // replacement takes their place — same frame, no gap.
      this.removeSources(a as never, b as never)
      outcomes.push(this.commitPlacement(p.tier, placement, cx, cy, p.avgVx, p.avgVy, p.atSimMs, p.tx))
    }
    this.pending.length = 0
    this.pending.push(...stillPending)
    return outcomes
  }

  /**
   * Collision-envelope center + radius of a remaining ball (works for both
   * the soft-body manager and the legacy rigid manager). Phase 2.10.2: the
   * soft envelope uses the DEFORMED particle cloud (max particle distance
   * from the centroid + particle body radius + contact skin) — a squeezed
   * ball bulges beyond its nominal radius, and placement must clear the
   * ACTUAL body, not the ideal circle.
   */
  private envelopeOf(e: PlacementEntity): PlacementObstacle {
    const soft = this.balls as SoftBallManager
    const entity = soft.getBallById?.(e.id)
    if (entity && 'soft' in entity) {
      const s = entity.soft
      const c = softBallCentroid(s)
      let maxD = 0
      for (const p of s.particles) {
        const d = Math.hypot(p.position.x - c.x, p.position.y - c.y)
        if (d > maxD) maxD = d
      }
      const pr = s.radius * SOFT.particleRadiusFactor
      return { x: c.x, y: c.y, r: maxD + pr + SOFT.contactSkin }
    }
    const rigid = e.body
    return { x: rigid.position.x, y: rigid.position.y, r: rigid.circleRadius ?? 38 }
  }

  /** Velocity-preserving push for a displaced neighbor (both manager types). */
  private displaceBall(e: PlacementEntity, dx: number, dy: number): void {
    const soft = this.balls as SoftBallManager
    if (typeof soft.translateBall === 'function') {
      soft.translateBall(e.id, dx, dy)
      return
    }
    Matter.Body.translate(e.body, { x: dx, y: dy })
  }

  private processMergesInner(events: CollisionPair[]): MergeOutcome[] {
    const outcomes: MergeOutcome[] = []
    const attempted = new Set<string>()

    for (const { bodyA, bodyB } of events) {
      const a = this.balls.getBallByBodyId(bodyA.id)
      const b = this.balls.getBallByBodyId(bodyB.id)
      // A null lookup means a non-ball or a body whose ball was already
      // removed this frame (stale event — spawn nothing).
      if (!a || !b) {
        if (this.removedBodyIds.has(bodyA.id) || this.removedBodyIds.has(bodyB.id)) {
          this.stats.duplicateEventsRejected++
        }
        continue
      }
      const key = MergeSystem.pairKey(a.id, b.id)
      if (a === b) {
        this.stats.duplicateEventsRejected++
        continue
      }
      if (attempted.has(key)) {
        // Many perimeter particles of the same two logical balls contacted
        // during one physics step: ONE logical contact, one merge attempt.
        this.stats.duplicateEventsRejected++
        continue
      }
      attempted.add(key)
      const outcome = this.tryMerge(a as never, b as never)
      if (outcome) outcomes.push(outcome)
    }

    return outcomes
  }

  /**
   * Revalidate CURRENT contact state: Matter's active pair list contains
   * every still-touching body pair, including pairs whose collisionStart was
   * rejected by the replacement cooldown (the bodies never separated, so no
   * new event will fire). Eligible same-tier pairs merge here — the frame
   * the cooldown expires. Duplicate attempts within one call are deduped by
   * the canonical pair key.
   */
  private revalidateContacts(): MergeOutcome[] {
    const outcomes: MergeOutcome[] = []
    const attempted = new Set<string>()
    for (const { bodyA, bodyB } of this.physicsWorld.activeBallPairs()) {
      const a = this.balls.getBallByBodyId(bodyA.id)
      const b = this.balls.getBallByBodyId(bodyB.id)
      if (!a || !b || a === b) continue
      const key = MergeSystem.pairKey(a.id, b.id)
      if (attempted.has(key)) continue
      attempted.add(key)
      const outcome = this.tryMerge(a as never, b as never)
      if (outcome) outcomes.push(outcome)
    }
    return outcomes
  }

  /** Reset chain tracking and all per-run merge state (restart flow).
   * Phase 2.10.2: the lifecycle counters are PER-RUN — restart zeroes them
   * together with the cooldown map and pending replacements, so QA can
   * verify each run's merge behavior independently. */
  resetChain(): void {
    this.lastMergeSimMs = null
    this.chainDepth = 0
    this.cooldownUntil.clear()
    this.removedBodyIds.clear()
    this.pending.length = 0
    this.mergeTransactions.length = 0
    this.stats.mergesCompleted = 0
    this.stats.sourcesRemoved = 0
    this.stats.replacementsCreated = 0
    this.stats.duplicateEventsRejected = 0
    this.stats.deferredReplacements = 0
    this.stats.lastBallsBefore = 0
    this.stats.lastBallsAfter = 0
    this.lastMerges.length = 0
  }
}
