import * as Matter from 'matter-js'
import {
  createSoftBall,
  addToWorld,
  removeFromWorld,
  applyPressure,
  clampSoftBallSpeed,
  softBallArea,
  softBallCentroid,
  softBallSpeed,
  softBallMaxSpeed,
  softBallSleeping,
  SOFT,
} from './SoftBall'
import { CONTAINER, containerBounds, clampBallInside, interiorCorners } from '../../config/container'
import { GAME_OVER } from '../../config/gameOver'
import type { SoftBall } from './SoftBall'

export type SoftBallState = 'active' | 'merging' | 'removed'

/** Logical game ball backed by a Matter-native soft-body composite. */
export interface SoftBallEntity {
  id: number
  tier: number
  /** Deterministic appearance seed — the SAME seed drives the preview and
   * crane character through BallAppearance (Phase 2.11.0 shared source). */
  seed: number
  /** The center particle — a stable representative body for velocity reads. */
  body: Matter.Body
  composite: Matter.Composite
  soft: SoftBall
  state: SoftBallState
  /** Merge eligibility: true after the first physical contact (Phase 2.4 rule). */
  touched: boolean
}

/**
 * Logical ball registry for production soft-body balls (Phase 2.9).
 * Mirrors the BallManager API so MergeSystem/scene code maps 1:1:
 *  - each logical ball owns ONE Matter.Composite (16 particles + center +
 *    rim/spoke/brace constraints) — removed atomically on merge/restart;
 *  - `getBallByBodyId` routes any particle body id to its logical ball;
 *  - particles never self-collide (negative group in SoftBall) so a ball
 *    cannot merge with itself.
 *
 * Phase 2.9.8 CONTACT OWNERSHIP: Matter's own contact solver owns ball/ball
 * and ball/wall separation (collision surfaces touch at the nominal radius,
 * rendered contour stays inside the collision envelope). The custom passes
 * below are bounded backstops only:
 *  - `separateContacts` polishes residual overlap Matter can leave after
 *    fast impacts, with small relaxed corrections (≤ separationCap px per
 *    pair per iteration) — never the 15px teleports that crumpled rings and
 *    fought the constraint network;
 *  - `clampToContainer` is a radius-aware geometric backstop for walls.
 * Resting state is whole-ball coherent: a quiet touched ball sleeps as ONE
 * unit (Matter treats sleeping bodies as static until hit by a moving body).
 */
export class SoftBallManager {
  private balls: SoftBallEntity[] = []
  private nextId = 1
  /** particle/center body id → logical ball id */
  private readonly bodyOwners = new Map<number, number>()
  /** Per-ball sustained-quiet counters (whole-ball resting state). */  private readonly restCounters = new Map<number, number>()
  /** Consecutive fast-gate substeps per ball (war surrender, Phase 2.10.0). */
  private readonly restWar = new Map<number, number>()
  /** Rest-window anchor: centroid x when the window began. */
  private readonly restAnchorX = new Map<number, number>()
  /** Rest-window anchor: centroid y when the window began. */
  private readonly restAnchorY = new Map<number, number>()
  /** Rest-gate diagnostics: which condition last reset the window. */
  private readonly restLastReset = new Map<number, string>()
  /** Balls whose rest window completed; frozen by commitRest() after the
   * correction chain (so they freeze clamped and repaired). */
  private readonly pendingSleep = new Set<number>()
  /** Balls currently under war-surrender amnesty (diagnostics + verify:
   * their area reflects the wedged standing-wave state, not a calm settled
   * load response — QA load observations must skip them). */
  private readonly warSurrendered = new Set<number>()
  /** Diagnostics: max separation correction applied in the last call (px). */
  lastSeparationCorrection = 0
  /** Phase 2.21 diagnostics: wall-clock cost of the last pass run (ms).
   * Set by the scene's instrumentation wrappers (see PlaygroundScene). */
  lastStepAllMs = 0
  lastSeparateMs = 0
  lastExpandMs = 0
  lastClampMs = 0
  /**
   * Phase 2.21 — REUSED hot-path buffers (zero allocations per substep in
   * steady state):
   *  - `sepMoved`: wake set for separateContacts (was `new Set` per call —
   *    8 iterations × 120 calls/s = ~960 Set allocations/s)
   *  - `nearParticles`: pooled foreign-particle candidate slots for
   *    expandShape's ray-clamp (was a fresh `{x,y,r}` object per foreign
   *    particle per ball per substep)
   *  - `asleepScratch` / `reachSqScratch`: per-call broad-phase sleep
   *    flags and pairwise squared-reach matrix
   *  - `centroidScratch`: reused out-vector for softBallCentroid
   */
  private readonly sepMoved = new Set<number>()
  private readonly nearParticles: Array<{ x: number; y: number; r: number }> = []
  private readonly centroidScratch: Matter.Vector = { x: 0, y: 0 }
  /** Per-call scratch: pairwise squared reach matrix + sleep flags. */
  private readonly asleepScratch: boolean[] = []
  private readonly reachSqScratch: number[] = []
  /** Diagnostics: max boundary-clamp correction applied in the last
   * clampToContainer call (px). Wall-jitter instrumentation (Phase 2.10.2). */
  lastClampCorrection = 0
  /** Phase 2.10.1: current Y of the wall TOPS (scene feeds it every frame
   * from the live Raise Walls height). Side-wall containment in
   * clampToContainer applies only BELOW this line — above it is open sky.
   * `null` (headless rigs) = extrapolated funnel clamp at every height. */
  wallTopY: number | null = null
  /** When true (Shake ability active), escape is fully disabled: balls cannot fall out. */
  shakeActive = false

  private physics: { registerComposite(c: Matter.Composite): void; unregisterComposite(c: Matter.Composite): void } | null = null

  constructor(private readonly world: Matter.World) {}

  /** PERF wiring: keep the body cache in PhysicsWorld in sync with soft-ball
   * composites (they bypass addBody/removeBody). No-op when unset (tests). */
  setPhysics(physics: { registerComposite(c: Matter.Composite): void; unregisterComposite(c: Matter.Composite): void }): void {
    this.physics = physics
  }

  get count(): number {
    return this.balls.length
  }

  /** Read-only copy of the live entities (perf overlay / QA iteration). */
  snapshot(): SoftBallEntity[] {
    return this.balls.slice()
  }

  getBalls(): readonly SoftBallEntity[] {
    return this.balls
  }

  getBallById(id: number): SoftBallEntity | undefined {
    return this.balls.find((b) => b.id === id)
  }

  getBallByBodyId(bodyId: number): SoftBallEntity | undefined {
    const ownerId = this.bodyOwners.get(bodyId)
    return ownerId != null ? this.getBallById(ownerId) : undefined
  }

  /** Centroid of a logical ball (particles + center average). */
  centroid(id: number): Matter.Vector {
    const ball = this.getBallById(id)
    if (!ball) return { x: 0, y: 0 }
    return softBallCentroid(ball.soft)
  }

  /** Aggregate speed — settle checks and diagnostics. */
  speed(id: number): number {
    const ball = this.getBallById(id)
    return ball ? softBallSpeed(ball.soft) : 0
  }

  /** Live area / rest area — compression diagnostics. */
  areaRatio(id: number): number {
    const ball = this.getBallById(id)
    if (!ball) return 1
    return softBallArea(ball.soft) / ball.soft.restArea
  }

  /** True when the whole logical ball is coherently sleeping. */
  isSettled(id: number): boolean {
    const ball = this.getBallById(id)
    return ball != null && softBallSleeping(ball.soft)
  }

  /**
   * Rest-gate diagnostics for one ball (dev telemetry): the current rest
   * counter and which gate condition last reset the window. Read-only.
   */
  restDebug(id: number): { counter: number; lastReset: string; war: number; surrendered: boolean } {
    const counter = this.restCounters.get(id) ?? 0
    return {
      counter,
      lastReset: this.restLastReset.get(id) ?? 'n/a',
      war: this.restWar.get(id) ?? 0,
      surrendered: this.warSurrendered.has(id),
    }
  }

  /**
   * Wake one logical ball coherently (all bodies), clearing its quiet
   * window. Called by every subsystem that genuinely disturbs the ball and
   * by stepAll's partial-wake repair — wakes unconditionally, so a ball can
   * never stay stuck half-frozen (measured: 13/16 particle partial-sleep
   * states persisting because the old version only woke fully-sleeping
   * balls).
   */
  wakeBall(id: number, preserveRest = false): void {
    const ball = this.getBallById(id)
    if (!ball) return
    this.onBallWake?.(id)
    // Was the ball actually ASLEEP? Only a genuine disturbance (a ball
    // that was resting and is now moved) should clear the war-surrender
    // evidence. Waking an already-awake ball must NOT wipe it: the war
    // counter is the ONLY escape for a ball that is permanently fast
    // (a standing solver war), and the Raise Walls path wakes the rim
    // band on every animation frame — wiping the counter there meant a
    // ball in the band could never surrender and churned at the speed
    // cap forever (measured: war counter oscillating 106..480, the
    // ball never sleeping).
    //
    // `preserveRest` is for the PARTIAL-WAKE REPAIR (a ball with some
    // bodies asleep and some awake). That is not a disturbance — it is
    // Matter's per-body auto-wake inside a standing war — so the quiet
    // window must survive, or the ball can never complete it and the
    // cycle repeats forever.
    const wasSleeping = softBallSleeping(ball.soft)
    if (!preserveRest) {
      this.restCounters.set(id, 0)
      if (wasSleeping) {
        this.restWar.delete(id)
        this.warSurrendered.delete(id)
      }
      this.restLastReset.set(id, 'woken')
      this.restAnchorY.delete(id)
      this.restAnchorX.delete(id)
      this.pendingSleep.delete(id)
    }
    for (const p of ball.soft.particles) Matter.Sleeping.set(p, false)
    Matter.Sleeping.set(ball.soft.center, false)
  }

  /**
   * Ensure a ball is awake without resetting an awake ball's quiet window.
   * The contact backstop's routine equilibrium corrections (which fire every
   * substep in a settled pile — measured) must NOT count as disturbances:
   * they are part of the standing solver balance, exactly like Matter's own
   * contact corrections. Only a SLEEPING ball being moved is a real event.
   */
  private ensureAwake(id: number): void {
    const ball = this.getBallById(id)
    if (!ball || !softBallSleeping(ball.soft)) return
    // A ball that has already SURRENDERED (it is in a standing solver
    // war) keeps its rest window: the equilibrium corrections that wake
    // it are part of the standing balance, not a disturbance, so wiping
    // the window would restart the quiet countdown forever.
    this.wakeBall(id, this.warSurrendered.has(id))
  }

  /** Wake every ball (support changed globally: walls moved). */
  wakeAll(): void {
    for (const ball of this.balls) this.wakeBall(ball.id)
  }

  /** PERF: wake only balls whose centroid is inside the rim's swept
   * band — the Raise Walls ability moves only the wall TOPS; balls
   * resting on the floor/lower walls are untouched by the motion.
   *
   * The band is the region the wall TOP sweeps THROUGH: between the
   * raised rim and the normal rim (plus a margin for the ball's radius).
   * A ball BELOW that region is resting on the floor or the lower wall,
   * which do not move, so it must keep sleeping.
   *
   * The old test was `c.y >= bandTop` with
   * bandTop = min(raisedTop, normalTop, currentTopY) - margin — the
   * HIGHEST point of the sweep, minus the margin. On a phone that put
   * the band at y >= 445, and a ball resting on the floor sits at
   * y ~ 1041 — so EVERY ball in the pile was woken on EVERY frame of the
   * animation. The pile could never settle, and the physics ran at full
   * cost for the whole 1.8 s. That was the wall raise's real lag.
   *
   * The correct test is the region BETWEEN the two rims: a ball is in
   * the band when it is at or above the LOWER rim (the normal one, since
   * y grows downward) and at or below the HIGHER one (the raised one).
   */
  wakeNearRimBand(currentTopY: number): void {
    const margin = 80
    const raisedTop = CONTAINER.raisedHeight !== undefined
      ? interiorCorners(CONTAINER.raisedHeight).topLeft.y
      : currentTopY
    const normalTop = interiorCorners().topLeft.y
    // The swept region: from the higher rim (the raised one, smaller y)
    // down to the lower rim (the normal one) — plus a margin so a ball
    // whose edge the rim is about to reach is woken too.
    const bandTop = Math.min(raisedTop, normalTop) - margin
    const bandBottom = Math.max(raisedTop, normalTop) + margin
    for (const ball of this.balls) {
      const c = softBallCentroid(ball.soft, this.centroidScratch)
      if (c.y >= bandTop && c.y <= bandBottom) this.ensureAwake(ball.id)
    }
  }

  /**
   * Wake only the balls NEAR a change point (Phase 2.10.0 dense-pile fix):
   * a merge removed a neighbor or inserted a new ball — balls whose support
   * could actually have changed are those within `reach` of that point.
   * Waking the ENTIRE pile on every merge (the old removeBall behavior)
   * re-started every rest window and churned the whole container after each
   * merge in a settled pile.
   */
  wakeNear(x: number, y: number, reach: number): void {
    for (const ball of this.balls) {
      const c = softBallCentroid(ball.soft, this.centroidScratch)
      if (Math.hypot(c.x - x, c.y - y) <= reach + ball.soft.radius) this.wakeBall(ball.id)
    }
  }

  /**
   * Velocity-preserving rigid translation of a whole logical ball (all
   * bodies together — internal geometry untouched), used by merge placement
   * to clear room for a replacement. Wakes the ball (it is genuinely
   * disturbed) and clamps its center inside the container afterwards.
   * Returns the actual applied delta (0 if the ball is gone).
   */
  translateBall(id: number, dx: number, dy: number): { dx: number; dy: number } {
    const ball = this.getBallById(id)
    if (!ball) return { dx: 0, dy: 0 }
    const delta = { x: dx, y: dy }
    Matter.Body.translate(ball.soft.center, delta)
    for (const p of ball.soft.particles) Matter.Body.translate(p, delta)
    // Keep the translated ball inside the trapezoid: clamp the CENTER by a
    // second micro-translation if the push drove it into a wall/floor.
    const c = ball.soft.center.position
    const envelope = ball.soft.radius + SOFT.contactSkin
    const clamped = clampBallInside(c.x, c.y, envelope)
    const fix = { x: clamped.x - c.x, y: clamped.y - c.y }
    if (Math.abs(fix.x) > 0.01 || Math.abs(fix.y) > 0.01) {
      Matter.Body.translate(ball.soft.center, fix)
      for (const p of ball.soft.particles) Matter.Body.translate(p, fix)
    }
    this.wakeBall(id)
    return { dx: dx + fix.x, dy: dy + fix.y }
  }

  /**
   * Spawn a soft-body ball of `tier` with its ring centered at (x, y).
   * `startSleeping` is accepted for API parity; soft particles use
   * sleepThreshold=Infinity so they never auto-sleep mid-recovery.
   * `seed` pins the appearance (Phase 2.11.0): the scene passes the SAME
   * seed the preview/crane showed, so the dropped ball is exactly the
   * character the player saw. Defaults to the ball id.
   */
  spawnBall(x: number, y: number, tier: number, startSleeping = false, seed?: number): SoftBallEntity {
    void startSleeping
    const useSeed = seed ?? this.nextId
    const soft = createSoftBall(x, y, this.tierRadius(tier), this.nextId)
    addToWorld(this.world, soft)
    this.physics?.registerComposite(soft.composite)
    const entity: SoftBallEntity = {
      id: this.nextId++,
      tier,
      seed: useSeed,
      body: soft.center,
      composite: soft.composite,
      soft,
      state: 'active',
      touched: false,
    }
    this.bodyOwners.set(soft.center.id, entity.id)
    for (const p of soft.particles) this.bodyOwners.set(p.id, entity.id)
    this.balls.push(entity)
    return entity
  }

  /** Tier radius provider (injected at construction for testability). */
  tierRadius: (tier: number) => number = (tier) => {
    throw new Error(`SoftBallManager.tierRadius not configured (tier ${tier})`)
  }

  /**
   * Wake notification (injected by the scene): fires for EVERY genuine wake
   * of a specific ball — wakeBall is the single funnel for auditStuckBalls,
   * partial-wake repair, merge displacement, wall raise (wakeAll) and
   * translateBall. The renderer uses it to drop that ball's baked textures
   * immediately, the same frame the wake happens, before the next draw.
   */
  onBallWake: ((id: number) => void) | null = null

  /** Mark first physical contact (merge eligibility) for the owning balls. */
  markTouched(bodyIds: Iterable<number>): void {
    const seen = new Set<number>()
    for (const bodyId of bodyIds) {
      const owner = this.bodyOwners.get(bodyId)
      if (owner != null && !seen.has(owner)) {
        seen.add(owner)
        const ball = this.getBallById(owner)
        if (ball) ball.touched = true
      }
    }
  }

  /**
   * Phase 2.10.2 lifecycle transition: 'active' → 'merging'. Idempotent and
   * immediate — the FIRST caller to reserve the ball wins; any other event
   * touching the same ball in the same step sees a non-active state and is
   * rejected (a ball can never join two merges). Returns false when the ball
   * does not exist or is not active.
   */
  markMerging(id: number): boolean {
    const ball = this.getBallById(id)
    if (!ball || ball.state !== 'active') return false
    ball.state = 'merging'
    return true
  }
  /**
   * Roll back a reserved ball if a multi-party merge reservation fails.
   * Transitions 'merging' back to 'active' safely.
   */
  rollbackMerging(id: number): void {
    const ball = this.getBallById(id)
    if (ball && ball.state === 'merging') {
      ball.state = 'active'
    }
  }

  /** Remove a logical ball: composite (all particles + constraints) and refs.
   * Wakes only the NEARBY balls (their support may have changed) — waking
   * the entire pile re-started every rest window after each merge and churned
   * settled piles (Phase 2.10.0 dense-pile fix). */
  removeBall(id: number, wakeNearby = true): boolean {
    const idx = this.balls.findIndex((b) => b.id === id)
    if (idx === -1) return false
    const ball = this.balls[idx]!
    if (ball.state === 'removed') return false
    ball.state = 'removed'
    const c = softBallCentroid(ball.soft)
    const radius = ball.soft.radius
    removeFromWorld(this.world, ball.soft)
    this.physics?.unregisterComposite(ball.soft.composite)
    this.bodyOwners.delete(ball.soft.center.id)
    for (const p of ball.soft.particles) this.bodyOwners.delete(p.id)
    this.restCounters.delete(id)
    this.restWar.delete(id)
    this.warSurrendered.delete(id)
    this.restAnchorX.delete(id)
    this.restAnchorY.delete(id)
    this.restLastReset.delete(id)
    this.pendingSleep.delete(id)
    this.balls.splice(idx, 1)
    if (wakeNearby) this.wakeNear(c.x, c.y, radius)
    return true
  }

  /**
   * Max distance a particle may move along (ux, uy) from its current
   * position while keeping its collision BODY (radius bodyR) at least
   * 0.5px inside every container surface. Used by the contact backstop and
   * the positional expansion so neither pass can drive a particle into the
   * walls or floor (measured defect: wedged particles were pushed through
   * the floor line by their own separation corrections).
   */
  /** Cached container line constants (slope/intercept/length per wall +
   * floorY) — the trapezoid geometry only changes during the Raise Walls
   * animation, but the old code recomputed containerBounds() + 4 hypots +
   * 4 closures on EVERY call of wallLimitedDistance (thousands per substep
   * in a busy pile). Lazily rebuilt when WallAnimator moves the walls. */
  private wallGeo: {
    floorY: number
    slopeL: number
    cL: number
    lenL: number
    slopeR: number
    cR: number
    lenR: number
  } | null = null

  invalidateWallGeo(): void {
    this.wallGeo = null
  }

  private wallLimitedDistance(p: Matter.Body, ux: number, uy: number, bodyR: number): number {
    let geo = this.wallGeo
    if (!geo) {
      const b = containerBounds()
      const slopeL = (b.innerLeftAt(b.floorY) - b.innerLeftAt(b.top)) / (b.floorY - b.top)
      const cL = b.innerLeftAt(b.top) - slopeL * b.top
      const slopeR = (b.innerRightAt(b.floorY) - b.innerRightAt(b.top)) / (b.floorY - b.top)
      const cR = b.innerRightAt(b.top) - slopeR * b.top
      geo = this.wallGeo = {
        floorY: b.floorY,
        slopeL,
        cL,
        lenL: Math.hypot(1, slopeL),
        slopeR,
        cR,
        lenR: Math.hypot(1, slopeR),
      }
    }
    const { floorY, slopeL, cL, lenL, slopeR, cR, lenR } = geo
    const clear = bodyR + 0.5
    let allowed = Infinity
    if (uy > 1e-6) {
      // moving toward the floor
      const t = (floorY - clear - p.position.y) / uy
      if (t < allowed) allowed = Math.max(0, t)
    }
    const dirL = (ux - slopeL * uy) / lenL
    if (dirL < -1e-6) {
      const dL = (p.position.x - slopeL * p.position.y - cL) / lenL
      const t = (clear - dL) / dirL
      if (t < allowed) allowed = Math.max(0, t)
    }
    const dirR = (-ux + slopeR * uy) / lenR
    if (dirR < -1e-6) {
      const dR = (cR + slopeR * p.position.y - p.position.x) / lenR
      const t = (clear - dR) / dirR
      if (t < allowed) allowed = Math.max(0, t)
    }
    return allowed
  }

  /**
   * CONTACT BACKSTOP (Phase 2.9.8). Matter's solver owns contact separation
   * (collision surfaces touch at the nominal radius). This pass only polishes
   * what a discrete solver can leave behind after fast impacts: residual
   * cross-ball overlap. Iterative, relaxed, mass-weighted, small-capped:
   *  - only pairs from DIFFERENT logical balls (never within one ball),
   *  - target clearance = particle radii + 2·contactSkin,
   *  - each iteration corrects a FRACTION (relaxation) of the remaining
   *    deficit, capped at separationCap px — corrections never jump,
   *  - container bounds re-clamped between iterations, so a correction can
   *    never push a particle through a wall,
   *  - moved balls are woken (rest state reset); sub-pixel corrections are
   *    ignored to avoid churn.
   */
  separateContacts(): void {
    const balls = this.balls
    const moved = this.sepMoved
    moved.clear()
    // Phase 2.21 — BROAD-PHASE PRE-FILTER: compute pairwise reach ONCE per
    // call (not per iteration), precompute per-ball sleep state (was two
    // softBallSleeping walks over 17 bodies per pair per iteration), and
    // skip pairs whose reach excludes overlap. The inner particle×particle
    // double loop only runs for ball pairs whose CENTROIDS are within
    // reach — the same invariant the old per-iteration distance check
    // enforced, just hoisted.
    const n = balls.length
    const asleep: boolean[] = this.asleepScratch
    const reachSq: number[] = this.reachSqScratch
    for (let i = 0; i < n; i++) {
      asleep[i] = softBallSleeping(balls[i]!.soft)
      const ri = balls[i]!.soft.radius + 2 * SOFT.contactSkin + 8
      // reach = ri + rj (sum of both radii + skins + margin); store the
      // squared sum for the per-pair distance test.
      for (let j = 0; j < i; j++) {
        const rj = balls[j]!.soft.radius + 2 * SOFT.contactSkin + 8
        reachSq[i * n + j] = (ri + rj) * (ri + rj)
      }
    }
    let worst = 0
    for (let iter = 0; iter < SOFT.separationIterations; iter++) {
      let corrected = false
      for (let i = 0; i < n; i++) {
        const A = balls[i]!
        const aAsleep = asleep[i]!
        const ca = A.soft.center.position
        for (let j = i + 1; j < n; j++) {
          const B = balls[j]!
          const bAsleep = asleep[j]!
          // Phase 2.9.9: a coherently-sleeping ball is FROZEN state — moving
          // its particles (Body.translate works on sleeping bodies) and then
          // ensureAwake-ing it produced a measured endless sleep/wake cycle
          // in settled piles (the awake side's war crushes into the frozen
          // ball, the backstop "repairs" into it, it wakes, re-settles…).
          // Two sleeping balls: nothing to do. One sleeping ball: the whole
          // correction goes to the awake side (the frozen ball acts as
          // terrain, exactly like the static container walls).
          if (aAsleep && bAsleep) continue
          const cb = B.soft.center.position
          const dx = ca.x - cb.x
          const dy = ca.y - cb.y
          const reach = reachSq[i * n + j]!
          if (dx * dx + dy * dy > reach) continue
          // Target exactly NON-OVERLAP of the actual collision discs (which
          // include the contact skin). NO extra clearance demand: in a dense
          // pile the geometry wants surfaces touching — demanding extra
          // clearance here would fight pile compaction forever (measured:
          // perpetual corrections, permanent churn, no rest). Matter's own
          // solver holds this same invariant, so this pass only fires when
          // the discrete solver leaves real overlap behind.
          const prA = A.soft.radius * SOFT.particleRadiusFactor + SOFT.contactSkin
          const prB = B.soft.radius * SOFT.particleRadiusFactor + SOFT.contactSkin
          const contact = prA + prB
          const imA = 1 / A.soft.particles[0]!.mass
          const imB = 1 / B.soft.particles[0]!.mass
          const imSum = imA + imB
          const paArr = A.soft.particles
          const pbArr = B.soft.particles
          for (let a = 0; a < paArr.length; a++) {
            const pa = paArr[a]!
            for (let b = 0; b < pbArr.length; b++) {
              const pb = pbArr[b]!
              const pdx = pb.position.x - pa.position.x
              const pdy = pb.position.y - pa.position.y
              const d2 = pdx * pdx + pdy * pdy
              if (d2 >= contact * contact) continue
              // Floor the distance: two particles at (near-)coincident centers
              // get a deterministic fallback direction, never NaN.
              let d = Math.sqrt(d2)
              let nx: number
              let ny: number
              if (d < 1e-3) {
                // coincident: push along the balls' centroid line
                const el = Math.hypot(dx, dy) || 1e-6
                nx = dx / el || 1
                ny = dy / el
                d = 1e-3
              } else {
                nx = pdx / d
                ny = pdy / d
              }
              const deficit = contact - d
              // Depth-proportional cap: small deficits (the standing solver
              // war, ≤~1px) get a gentle cap so corrections never churn the
              // constraint networks; deep impact transients get a larger cap
              // so they resolve within 2-3 iterations instead of flashing
              // (measured: a fixed cap left a one-frame 9px melt on the
              // hardest rapid-drop impact).
              const cap = Math.min(6, 1 + deficit * 0.5)
              const fix = Math.min(deficit * SOFT.separationRelaxation, cap)
              // mass-weighted split, then CONTAINER-AWARE: neither particle's
              // correction may push its body deeper past a container surface
              // (measured: a wedged tier-2 squeezed between two tier-4s was
              // driven ~21px below the floor line by its own separation
              // corrections). Asymmetric splits when one side hits a wall —
              // the other side takes the remaining correction. A SLEEPING
              // side never takes any correction (frozen state — see above):
              // the awake side gets the full fix.
              const wA = aAsleep ? 0 : bAsleep ? 1 : (fix * imA) / imSum
              const wB = bAsleep ? 0 : aAsleep ? 1 : (fix * imB) / imSum
              const fixA = Math.min(wA, this.wallLimitedDistance(pa, -nx, -ny, prA))
              const fixB = Math.min(wB, this.wallLimitedDistance(pb, nx, ny, prB))
              if (fixA > 1e-4) Matter.Body.translate(pa, { x: -nx * fixA, y: -ny * fixA })
              if (fixB > 1e-4) Matter.Body.translate(pb, { x: nx * fixB, y: ny * fixB })
              if (fix > SOFT.separationMinMove) {
                corrected = true
                // never re-awake a frozen ball — only the sides actually
                // being corrected belong in the wake set
                if (!aAsleep) moved.add(A.id)
                if (!bAsleep) moved.add(B.id)
              }
              if (fix > worst) worst = fix
            }
          }
        }
      }
      if (corrected) this.clampToContainer()
      if (!corrected) break
    }
    this.lastSeparationCorrection = worst
    for (const id of moved) this.ensureAwake(id)
  }

  /**
   * POSITIONAL AREA RESTORATION (Phase 2.9.8, the contour-aware contact
   * solution). Matter's contact solver squeezes soft rings at the POSITION
   * level; the velocity-level gas cannot counter that (its Δv is cancelled
   * by the contact velocity solve within the same step — measured: bottom
   * layer of a dense pile equilibrating at 0.3-0.5× rest area regardless of
   * gas authority). This pass restores ring area directly, positionally:
   *  - each particle of a compressed ball moves radially outward by a small
   *    bounded step (∝ area deficit, capped),
   *  - the move is ray-clamped against every nearby FOREIGN particle's
   *    collision disc, so expansion can never create a cross-ball overlap,
   *  - the move is capped at the rest ring radius, so a ball never inflates
   *    past its rest size,
   *  - walls are handled by the container clamp that runs after this pass.
   * Squeezed from above with free flanks, a ball bulges sideways — the
   * desired slime behavior — and where expansion is fully blocked the ball
   * simply holds its (moderate, bounded) compression with no churn.
   */
  expandShape(): void {
    const balls = this.balls
    // Phase 2.21: the foreign-particle candidate list reuses pooled slots
    // (nearParticles/nearRadii) instead of pushing a fresh {x,y,r} object
    // per foreign particle per ball per substep.
    const near = this.nearParticles
    for (const A of balls) {
      if (softBallSleeping(A.soft)) continue
      const soft = A.soft
      const deficit = 1 - softBallArea(soft) / soft.restArea
      const minR = soft.radius * (1 - SOFT.particleRadiusFactor) * SOFT.minRadiusFraction
      if (deficit < SOFT.expandMinDeficit && deficit > -SOFT.expandMinDeficit) continue
      const c = softBallCentroid(soft, this.centroidScratch)
      const ringR = soft.radius * (1 - SOFT.particleRadiusFactor)
      const bodyR = soft.radius * SOFT.particleRadiusFactor + SOFT.contactSkin
      // outward when compressed, inward when inflated
      const outward = deficit > 0
      const delta = Math.min(SOFT.expandMaxMove, ringR * Math.abs(deficit) * SOFT.expandRate)
      // foreign collision discs near this ball (padded by this ball's own
      // particle radius + margin: the moving particle's CENTER must stay
      // outside foreign surfaces, or Matter cancels the move next step).
      // Only needed for OUTWARD moves — inward moves retreat from neighbors.
      let nearN = 0
      if (outward) {
        for (const B of balls) {
          if (B === A) continue
          const dx = B.soft.center.position.x - c.x
          const dy = B.soft.center.position.y - c.y
          const reach = soft.radius + B.soft.radius + delta + 8
          if (dx * dx + dy * dy > reach * reach) continue
          const rB = bodyR + B.soft.radius * SOFT.particleRadiusFactor + SOFT.contactSkin + 0.5
          for (const pb of B.soft.particles) {
            // pooled slot: reuse the object at index nearN, extend when needed
            let slot = near[nearN]
            if (!slot) {
              slot = { x: 0, y: 0, r: 0 }
              near[nearN] = slot
            }
            slot.x = pb.position.x
            slot.y = pb.position.y
            slot.r = rB
            nearN++
          }
        }
      }
      // wall clearance: expansion must keep the body inside the container —
      // a particle pressed against a wall/floor must NOT be pushed deeper
      // into it (measured: wall-directed expansion buried bodies ~15px past
      // the visible surface). Blocked directions simply don't expand; the
      // ball bulges into free space instead (the desired slime behavior).
      for (const p of soft.particles) {
        const rx = p.position.x - c.x
        const ry = p.position.y - c.y
        const dist = Math.hypot(rx, ry) || 1
        const dir = outward ? 1 : -1
        const ux = (rx / dist) * dir
        const uy = (ry / dist) * dir
        let move: number
        if (outward) {
          // never expand past the rest ring
          move = Math.min(delta, Math.max(0, ringR * 1.02 - dist))
          // ANTI-FOLD FLOOR (positional): a particle below the min ring
          // radius is a folding ring — restore it positionally, stronger
          // than the deficit-driven rate (the velocity-level recovery loses
          // to sustained contact pressure; measured ball 9 folding into an
          // arrowhead under a dense-pile squeeze).
          if (dist < minR) {
            move = Math.max(move, Math.min((minR - dist) * 0.5, SOFT.expandMaxMove * 2))
          }
          if (move <= 0) continue
        } else {
          // deflation: pull the particle toward the centroid, never below
          // the min ring radius (the anti-fold floor wins over deflation)
          move = Math.min(delta, Math.max(0, dist - Math.max(minR, ringR * 0.92)))
          if (move <= 0) continue
        }
        if (outward) {
          // container surfaces: keep the body inside the container
          const tWall = this.wallLimitedDistance(p, ux, uy, bodyR)
          if (tWall < move) move = Math.max(0, tWall)
          // ray-clamp against foreign discs: largest t keeping p+t·r̂ outside
          for (let qi = 0; qi < nearN; qi++) {
            const q = near[qi]!
            const qx = q.x - p.position.x
            const qy = q.y - p.position.y
            const b1 = qx * ux + qy * uy
            // PERF culls: disc behind the ray, or its closest approach
            // already beyond the (shrinking) move budget — skip the
            // sqrt entirely. Measured ~50-70% of near[] entries in
            // dense piles never constrain the ray.
            if (b1 <= 0 || b1 - q.r >= move) continue
            const disc = b1 * b1 - (qx * qx + qy * qy) + q.r * q.r
            if (disc <= 0) continue // ray misses this disc entirely
            const tHit = b1 - Math.sqrt(disc)
            if (tHit < move) move = Math.max(0, tHit)
          }
        }
        if (move > 0.01) {
          Matter.Body.translate(p, { x: ux * move, y: uy * move })
        }
      }
    }
  }

  /**
   * Per-substep soft-body solver pass. Coherently-sleeping balls are skipped
   * entirely (no energy injected into settled rings; Matter integrates them
   * not at all). Awake balls get the anti-tunneling clamp + the damped
   * pressure controller, then the whole-ball rest controller may sleep them.
   *
   * Whole-ball resting state (Phase 2.9.8): sleep requires sustained NET
   * stationarity of the ball's centroid — see the rest-detection block.
   *
   * STUCK-BALL AUDIT: a fully-sleeping ball with NO active contacts has lost
   * its physical support (the ball or pile it rested on was removed) but
   * Matter never wakes it — sleeping pairs are skipped, so no collisionStart
   * can ever fire for it again. It would hang frozen in mid-air until
   * another ball happens to hit it. Waking such a ball resumes gravity
   * immediately; supported sleepers (resting on the floor/walls/each other)
   * always appear in the active pair list and are never disturbed.
   */
  /** True when any body of the logical ball has an active contact. */
  private ballInContact(ball: SoftBallEntity, contactBodyIds: ReadonlySet<number>): boolean {
    return (
      contactBodyIds.has(ball.soft.center.id) ||
      ball.soft.particles.some((p) => contactBodyIds.has(p.id))
    )
  }

  /** Wake every fully-sleeping ball that has no active contact: nothing
   * supports it, so it must fall. Runs once per substep BEFORE the solver
   * pass (see stepAll's doc for the failure mode this closes). */
  private auditStuckBalls(contactBodyIds: ReadonlySet<number>): void {
    for (const ball of this.balls) {
      if (ball.state !== 'active') continue
      if (!softBallSleeping(ball.soft)) continue
      const touching =
        contactBodyIds.has(ball.soft.center.id) ||
        ball.soft.particles.some((p) => contactBodyIds.has(p.id))
      if (!touching) this.wakeBall(ball.id, this.warSurrendered.has(ball.id))
    }
  }

  stepAll(contactBodyIds?: ReadonlySet<number>): void {
    if (contactBodyIds) this.auditStuckBalls(contactBodyIds)
    for (const ball of this.balls) {
      const id = ball.id
      const allSleeping = softBallSleeping(ball.soft)
      if (allSleeping) continue
      // Matter auto-wakes individual particle bodies on impact (per-body).
      // Repair partial wakes coherently: the resting state is all-or-nothing
      // per logical ball, never per particle.
      //
      // The repair PRESERVES the rest window for a ball that has already
      // surrendered: a partial wake is not a disturbance (it is Matter's
      // per-body auto-wake inside a standing solver war), and resetting
      // the window on every repair meant the ball could never complete
      // the 240-substep quiet window — it slept, was woken by the repair,
      // and the cycle repeated forever, so the pile churned at the speed
      // cap indefinitely (measured: the war counter climbing to 528, then
      // dropping to 5 as the ball slept and was re-woken).
      const anySleeping = ball.soft.center.isSleeping || ball.soft.particles.some((p) => p.isSleeping)
      if (anySleeping) this.wakeBall(id, this.warSurrendered.has(id))
      // Contact-aware speed cap: balls with active contacts run at the
      // stable pile cap; balls in free fall get the faster drop cap (see
      // clampSoftBallSpeed). Without a contact oracle (contactBodyIds
      // undefined) default to the SAFE cap — never faster than proven.
      const inContact = contactBodyIds == null ? true : this.ballInContact(ball, contactBodyIds)
      clampSoftBallSpeed(ball.soft, inContact)
      applyPressure(ball.soft)

      // ---- rest detection ----
      // Sleep requires ~0.75s of NET stationarity: the ball's centroid must
      // stay within restDrift px of where it was when the window began, no
      // body may be moving fast, and the ball must have made physical contact
      // (touched) so free fall is never frozen. This distinguishes the two
      // motions that matter (measured):
      //  - the standing solver churn (particles ±1-2px/step around a fixed
      //    centroid; rendered-contour wobble sub-pixel per frame) → centroid
      //    net ~0 → SLEEPS, freezing the churn permanently;
      //  - slow net motion (sliding, compaction slump — measured 30-45px per
      //    5s) → centroid displacement far above the drift bound → stays
      //    awake until the rearrangement actually stops.
      // Per-ball, all-or-nothing: Matter then skips integration, gravity and
      // constraint solving for the whole logical ball (true stillness) and
      // treats it as static until a moving body touches it.
      const c = softBallCentroid(ball.soft)
      const counter = (this.restCounters.get(id) ?? 0) + 1
      const anchorX = this.restAnchorX.get(id)
      const anchorY = this.restAnchorY.get(id)
      const maxSpeed = softBallMaxSpeed(ball.soft)
      const fast = maxSpeed > SOFT.restSpeedFast
      // WAR SURRENDER (Phase 2.10.0 — see SOFT.restWarSurrenderSteps): count
      // consecutive fast substeps; past the surrender threshold a ball whose
      // area is still ~at rest is in a standing solver war, not a real
      // disturbance — the speed gate stands down and the drift gate (which
      // real motion and impacts always trip) remains fully in force.
      // Phase 2.11.2: the count no longer RESETS on a brief quiet substep —
      // the floor-wedged jam ball dips below restSpeedFast ~once per 500
      // substeps, which kept resetting the counter so surrender never
      // engaged and the ball churned at the travel cap forever. wakeBall/
      // spawn still clear the counter, so every genuine disturbance (which
      // always wakes the ball) starts the evidence from zero; the drift +
      // area gates are untouched and still veto sleep.
      const warCount = fast ? (this.restWar.get(id) ?? 0) + 1 : (this.restWar.get(id) ?? 0)
      this.restWar.set(id, warCount)
      // The AREA gate: the ball's area must still be ~at rest. A ball
      // that is genuinely being squashed (or stretched) by a real load is
      // NOT standing in a solver war and must never be allowed to sleep
      // mid-distortion.
      const areaOk =
        Math.abs(1 - ball.soft.area / ball.soft.restArea) < SOFT.restWarSurrenderAreaTolerance
      if (fast && warCount > SOFT.restWarSurrenderSteps && areaOk) {
        this.warSurrendered.add(id)
      } else if (this.warSurrendered.has(id) && !areaOk) {
        // The area gate failed: the ball is really being deformed, so the
        // surrender is revoked (it may be re-earned later).
        this.warSurrendered.delete(id)
      }
      // The surrender is STICKY: once earned it is NOT revoked by a brief
      // quiet substep. A ball grinding at the cap dips below
      // restSpeedFast occasionally (the exact case Phase 2.11.2 gave the
      // COUNTER protection for), and revoking the surrender on that
      // substep re-engaged the speed gate, which reset the rest counter —
      // so the escape hatch could never complete and the ball churned at
      // the speed cap forever, keeping its whole neighbourhood awake
      // (measured: the pile's max speed pinned at 7.93 after a wall
      // raise). The only revocations are a genuine disturbance
      // (wakeBall, which clears it for a ball that was actually asleep)
      // and the area gate above.
      const surrendered = this.warSurrendered.has(id)
      const speedGate = fast && !surrendered
      // A missing anchor (just woken / just spawned) means the window is
      // STARTING: initialize it here — never count quiet steps without drift
      // protection (measured hole: after wakeBall deleted the anchors, a
      // slowly creeping ball had a 2s check-free window and could sleep
      // mid-slide).
      if (anchorX == null || anchorY == null) {
        this.restAnchorX.set(id, c.x)
        this.restAnchorY.set(id, c.y)
      }
      const drifted =
        anchorX == null || anchorY == null
          ? false
          : Math.hypot(c.x - anchorX, c.y - anchorY) > SOFT.restDrift
      // The drift gate applies to every ball, fast or slow: a coherently
      // drifting ball is genuinely moving and must not sleep mid-slide
      // (pinned by rest-surrender.test.ts Phase B). A ball in a standing
      // solver war has a BOUNDED centroid wander (measured: ~0.2px/step
      // with the particles churning at 7.5), so it does not trip the
      // gate — the drift measure is a bound on the CENTROID, not on the
      // particles.
      if (!ball.touched || speedGate || drifted) {
        // (re)start the window: the counter AND the anchor refresh to now.
        // The anchor refresh is what makes the drift measure a BOUNDED
        // wander (~0 net) rather than a net displacement — a standing
        // solver war oscillates around a point, so it reads as no drift,
        // while a coherently sliding ball keeps moving past the refreshed
        // anchor and trips the gate (pinned by rest-surrender.test.ts).
        this.restCounters.set(id, 0)
        this.restAnchorX.set(id, c.x)
        this.restAnchorY.set(id, c.y)
        this.restLastReset.set(id, !ball.touched ? 'untouched' : speedGate ? 'fast' : 'drifted')
        continue
      }
      this.restCounters.set(id, counter)
      if (counter >= SOFT.restSteps) {
        // Phase 2.9.9: the actual freeze is DEFERRED to commitRest(), which
        // the scene calls after the full correction chain (separation →
        // expansion → container clamp). Sleeping directly here froze balls
        // mid-substep with Engine's constraint pull already applied but the
        // clamp not yet run — measured: a wall-side particle frozen 1.4px
        // past the container's inner line (clamped only while awake).
        this.pendingSleep.add(id)
        this.restCounters.set(id, 0)
        this.restAnchorY.delete(id)
        this.restAnchorX.delete(id)
      }
    }
  }

  /**
   * Freeze every ball whose rest window completed this substep. MUST run
   * after the correction chain (separateContacts → expandShape →
   * clampToContainer) so balls freeze in a repaired, clamped state.
   */
  commitRest(): void {
    if (this.pendingSleep.size === 0) return
    for (const id of this.pendingSleep) {
      const ball = this.getBallById(id)
      if (!ball) continue
      for (const p of ball.soft.particles) {
        // zero cached constraint impulses: Constraint.postSolveAll wakes
        // any body carrying one (and preSolveAll would re-apply it as
        // motion on the next update)
        const impulse = (p as unknown as { constraintImpulse: { x: number; y: number; angle: number } }).constraintImpulse
        impulse.x = 0
        impulse.y = 0
        impulse.angle = 0
        Matter.Sleeping.set(p, true)
      }
      const centerImpulse = (ball.soft.center as unknown as { constraintImpulse: { x: number; y: number; angle: number } }).constraintImpulse
      centerImpulse.x = 0
      centerImpulse.y = 0
      centerImpulse.angle = 0
      Matter.Sleeping.set(ball.soft.center, true)
    }
    this.pendingSleep.clear()
  }

  /**
   * BOUNDARY CLAMP (Phase 2.9.8): ANTI-TUNNELING BACKSTOP only. It fires
   * exclusively when a particle's CENTER has crossed an inner surface line
   * (real tunneling — Matter's contact solver keeps ordinary contact depth
   * well inside that envelope). Measured lesson: the earlier version demanded
   * bodyR clearance from the surfaces, so ordinary load-induced contact depth
   * triggered yanks of up to 22px EVERY STEP — the clamp itself became the
   * pile's main energy source and crushed balls it was protecting.
   *
   * Positional and velocity-preserving (setPosition keeps velocity); wakes
   * balls it has to move.
   */
  clampToContainer(): void {
    this.lastClampCorrection = 0
    const b = containerBounds()
    const pad = 0.5
    // Phase 2.10.1 (spec §3): side-wall containment only exists where the
    // walls exist — BELOW the CURRENT wall tops. Above the tops is open sky
    // (open top): a ball pushed past the extrapolated wall line up there
    // must be allowed to cross and genuinely fall OUTSIDE, or the overflow
    // game-over rule could never fire. `null` (headless rigs) keeps the old
    // extrapolated funnel clamp at every height. The FLOOR backstop is
    // unconditional — tunneling through the floor is always a defect.
    const sideClampFromY = this.wallTopY ?? Number.NEGATIVE_INFINITY
    for (const ball of this.balls) {
      if (softBallSleeping(ball.soft)) continue
      // Phase 2.10.2 CORRECTED escape classification (replaces the 2.10.1
      // centroid-past-the-line exemption, which wrongly released balls that
      // were merely SQUEEZED past the inner line from inside — they walked
      // into the wall band, got stuck there vibrating, and misfired the
      // overflow game-over). The side clamp is skipped only when the ball
      // genuinely cannot be contained:
      //  (a) its centroid is ABOVE the current wall tops — open sky, the
      //      walls do not exist there (crossing the extrapolated line up
      //      there is the legitimate path to a genuine overflow), or
      //  (b) its centroid is beyond the wall band's OUTER face — it is fully
      //      outside the container (reachable only through the open top;
      //      pushing it back would teleport it through the static collider).
      // A ball pressed a few px past the inner line from inside (ordinary
      // contact flattening, band half-width at most) is still clamped back.
      const bc = softBallCentroid(ball.soft)
      const bcYLine = Math.min(bc.y, b.floorY)
      // Slanted wall parameters (normal distance calculation)
      const slopeL = (b.innerLeftAt(b.floorY) - b.innerLeftAt(b.top)) / (b.floorY - b.top)
      const cL = b.innerLeftAt(b.top) - slopeL * b.top
      const hypL = Math.hypot(1, slopeL)
      const slopeR = (b.innerRightAt(b.floorY) - b.innerRightAt(b.top)) / (b.floorY - b.top)
      const cR = b.innerRightAt(b.top) - slopeR * b.top
      const hypR = Math.hypot(1, slopeR)

      // Orthogonal distance past inner boundary line (positive when outside)
      const distOutsideLeft = -(bc.x - slopeL * bcYLine - cL) / hypL
      const distOutsideRight = -(cR + slopeR * bcYLine - bc.x) / hypR
      const past = Math.max(distOutsideLeft, distOutsideRight)
      const aboveTops = bc.y <= sideClampFromY
      const beyondBand = past > CONTAINER.frameThickness + GAME_OVER.outsideMargin
      const clampExempt = !this.shakeActive && (aboveTops || beyondBand)
      for (const p of ball.soft.particles) {
        let nx = 0
        let ny = 0
        // floor: center below the floor line = tunneled
        if (p.position.y > b.floorY - pad) ny -= p.position.y - (b.floorY - pad)
        if (!clampExempt && p.position.y > sideClampFromY) {
          // During shake: bounce off the invisible rim at the wall tops
          // so balls are pushed back toward the center instead of escaping
          if (this.shakeActive && p.position.y < sideClampFromY + pad) {
            ny += (sideClampFromY + pad) - p.position.y
            // Reverse upward velocity so the ball bounces back down
            if (p.velocity.y < 0) {
              Matter.Body.setVelocity(p, { x: p.velocity.x, y: -p.velocity.y * 0.6 })
            }
          }
          // left wall: center left of the wall line = tunneled
          const dL = (p.position.x - slopeL * p.position.y - cL) / Math.hypot(1, slopeL)
          if (dL < pad) {
            const fix = pad - dL
            nx += fix / Math.hypot(1, slopeL)
            ny += (-fix * slopeL) / Math.hypot(1, slopeL)
          }
          // right wall
          const dR = (cR + slopeR * p.position.y - p.position.x) / Math.hypot(1, slopeR)
          if (dR < pad) {
            const fix = pad - dR
            nx += -fix / Math.hypot(1, slopeR)
            ny += (fix * slopeR) / Math.hypot(1, slopeR)
          }
        }
        if (nx !== 0 || ny !== 0) {
          Matter.Body.setPosition(p, { x: p.position.x + nx, y: p.position.y + ny })
          const mag = Math.hypot(nx, ny)
          if (mag > this.lastClampCorrection) this.lastClampCorrection = mag
          if (mag > SOFT.separationMinMove) this.ensureAwake(ball.id)
        }
      }
    }
  }

  /** Remove everything (restart flow) — no neighbor waking while clearing. */
  clearBalls(): void {
    this.lastClampCorrection = 0
    for (const ball of [...this.balls]) {
      this.removeBall(ball.id, false)
    }
  }
}
