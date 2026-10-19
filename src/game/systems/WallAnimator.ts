import Matter from 'matter-js'
import { CONTAINER, wallCollidersAt, tipCollidersAt } from '../../config/container'
import type { SoftBallManager } from './SoftBallManager'

export type WallPhase = 'normal' | 'raising' | 'raised' | 'lowering'

const ANIM_MS = 900 // raise/lower animation duration
const HOLD_MS = 25_000

/**
 * Phase 2.9.6 Raise Walls ability: animates both side walls between the
 * normal (short) height and the raised height, symmetrically. The Matter
 * wall bodies are updated via setVertices + setPosition each frame (static
 * bodies, no velocity injection), and the scene re-renders the striped bands
 * from the same geometry. Balls in contact are pushed by Matter's contact
 * solver against the moving vertices — and the contact-separation pass
 * cleans any transient overlap, so nothing tunnels or gets launched.
 */
export class WallAnimator {
  private phase: WallPhase = 'normal'
  private phaseStart = 0
  private currentHeight: number = CONTAINER.height
  /** The scene's clock (Phaser time.now) — set by the scene so activate() and
   * update() share one timeline. Tests can inject a fake clock. */
  private clock: (() => number) | null = null
  setClock(fn: () => number): void {
    this.clock = fn
  }
  private now(): number {
    return this.clock ? this.clock() : performance.now()
  }
  private wallBodies: Matter.Body[] = []
  private tipBodies: Matter.Body[] = []
  private onGeometryChange: ((h: number) => void) | null = null
  private manager: SoftBallManager | null = null

  /** Wire the two wall bodies (left, right), the redraw callback, the ball
   * manager, and the two tip-cap bodies (animated along with the walls —
   * the caps ride the moving wall-top line). */
  bind(
    wallBodies: Matter.Body[],
    onGeometryChange: (h: number) => void,
    manager: SoftBallManager,
    tipBodies: Matter.Body[] = [],
  ): void {
    this.wallBodies = wallBodies
    this.tipBodies = tipBodies
    this.onGeometryChange = onGeometryChange
    this.manager = manager
  }

  get height(): number {
    return this.currentHeight
  }

  get phaseNow(): WallPhase {
    return this.phase
  }

  /** Remaining raised time in ms (0 when not raised/animating to raised). */
  get remainingMs(): number {
    if (this.phase === 'raised') return Math.max(0, HOLD_MS - (this.now() - this.phaseStart))
    return 0
  }

  get isActive(): boolean {
    return this.phase !== 'normal'
  }

  /** Total raise+hold+lower cycle length (ms) — used by the scene to time
   * baked-rendering suspension around the full wall animation. */
  animationDurationMs(): number {
    return ANIM_MS * 2 + HOLD_MS
  }

  activate(): boolean {
    if (this.isActive) return false // no re-trigger while active
    this.phase = 'raising'
    this.phaseStart = this.now()
    return true
  }

  /** Reset to normal (restart/shutdown). */
  reset(): void {
    this.phase = 'normal'
    this.currentHeight = CONTAINER.height
    this.applyHeight(CONTAINER.height)
  }

  private applyHeight(h: number): void {
    this.currentHeight = h
    const specs = wallCollidersAt(h)
    for (let i = 0; i < this.wallBodies.length && i < specs.length; i++) {
      const body = this.wallBodies[i]!
      const spec = specs[i]!
      // EXACT placement (Phase 2.10.0): Body.setVertices re-orients the given
      // vertices around their CENTER OF MASS and then translates them to
      // body.position — so position must be the AREA centroid for the final
      // vertices to land exactly on the spec. The old vertex-average centroid
      // left a small rigid offset (the collision surface sat measurably off
      // the visible wall lines after every raise/lower cycle).
      const c = Matter.Vertices.centre(spec.vertices as Matter.Vector[])
      Matter.Body.setPosition(body, c)
      Matter.Body.setVertices(body, spec.vertices.map((v) => ({ x: v.x, y: v.y })))
      // Close any residual float drift so vertices are exactly on spec.
      const specMinX = Math.min(...spec.vertices.map((v) => v.x))
      const specMinY = Math.min(...spec.vertices.map((v) => v.y))
      const dx = specMinX - body.bounds.min.x
      const dy = specMinY - body.bounds.min.y
      if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
        Matter.Body.translate(body, { x: dx, y: dy })
      }
    }
    // Tip caps ride the wall-top line: rebuild their fan at the new height
    // with the same exact-placement procedure as the walls.
    const tipSpecs = tipCollidersAt(h)
    for (let i = 0; i < this.tipBodies.length && i < tipSpecs.length; i++) {
      const body = this.tipBodies[i]!
      const spec = tipSpecs[i]!
      const c = Matter.Vertices.centre(spec.vertices as Matter.Vector[])
      Matter.Body.setPosition(body, c)
      Matter.Body.setVertices(body, spec.vertices.map((v) => ({ x: v.x, y: v.y })))
      const specMinX = Math.min(...spec.vertices.map((v) => v.x))
      const specMinY = Math.min(...spec.vertices.map((v) => v.y))
      const dx = specMinX - body.bounds.min.x
      const dy = specMinY - body.bounds.min.y
      if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
        Matter.Body.translate(body, { x: dx, y: dy })
      }
    }
    // Moving wall vertices never wake sleeping soft balls (static/sleeping
    // pairs are skipped by Matter's wake logic), so wake everything while the
    // rim is in motion — a settled pile must re-settle against the new rim.
    this.manager?.wakeAll()
    this.onGeometryChange?.(h)
  }

  private easeInOut(t: number): number {
    return t * t * (3 - 2 * t)
  }

  /** Per-frame update; call once per rendered frame. */
  update(nowMs: number): void {
    if (this.phase === 'normal') return
    const t = nowMs - this.phaseStart

    if (this.phase === 'raising') {
      const k = Math.min(1, t / ANIM_MS)
      this.applyHeight(CONTAINER.height + (CONTAINER.raisedHeight - CONTAINER.height) * this.easeInOut(k))
      if (k >= 1) {
        this.phase = 'raised'
        this.phaseStart = nowMs
      }
    } else if (this.phase === 'raised') {
      if (t >= HOLD_MS) {
        this.phase = 'lowering'
        this.phaseStart = nowMs
      }
    } else if (this.phase === 'lowering') {
      const k = Math.min(1, t / ANIM_MS)
      this.applyHeight(CONTAINER.raisedHeight - (CONTAINER.raisedHeight - CONTAINER.height) * this.easeInOut(k))
      if (k >= 1) {
        this.phase = 'normal'
        this.currentHeight = CONTAINER.height
      }
    }

    // Phase 2.9.9: no positional sweep here. With floor-anchored wall geometry
    // the rim (wall TOP) descends from y=425 to y=610 through open sky only —
    // balls never rest above the mouth. A falling ball the slab touches is
    // resolved by Matter's contact solver (the slab moves ≤ ~4px/frame) and,
    // if a particle CENTER crosses the wall line, by the manager's
    // clampToContainer backstop (velocity-preserving, wall-line aware — the
    // raised and normal walls share the same lines by construction). The
    // previous sweep (teleport to `rimY + 6`) was written against the old
    // inverted geometry where `topY + height` was the moving FLOOR line: it
    // yanked every particle toward/below the floor during lowering.
  }
}
