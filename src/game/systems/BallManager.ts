import * as Matter from 'matter-js'
import { PHYSICS } from '../../config/physics'
import { getTier } from '../../config/ballTiers'
import type { PhysicsWorld } from './PhysicsWorld'

export type BallState = 'active' | 'removed'

export interface Ball {
  id: number
  tier: number
  body: Matter.Body
  state: BallState
  /** Merge eligibility (Phase 2.4): a ball may merge only after its first
   * physical contact (container, pile, or another ball). Airborne drops
   * never merge. Set by the scene's per-frame collision drain. */
  touched: boolean
}

/**
 * Ball model registry (ARCHITECTURE.md §3.4): owns Ball models and their
 * Matter bodies. Phase 2: tier-based (was Phase 1 test variants). Visuals are
 * handled entirely by the render layer.
 */
export class BallManager {
  private balls: Ball[] = []
  private nextId = 1

  constructor(private readonly physicsWorld: PhysicsWorld) {}

  get count(): number {
    return this.balls.length
  }

  getBalls(): readonly Ball[] {
    return this.balls
  }

  getBallById(id: number): Ball | undefined {
    return this.balls.find((b) => b.id === id)
  }

  getBallByBodyId(bodyId: number): Ball | undefined {
    return this.balls.find((b) => b.body.id === bodyId)
  }

  /**
   * Spawn a ball of `tier` at (x, y). `startSleeping` defers its collision
   * activity until woken (used by MergeSystem to avoid same-frame re-triggers).
   */
  spawnBall(x: number, y: number, tier: number, startSleeping = false): Ball {
    const t = getTier(tier)
    if (!t || !t.playable) throw new Error(`Cannot spawn unplayable/unknown tier ${tier}`)
    const p = { ...PHYSICS.ball, ...t.physics }
    const body = Matter.Bodies.circle(x, y, t.radius, {
      restitution: p.restitution,
      friction: p.friction,
      frictionStatic: p.frictionStatic,
      frictionAir: p.frictionAir,
      slop: p.slop,
      density: p.density,
      label: 'ball',
      isSleeping: startSleeping,
    })
    body.circleRadius = t.radius
    // Never auto-sleep: balls on the shallow trapezoid slopes must keep
    // creeping toward the pile center (Matter's auto-sleep freezes low-motion
    // bodies mid-slope). MergeSystem still uses explicit sleep/wake for
    // same-frame re-trigger protection; engine sleeping stays enabled so
    // explicitly-sleeping bodies are honored and woken by collisions.
    body.sleepThreshold = Infinity
    this.physicsWorld.addBody(body)

    const ball: Ball = { id: this.nextId++, tier, body, state: 'active', touched: false }
    this.balls.push(ball)
    return ball
  }

  /** Mark balls as contact-established (merge-eligible). */
  markTouched(bodyIds: Iterable<number>): void {
    for (const id of bodyIds) {
      const ball = this.balls.find((b) => b.body.id === id)
      if (ball) ball.touched = true
    }
  }

  /** Safely remove one ball: removes its body and forgets the model. */
  removeBall(id: number): boolean {
    const idx = this.balls.findIndex((b) => b.id === id)
    if (idx === -1) return false
    const ball = this.balls[idx]!
    if (ball.state === 'removed') return false
    ball.state = 'removed'
    this.physicsWorld.removeBody(ball.body)
    this.balls.splice(idx, 1)
    return true
  }

  clearBalls(): void {
    for (const ball of this.balls) {
      ball.state = 'removed'
      this.physicsWorld.removeBody(ball.body)
    }
    this.balls = []
  }
}
