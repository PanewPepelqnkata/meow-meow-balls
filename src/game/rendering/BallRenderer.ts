import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import { createDeformState, registerImpact, stepDeform, contourRadii } from './deform'
import type { DeformState } from './deform'

const CONTOUR_SEGMENTS = 40

interface Renderable {
  id: number
  tier: number
  body: Matter.Body
  state: DeformState
  /** Diagnostic: frames until the spring reaches exact rest after last impact. */
  restCountdown: number
  /** Diagnostic: max |squash| this ball has reached (proves contour deformation). */
  peakSquash: number
}

export interface ImpactDiagnostic {
  ballId: number
  magnitude: number
  dirX: number
  dirY: number
  maxDisplacementPx: number
  strength: number
}

/**
 * Phase 2.4 rendering: each ball is drawn PROCEDURALLY into one shared
 * Graphics layer — the full silhouette (20-segment contour) is rebuilt every
 * frame from the deformation state, so the entire shape (outline included)
 * deforms, and face features are drawn in the same transformed local frame.
 * This replaces the Phase 2 texture-scale approach, which could not visibly
 * deform because Matter resolves collisions before emitting collisionStart
 * (event-time approach speeds were ~19% of the real impact).
 */
export class BallRenderer {
  private readonly renderables = new Map<number, Renderable>()
  private readonly layer: Phaser.GameObjects.Graphics
  /** DEV ring buffer of the latest impacts (diagnostic, §4 mandatory). */
  readonly diagnostics: ImpactDiagnostic[] = []

  constructor(scene: Phaser.Scene) {
    this.layer = scene.add.graphics().setDepth(10)
  }

  register(ball: { id: number; tier: number; body: Matter.Body }): void {
    if (this.renderables.has(ball.id)) return
    this.renderables.set(ball.id, {
      ...ball,
      state: createDeformState(),
      restCountdown: 0,
      peakSquash: 0,
    })
  }

  unregister(ballId: number): void {
    this.renderables.delete(ballId)
  }

  clear(): void {
    this.renderables.clear()
    this.diagnostics.length = 0
  }

  /** Feed one collision impact for a ball (world-space normal + approach speed). */
  registerImpact(
    ballId: number,
    normalX: number,
    normalY: number,
    approachSpeed: number,
    radius: number,
    bodyAngle: number,
  ): void {
    const r = this.renderables.get(ballId)
    if (!r) return
    registerImpact(r.state, normalX, normalY, approachSpeed, radius, bodyAngle)
    const strength = Math.min(1, approachSpeed / (18 * (radius / 48)))
    if (strength > 0.05) {
      this.diagnostics.unshift({
        ballId,
        magnitude: +approachSpeed.toFixed(2),
        dirX: +normalX.toFixed(2),
        dirY: +normalY.toFixed(2),
        maxDisplacementPx: +(strength * 0.2 * radius).toFixed(1),
        strength: +strength.toFixed(2),
      })
      if (this.diagnostics.length > 8) this.diagnostics.length = 8
      r.restCountdown = 90
    }
  }

  /** Redraw every ball into the shared Graphics layer. */
  update(deltaMs: number): void {
    const g = this.layer
    g.clear()

    for (const r of this.renderables.values()) {
      const tier = getTier(r.tier)
      if (!tier) continue
      stepDeform(r.state, deltaMs)
      r.peakSquash = Math.max(r.peakSquash, Math.abs(r.state.squash))
      if (r.restCountdown > 0) r.restCountdown -= 1

      const { x: cx, y: cy } = r.body.position
      const angle = r.body.angle
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const raw = contourRadii(r.state, tier.radius, CONTOUR_SEGMENTS)
      // Circular smoothing pass: kills polygon artifacts, keeps the dent/bulge
      const radii = raw.map((v, i) => (raw[(i - 1 + CONTOUR_SEGMENTS) % CONTOUR_SEGMENTS]! + 2 * v + raw[(i + 1) % CONTOUR_SEGMENTS]!) / 4)
      const pts: Phaser.Math.Vector2[] = []
      for (let i = 0; i < CONTOUR_SEGMENTS; i++) {
        const a = (i / CONTOUR_SEGMENTS) * Math.PI * 2
        const lx = Math.cos(a) * radii[i]!
        const ly = Math.sin(a) * radii[i]!
        pts.push(new Phaser.Math.Vector2(cx + lx * cos - ly * sin, cy + lx * sin + ly * cos))
      }

      // Body fill + thick outline follow the SAME deformed contour
      g.fillStyle(tier.color, 1)
      g.fillPoints(pts, true)
      g.lineStyle(Math.max(4, tier.radius * 0.1), 0x1a1a1a, 1)
      g.strokePoints(pts, true, true)

      // Face drawn in the body's local frame, scaled with the same
      // deformation (position + size derive from the contour radii).
      const drawLocal = (lx: number, ly: number, draw: (x: number, y: number, s: number) => void) => {
        const wx = cx + lx * cos - ly * sin
        const wy = cy + lx * sin + ly * cos
        // Local scale approximation at the feature's direction
        const fa = Math.atan2(ly, lx)
        const idx = Math.round(((fa + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / CONTOUR_SEGMENTS)) % CONTOUR_SEGMENTS
        const s = (radii[idx] ?? tier.radius) / tier.radius
        draw(wx, wy, s)
      }

      const r0 = tier.radius
      const eyeY = -r0 * 0.04
      const eyeDx = r0 * 0.36
      const eyeR = r0 * 0.2
      const pupilR = eyeR * 0.55
      for (const dx of [-eyeDx, eyeDx]) {
        drawLocal(dx, eyeY, (x, y, s) => {
          g.fillStyle(0xffffff, 1)
          g.fillCircle(x, y, eyeR * s)
          g.fillStyle(0x1a1a1a, 1)
          g.fillCircle(x, y, pupilR * s)
          g.fillStyle(0xffffff, 1)
          g.fillCircle(x - pupilR * 0.3 * s, y - pupilR * 0.35 * s, pupilR * 0.3 * s)
        })
      }
      // Two body highlights
      drawLocal(-r0 * 0.4, -r0 * 0.48, (x, y, s) => {
        g.fillStyle(0xffffff, 0.85)
        g.fillEllipse(x, y, r0 * 0.42 * s, r0 * 0.28 * s)
      })
      drawLocal(r0 * 0.05, -r0 * 0.66, (x, y, s) => {
        g.fillStyle(0xffffff, 0.65)
        g.fillCircle(x, y, r0 * 0.07 * s)
      })
      // Tiny mouth
      drawLocal(0, r0 * 0.3, (x, y, s) => {
        g.lineStyle(Math.max(2, r0 * 0.06 * s), 0x1a1a1a, 1)
        g.beginPath()
        g.arc(x, y, r0 * 0.12 * s, Phaser.Math.DegToRad(25), Phaser.Math.DegToRad(155))
        g.strokePath()
      })
    }
  }

  /** True when every ball's spring is at exact rest (test/diagnostic helper). */
  allAtRest(): boolean {
    for (const r of this.renderables.values()) {
      if (r.state.squash !== 0 || r.state.cross !== 0) return false
    }
    return true
  }

  /** Max |squash| currently active (test/diagnostic helper). */
  get maxActiveSquash(): number {
    let m = 0
    for (const r of this.renderables.values()) m = Math.max(m, Math.abs(r.state.squash))
    return m
  }

  get restCountdownMin(): number {
    let m = Infinity
    for (const r of this.renderables.values()) m = Math.min(m, r.restCountdown)
    return m
  }

  /**
   * DEV diagnostic (§5): the actual RENDERED contour displacement vs the
   * undeformed circle, for the most-deformed ball — per sampled angle.
   * Positive = outward bulge, negative = inward dent. This reads the same
   * radii the renderer draws (post-smoothing), not the spring state.
   */
  renderedContourDisplacement(): { ballId: number; samples: number[]; maxIn: number; maxOut: number } | null {
    let best: Renderable | null = null
    let bestAmp = 0
    for (const r of this.renderables.values()) {
      const amp = Math.abs(r.state.squash) + Math.abs(r.state.cross)
      if (amp > bestAmp) {
        bestAmp = amp
        best = r
      }
    }
    if (!best || bestAmp < 0.02) return null
    const tier = getTier(best.tier)
    if (!tier) return null
    const raw = contourRadii(best.state, tier.radius, CONTOUR_SEGMENTS)
    const radii = raw.map((v, i) => (raw[(i - 1 + CONTOUR_SEGMENTS) % CONTOUR_SEGMENTS]! + 2 * v + raw[(i + 1) % CONTOUR_SEGMENTS]!) / 4)
    const samples = [0, 5, 10, 15, 20, 25, 30, 35].map((i) => +(radii[i]! - tier.radius).toFixed(2))
    return {
      ballId: best.id,
      samples,
      maxIn: +Math.min(...radii.map((r) => r - tier.radius)).toFixed(2),
      maxOut: +Math.max(...radii.map((r) => r - tier.radius)).toFixed(2),
    }
  }

  /** Diagnostic: peak |squash| observed since boot (proves visible deformation). */
  get peakSquashSinceBoot(): number {
    let m = 0
    for (const r of this.renderables.values()) {
      m = Math.max(m, Math.abs(r.state.squash), Math.abs(r.peakSquash))
    }
    return m
  }

  private peakIn = 0
  private peakOut = 0

  /** Diagnostic: deepest rendered inward displacement since boot (px). */
  get peakContourInward(): number {
    const c = this.renderedContourDisplacement()
    if (c) this.peakIn = Math.max(this.peakIn, -c.maxIn, c.maxIn < 0 ? -c.maxIn : 0)
    return this.peakIn
  }

  /** Diagnostic: largest rendered outward displacement since boot (px). */
  get peakContourOutward(): number {
    const c = this.renderedContourDisplacement()
    if (c) this.peakOut = Math.max(this.peakOut, Math.max(c.maxOut, 0))
    return this.peakOut
  }
}
