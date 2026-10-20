import Phaser from 'phaser'
import { INK, ballOutlineWidth, wobbleContour } from './BallAppearance'
import type { BallLook } from './BallAppearance'
import type { SoftBallEntity } from '../systems/SoftBallManager'
import { softBallCentroid } from '../systems/SoftBall'

/**
 * IMPACT WOBBLE OVERLAY (SpriteBalls) — the visible dent/bulge that the
 * transform-only sprite path cannot express. While a ball's deform springs
 * are active (aspect deviation from round, i.e. a real impact transient),
 * this overlay draws the LIVE wobbled contour (same look as the pre-sprite
 * renderer: fill + ink stroke through a Graphics) for AT MOST the
 * WobbleOverlay.MAX_BALLS highest-amplitude balls per frame — a bounded
 * 1–3 vector draws only during impacts; the steady-state pile stays 100%
 * batched sprites.
 *
 * Draw order: this Graphics sits at depth 9.6 — above every fill quad
 * (9.5), below the live Graphics (10) that owns faces and awake outlines.
 * An overlay ball's outline is drawn here; the sprite outline quad for
 * that ball is hidden by the renderer while the overlay is active.
 */
export class WobbleOverlay {
  /** Max balls whose live wobble contour draws per frame (bounded cost). */
  static readonly MAX_BALLS = 3
  /** Amplitude (aspect deviation from 1) above which a ball's live wobble
   * draws. Measured deform transients peak at aspect ≈ 0.62; rest churn
   * stays ≥ 0.96 — the gate sits well inside the gap. */
  static readonly AMP_GATE = 0.955

  readonly g: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(9.6)
  }

  /**
   * Draw the wobble contour for the highest-amplitude balls. Called from
   * SoftBallRenderer.update() AFTER the sprite pass; `items` carries every
   * drawn ball's live geometry (already computed for the transform pass).
   */
  draw(
    items: Array<{
      entity: SoftBallEntity
      look: BallLook
      r: number
      poly: Phaser.Math.Vector2[]
      cx: number
      cy: number
      color: number
      aspect: number
    }>,
  ): number {
    this.g.clear()
    // Rank by deform amplitude (furthest from round), take the top N.
    const active = items
      .filter((it) => it.aspect < WobbleOverlay.AMP_GATE)
      .sort((a, b) => a.aspect - b.aspect)
      .slice(0, WobbleOverlay.MAX_BALLS)
    for (const it of active) {
      this.g.fillStyle(it.color, 1)
      this.g.fillPoints(it.poly, true)
    }
    for (const it of active) {
      this.g.lineStyle(ballOutlineWidth(it.r), INK, 1)
      this.g.strokePoints(it.poly, true, true)
    }
    return active.length
  }

  /** Live wobbled contour for one ball (renderer helper — same pipeline as
   * the pre-sprite renderer: particle-ring catmull-rom + look wobble). */
  static buildContour(entity: SoftBallEntity, look: BallLook, drawR: number): { poly: Phaser.Math.Vector2[]; cx: number; cy: number } {
    const soft = entity.soft
    const ring: Array<{ x: number; y: number }> = soft.particles.map((p) => ({ x: p.position.x, y: p.position.y }))
    const c = softBallCentroid(soft)
    // Full catmull-rom via the shared appearance pipeline: wobbleContour
    // takes arbitrary points and displaces them radially — feeding it the
    // RAW particle ring + the look reproduces the character wobble; the
    // smoothing pass inside keeps the curve soft between the 16 particles.
    const built = wobbleContour(look, ring, c.x, c.y, drawR, 1.5)
    return { poly: built as unknown as Phaser.Math.Vector2[], cx: c.x, cy: c.y }
  }

  destroy(): void {
    this.g.destroy()
  }
}
