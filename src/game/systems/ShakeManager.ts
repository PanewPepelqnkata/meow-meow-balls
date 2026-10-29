import Matter from 'matter-js'
import { SHAKE_ABILITY } from '../../config/shakeAbility'
import { containerBounds, interiorCorners } from '../../config/container'
import type { SoftBallManager } from './SoftBallManager'

/**
 * Shake ability manager:
 * - 10-second active earthquake timer.
 * - Applies earthquake vibration to container view, background, and camera.
 * - Injects physical agitation to balls to mix and settle the pile.
 * - Solid containment barrier across the container top so balls CANNOT fall out.
 */
export class ShakeManager {
  private active = false
  private startTime = 0
  private readonly durationMs = SHAKE_ABILITY.durationMs
  private clock: (() => number) | null = null
  private lidBody: Matter.Body | null = null
  private physicsWorld: {
    addBody: (b: Matter.Body) => void
    removeBody: (b: Matter.Body) => void
  } | null = null
  private manager: SoftBallManager | null = null

  setClock(fn: () => number): void {
    this.clock = fn
  }

  private now(): number {
    return this.clock ? this.clock() : performance.now()
  }

  bind(
    physicsWorld: { addBody: (b: Matter.Body) => void; removeBody: (b: Matter.Body) => void },
    manager: SoftBallManager | null = null,
  ): void {
    this.physicsWorld = physicsWorld
    this.manager = manager
  }

  get isActive(): boolean {
    return this.active
  }

  get remainingMs(): number {
    if (!this.active) return 0
    return Math.max(0, this.durationMs - (this.now() - this.startTime))
  }

  /**
   * Activates the shake ability for 10s.
   * Creates a solid physics lid at the current container rim/wall top.
   */
  activate(currentWallHeight: number): boolean {
    if (this.active) return false
    this.active = true
    this.startTime = this.now()
    this.createLid(currentWallHeight)
    return true
  }

  /**
   * Builds an impassable horizontal top lid body across the container mouth
   * preventing any balls from escaping.
   */
  private createLid(currentWallHeight: number): void {
    if (this.lidBody && this.physicsWorld) {
      this.physicsWorld.removeBody(this.lidBody)
      this.lidBody = null
    }

    const b = containerBounds()
    const rimY = b.floorY - currentWallHeight
    // Lid spans wider than the container mouth with substantial vertical thickness
    const corners = interiorCorners()
    const mouthW = Math.abs(corners.bottomRight.x - corners.bottomLeft.x) * 1.5
    const thickness = 60
    // Center lid slightly above the rim so balls resting inside don't clip through
    const centerY = rimY - thickness / 2

    const body = Matter.Bodies.rectangle(
      (corners.bottomLeft.x + corners.bottomRight.x) / 2,
      centerY,
      mouthW,
      thickness,
      {
        isStatic: true,
        label: 'shake-lid',
        friction: 0.1,
        restitution: 0.3,
      },
    )
    this.lidBody = body
    this.physicsWorld?.addBody(body)
  }

  private removeLid(): void {
    if (this.lidBody && this.physicsWorld) {
      this.physicsWorld.removeBody(this.lidBody)
      this.lidBody = null
    }
  }

  /**
   * Updates earthquake shaking and checks timer expiration.
   * Returns current earthquake offsets (dx, dy, angle) for visual rendering.
   */
  update(timeMs: number): { dx: number; dy: number; angle: number; active: boolean } {
    if (!this.active) {
      return { dx: 0, dy: 0, angle: 0, active: false }
    }

    const elapsed = this.now() - this.startTime
    if (elapsed >= this.durationMs) {
      this.active = false
      this.removeLid()
      return { dx: 0, dy: 0, angle: 0, active: false }
    }

    // Earthquake tremor calculation
    const tSec = timeMs / 1000
    const f = SHAKE_ABILITY.tremorFreqHz
    // Chaotic superposition of frequencies for organic earthquake feel
    const dx =
      Math.sin(tSec * f * 6.283) * SHAKE_ABILITY.ampX * 0.7 +
      Math.sin(tSec * f * 3.17 * 6.283) * SHAKE_ABILITY.ampX * 0.3
    const dy =
      Math.cos(tSec * f * 1.414 * 6.283) * SHAKE_ABILITY.ampY * 0.6 +
      Math.sin(tSec * f * 2.73 * 6.283) * SHAKE_ABILITY.ampY * 0.4
    const angle = Math.sin(tSec * f * 0.85 * 6.283) * SHAKE_ABILITY.ampAngle

    // Agitate live balls with mild earthquake velocity/impulse
    if (this.manager) {
      const balls = this.manager.getBalls()
      for (const b of balls) {
        if (b.state === 'removed') continue
        // Wake ball so physics reacts to shake
        this.manager.wakeBall(b.id)
        const jitterX = (Math.random() - 0.5) * SHAKE_ABILITY.physicsJitterImpulse * b.body.mass
        const jitterY = (Math.random() - 0.7) * SHAKE_ABILITY.physicsJitterImpulse * b.body.mass
        Matter.Body.applyForce(b.body, b.body.position, { x: jitterX, y: jitterY })
      }
    }

    return { dx, dy, angle, active: true }
  }

  reset(): void {
    this.active = false
    this.removeLid()
  }
}
