import * as Matter from 'matter-js'
import { PHYSICS } from '../../config/physics'

export interface RectSpec {
  x: number
  y: number
  width: number
  height: number
}

export interface CollisionPair {
  bodyA: Matter.Body
  bodyB: Matter.Body
}

/**
 * Framework-free Matter.js owner (ARCHITECTURE.md §3.3):
 * exactly one authoritative update path — a fixed 60 Hz accumulator stepped
 * by Phaser's frame delta (or by tests). No second game loop exists.
 *
 * Catch-up is bounded: a stalled frame advances at most `maxSubSteps` steps and
 * drops the remainder, so a long freeze can never trigger a spiral of death.
 *
 * Collision events ('collisionStart') are buffered per step and drained via
 * `takeCollisionEvents()` — consumers must drain once per frame, after step().
 */
export class PhysicsWorld {
  readonly engine: Matter.Engine

  private accumulatorMs = 0
  private _disposed = false
  private _stepCount = 0
  private collisionQueue: CollisionPair[] = []
  private readonly onCollisionStart: (event: Matter.IEventCollision<Matter.Engine>) => void
  /** Velocity of every dynamic body BEFORE the current substep's resolution.
   * Matter fires collisionStart AFTER resolving the collision, so event-time
   * velocities have already lost the impact energy. Consumers must use this
   * snapshot to measure the true approach speed. */
  private preStepVelocities = new Map<number, Matter.Vector>()
  /** Optional per-substep callback (soft-body pressure/clamp passes).
   * Runs once per Engine.update — never per rendered frame. */
  private subStepHandler: (() => void) | null = null

  constructor() {
    this.engine = Matter.Engine.create({
      gravity: { ...PHYSICS.gravity },
      positionIterations: PHYSICS.engine.positionIterations,
      velocityIterations: PHYSICS.engine.velocityIterations,
      constraintIterations: PHYSICS.engine.constraintIterations,
      enableSleeping: PHYSICS.engine.enableSleeping,
    })
    // Phase 2.9.9: raise the collision-wake bar above the settled pile's
    // standing churn band. Sleeping.afterCollisions wakes a sleeping body
    // when its contact partner's `motion` (speed², biased-averaged) exceeds
    // this threshold. Measured: the settled pile's residual solver churn
    // runs at particle speeds up to ~1.5px/step → motion ≤ ~2.25, which at
    // the old 0.25 bar continuously re-woke freshly slept balls from their
    // still-churning neighbors (a measured endless sleep/wake cycle: the
    // pile reached whole-ball sleep, was woken by a contact, re-settled…).
    // Genuine impacts move ≥5px/step → motion ≥25 and still wake sleepers
    // instantly; gentle contact (motion ≤ 4) against frozen terrain is
    // resolved by the solver treating the sleeper as static. (2.9.8 raised
    // this from the 0.08 default to 0.25 for the same reason at 60Hz noise.)
    ;(Matter.Sleeping as unknown as { _motionSleepThreshold: number })._motionSleepThreshold = 4
    // Phase 2.9.8: Matter does not support SLEEPING bodies inside constraint
    // networks — Constraint.solveAll keeps correcting them and
    // Constraint.postSolveAll wakes every body that carries a cached
    // constraintImpulse (measured via wake tracing: a freshly slept soft ball
    // was re-woken one step later by postSolveAll, 16 sleep/wake cycles in
    // a row). Whole-ball coherent rest therefore requires treating fully
    // frozen constraints like fixed ones: skip them in the solve, and zero
    // sleeping bodies' cached impulses so postSolveAll's wake guard passes.
    // A constraint with at least one awake dynamic body is unaffected.
    type ConstraintInternals = {
      solveAll: (constraints: Matter.Constraint[], delta: number) => void
      postSolveAll: (bodies: Matter.Body[]) => void
    }
    const constraintInternals = Matter.Constraint as unknown as ConstraintInternals
    const constraintSolveAll = constraintInternals.solveAll
    constraintInternals.solveAll = (constraints, delta) => {
      const live: Matter.Constraint[] = []
      for (const c of constraints) {
        const a = c.bodyA
        const b = c.bodyB
        const aFrozen = !a || a.isStatic || a.isSleeping
        const bFrozen = !b || b.isStatic || b.isSleeping
        if (aFrozen && bFrozen) continue
        live.push(c)
      }
      constraintSolveAll(live, delta)
    }
    const constraintPostSolveAll = constraintInternals.postSolveAll
    constraintInternals.postSolveAll = (bodies) => {
      for (const body of bodies) {
        if (body.isSleeping) {
          const impulse = (body as unknown as { constraintImpulse: { x: number; y: number; angle: number } }).constraintImpulse
          impulse.x = 0
          impulse.y = 0
          impulse.angle = 0
        }
      }
      constraintPostSolveAll(bodies)
    }
    this.onCollisionStart = (event) => {
      for (const pair of event.pairs) {
        this.collisionQueue.push({ bodyA: pair.bodyA, bodyB: pair.bodyB })
      }
    }
    Matter.Events.on(this.engine, 'collisionStart', this.onCollisionStart)
  }

  get world(): Matter.World {
    return this.engine.world
  }

  get disposed(): boolean {
    return this._disposed
  }

  get stepCount(): number {
    return this._stepCount
  }

  get simTimeMs(): number {
    return this._stepCount * PHYSICS.stepMs
  }

  /** Simulated seconds advanced (== stepCount / stepHz) — always exact steps. */
  get stepSeconds(): number {
    return this._stepCount / PHYSICS.stepHz
  }

  addRectangle(spec: RectSpec, label: string): Matter.Body {
    const body = Matter.Bodies.rectangle(spec.x, spec.y, spec.width, spec.height, {
      isStatic: true,
      friction: PHYSICS.wall.friction,
      restitution: PHYSICS.wall.restitution,
      label,
    })
    Matter.Composite.add(this.world, body)
    return body
  }

  /** Flat body list cache — Composite.allBodies() walks the entire
   * composite tree and fills a fresh array on EVERY call; the step loop
   * called it twice per substep (velocity snapshot + clampSpeeds), i.e.
   * ~240 array allocations/s in steady state. Maintained via add/remove.
   * Soft-ball composites must call registerComposite/unregisterComposite
   * so spawned particles stay in the cache. */
  private bodiesCache: Matter.Body[] = []

  addBody(body: Matter.Body): void {
    if (this._disposed) return
    Matter.Composite.add(this.world, body)
    this.bodiesCache.push(body)
  }

  removeBody(body: Matter.Body): void {
    if (this._disposed) return
    Matter.Composite.remove(this.world, body)
    const i = this.bodiesCache.indexOf(body)
    if (i >= 0) this.bodiesCache.splice(i, 1)
  }

  registerComposite(composite: Matter.Composite): void {
    if (this._disposed) return
    this.bodiesCache.push(...Matter.Composite.allBodies(composite))
  }

  unregisterComposite(composite: Matter.Composite): void {
    if (this._disposed) return
    const gone = new Set(Matter.Composite.allBodies(composite))
    this.bodiesCache = this.bodiesCache.filter((b) => !gone.has(b))
  }

  getAllBodies(): Matter.Body[] {
    if (this._disposed) return []
    return this.bodiesCache
  }

  getDynamicBodies(): Matter.Body[] {
    return this.getAllBodies().filter((b) => !b.isStatic)
  }

  get bodyCount(): number {
    return this.getAllBodies().length
  }

  /** Drain buffered collision-start pairs (one consumer per frame). */
  takeCollisionEvents(): CollisionPair[] {
    const queue = this.collisionQueue
    this.collisionQueue = []
    return queue
  }

  /**
   * Phase 2.10.2: all CURRENTLY-TOUCHING body pairs (Matter's active pair
   * list), regardless of when their collisionStart fired. The merge system
   * uses this to revalidate contact state — e.g. a pair whose merge was
   * deferred by the replacement cooldown must merge when the cooldown
   * expires, without needing a fresh collisionStart (the bodies never
   * separated). Only STARTED, still-active pairs are returned.
   */
  activeBallPairs(): CollisionPair[] {
    const pairs: CollisionPair[] = []
    for (const p of this.engine.pairs.list) {
      if (!p.isActive) continue
      pairs.push({ bodyA: p.bodyA, bodyB: p.bodyB })
    }
    return pairs
  }

  /** IDs of every body currently in an ACTIVE contact pair (started and
   * not separated this substep). Cheap single pass over the pair list —
   * used by the soft-ball manager's stuck-ball audit. */
  private readonly activeIds = new Set<number>()

  /** IDs of every body currently in an ACTIVE contact pair (started and
   * not separated this substep). Cheap single pass over the pair list —
   * used by the soft-ball manager's stuck-ball audit. Phase 2.21: the Set
   * is reused (was allocated per substep — 120/s). The returned set is a
   * live view: consumers must not retain it across substeps (they don't —
   * stepAll reads it synchronously). */
  activeContactBodyIds(): ReadonlySet<number> {
    const ids = this.activeIds
    ids.clear()
    for (const p of this.engine.pairs.list) {
      if (!p.isActive) continue
      ids.add(p.bodyA.id)
      ids.add(p.bodyB.id)
    }
    return ids
  }

  /** Register a per-substep callback (soft-body solver passes). */
  setSubStepHandler(handler: (() => void) | null): void {
    this.subStepHandler = handler
  }

  /** Pre-collision velocity of a body (updated every substep before resolution). */
  preStepVelocity(body: Matter.Body): Matter.Vector {
    return this.preStepVelocities.get(body.id) ?? body.velocity
  }

  /**
   * Advance simulation by one rendered frame's delta (variable) using fixed
   * substeps. Called exactly once per frame — the single authoritative path.
   */
  step(frameDeltaMs: number): void {
    if (this._disposed) return

    this.accumulatorMs += Math.min(Math.max(frameDeltaMs, 0), PHYSICS.maxFrameDeltaMs)

    let substeps = 0
    while (this.accumulatorMs >= PHYSICS.stepMs && substeps < PHYSICS.maxSubSteps) {
      // Snapshot velocities BEFORE this substep resolves collisions
      // Pooled reuse: overwrite the cached vectors in place instead of
      // allocating ~340 fresh objects per substep (~41k allocs/s).
      for (const v of this.preStepVelocities.values()) {
        v.x = 0
        v.y = 0
      }
      for (const body of this.getAllBodies()) {
        if (!body.isStatic) {
          const pooled = this.preStepVelocities.get(body.id)
          if (pooled) {
            pooled.x = body.velocity.x
            pooled.y = body.velocity.y
          } else {
            this.preStepVelocities.set(body.id, { x: body.velocity.x, y: body.velocity.y })
          }
        }
      }
      Matter.Engine.update(this.engine, PHYSICS.stepMs)
      this._stepCount += 1
      substeps += 1
      this.accumulatorMs -= PHYSICS.stepMs
      this.clampSpeeds()
      this.subStepHandler?.()
    }

    if (substeps === PHYSICS.maxSubSteps) {
      // Dropped remainder after a stall — bounded catch-up.
      this.accumulatorMs = 0
    }
  }

  private clampSpeeds(): void {
    for (const body of this.getAllBodies()) {
      if (body.isStatic) continue
      const v = body.velocity
      const speed = Math.hypot(v.x, v.y)
      if (speed > PHYSICS.maxSpeed) {
        const k = PHYSICS.maxSpeed / speed
        Matter.Body.setVelocity(body, { x: v.x * k, y: v.y * k })
      }
    }
  }

  /** Remove all dynamic bodies, restore initial state (statics persist). */
  reset(): void {
    if (this._disposed) return
    for (const body of [...this.bodiesCache]) {
      if (!body.isStatic) {
        Matter.Composite.remove(this.world, body)
        const i = this.bodiesCache.indexOf(body)
        if (i >= 0) this.bodiesCache.splice(i, 1)
      }
    }
    this.accumulatorMs = 0
    this._stepCount = 0
    this.collisionQueue = []
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    Matter.Events.off(this.engine, 'collisionStart', this.onCollisionStart)
    this.collisionQueue = []
    this.bodiesCache = []
    Matter.Composite.clear(this.world, false)
    Matter.Engine.clear(this.engine)
  }
}
