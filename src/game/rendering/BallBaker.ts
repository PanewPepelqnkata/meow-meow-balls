import Phaser from 'phaser'
import { INK, ballOutlineWidth, drawFantasyBall } from './BallAppearance'
import { variantIdFor } from '../state/runVariant'
import type { SoftBallEntity } from '../systems/SoftBallManager'

/**
 * Per-ball BAKED RENDERING (settled-state kill) — one small texture pair per
 * fully-sleeping ball: a FILL texture and an OUTLINE texture, rasterized once
 * through the exact same Graphics command pipeline the live renderer uses
 * (`generateTexture` → canvas raster → GPU upload), then displayed as two
 * textured quads. A sleeping ball's rendered pixels are FROZEN (its contour
 * cache already guarantees the geometry never changes), so the per-frame
 * renderContour + wobbleContour + fillPoints (Earcut) + strokePoints work
 * disappears for every settled ball.
 *
 * WHY TWO TEXTURES — the two-pass guarantee: adjacent balls' outlines must
 * BOTH stay visible at contact points (a later ball's fill must never cut
 * into an earlier ball's outline). Baking fill+outline into ONE texture would
 * render each baked ball as a complete sprite and break that guarantee
 * against every neighbor. Splitting into a fill quad and an outline quad and
 * layering them AROUND the live Graphics layer reproduces the two-pass order
 * exactly:
 *
 *   depth 9.5   baked FILL quads     (pass 1 alongside the live fills)
 *   depth 10    live Graphics        (awake fills → awake strokes → ALL faces)
 *   depth 10.5  baked OUTLINE quads  (pass 2, above every fill incl. awake)
 *
 * Faces are NOT baked: gaze (pupils dart every ~4 s), easter-egg expressions
 * (10–30 s flashes) and the BallEmotionSystem's panic level (danger zone
 * rides Raise Walls) all stay LIVE for sleeping balls — the face loop keeps
 * drawing them per frame with the frozen centroid, so settled piles look and
 * behave identically while their bodies cost two quads instead of ~1,150
 * streamed triangles.
 *
 * LIFECYCLE / INVALIDATION: the renderer re-evaluates `softBallSleeping` at
 * DRAW time every frame — baked pixels are only ever DISPLAYED through that
 * pass, so a ball that wakes (collision, auditStuckBalls, wall raise, merge
 * displacement, partial-wake repair — every wake funnels through a state the
 * draw pass sees) drops its textures the same frame it can no longer be
 * drawn frozen, before any stale pixel can reach the screen. Explicit drops
 * also fire from unregister (merge source removal / game-over pop) and
 * clear() (restart). Texture keys are per ball id; ids are never reused
 * within a run.
 *
 * MEMORY: size = (2·r + 2·pad)² per texture, ≤ ~190² px for the largest tier
 * → a few hundred KB per ball at most, ≤ 2 textures × ≤ ~30 balls — bounded.
 */
export const BAKE_FILL_DEPTH = 9.5
export const BAKE_OUTLINE_DEPTH = 10.5

/** One baked ball: its two quads + the frozen centroid (face anchor). */
export interface BakedBallView {
  fill: Phaser.GameObjects.Image
  outline: Phaser.GameObjects.Image
  cx: number
  cy: number
}

export class BallBaker {
  private readonly baked = new Map<number, BakedBallView>()
  /** Offline command-buffer scratch — never visible, cleared per bake. */
  private readonly tempG: Phaser.GameObjects.Graphics

  constructor(private readonly scene: Phaser.Scene) {
    this.tempG = scene.add.graphics().setVisible(false)
  }

  /** Live bake records by ball id (read-only snapshot access for the
   * renderer's draw-time check; lifecycle stays internal). */
  views(): ReadonlyMap<number, BakedBallView> {
    return this.baked
  }

  /**
   * Rasterize the ball's frozen fill + outline into two textures and display
   * them as quads. `poly` is the ball's final wobbled contour (absolute world
   * coordinates), as built by the renderer on the ball's first frozen frame.
   */
  bake(entity: SoftBallEntity, poly: Phaser.Math.Vector2[], color: number, cx: number, cy: number): BakedBallView {
    const r = entity.soft.radius
    // Outer stroke half + antialiasing margin (the stroke straddles the
    // contour; half of it lies outside the polygon).
    const pad = ballOutlineWidth(r) / 2 + 3
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const p of poly) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    if (entity.tier === 9) {
      // Fantasy extras reach beyond the contour: horn to cy − 1.35r, mane
      // ellipses to cx ± 0.95r. Widen the canvas so nothing clips.
      minX = Math.min(minX, cx - r * 1.05)
      maxX = Math.max(maxX, cx + r * 1.05)
      minY = Math.min(minY, cy - r * 1.4)
      maxY = Math.max(maxY, cy + r * 1.15)
    }
    const originX = minX - pad
    const originY = minY - pad
    const w = Math.ceil(maxX - minX) + pad * 2
    const h = Math.ceil(maxY - minY) + pad * 2
    const fillKey = `br-bake-fill-${entity.id}`
    const outlineKey = `br-bake-out-${entity.id}`

    // The offline pass draws the command buffer at the Graphics' own position
    // (TargetCamera matrices are identity): position the scratch layer at
    // −origin so world point (originX, originY) lands on canvas (0, 0).
    this.tempG.clear()
    this.tempG.setPosition(-originX, -originY)
    if (entity.tier === 9) {
      drawFantasyBall(this.tempG, cx, cy, r, variantIdFor(9))
    } else {
      this.tempG.fillStyle(color, 1)
      this.tempG.fillPoints(poly, true)
    }
    this.tempG.generateTexture(fillKey, w, h)

    this.tempG.clear()
    this.tempG.lineStyle(ballOutlineWidth(r), INK, 1)
    this.tempG.strokePoints(poly, true, true)
    this.tempG.generateTexture(outlineKey, w, h)
    this.tempG.clear()

    // Reuse the quads across rebakes (a wake/deform/resleep cycle) — only the
    // texture contents change; position is identical for the same ball.
    let rec = this.baked.get(entity.id)
    if (rec) {
      rec.fill.setTexture(fillKey).setPosition(originX, originY)
      rec.outline.setTexture(outlineKey).setPosition(originX, originY)
    } else {
      rec = {
        fill: this.scene.add
          .image(originX, originY, fillKey)
          .setOrigin(0, 0)
          .setDepth(BAKE_FILL_DEPTH),
        outline: this.scene.add
          .image(originX, originY, outlineKey)
          .setOrigin(0, 0)
          .setDepth(BAKE_OUTLINE_DEPTH),
        cx,
        cy,
      }
      this.baked.set(entity.id, rec)
    }
    return rec
  }

  /** Drop one ball's baked textures (wake / pop / removal). */
  drop(id: number): void {
    const rec = this.baked.get(id)
    if (!rec) return
    rec.fill.destroy()
    rec.outline.destroy()
    this.scene.textures.remove(`br-bake-fill-${id}`)
    this.scene.textures.remove(`br-bake-out-${id}`)
    this.baked.delete(id)
  }

  /** Drop everything (restart flow). */
  clear(): void {
    for (const id of [...this.baked.keys()]) this.drop(id)
  }

  destroy(): void {
    this.clear()
    this.tempG.destroy()
  }
}
