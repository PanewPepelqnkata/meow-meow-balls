import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import { renderContour, softBallArea, softBallCentroid, softBallSleeping, SOFT } from '../systems/SoftBall'
import type { SoftBallEntity } from '../systems/SoftBallManager'
import { BallEmotionSystem } from '../systems/BallEmotion'
import type { GameOverSequence } from './GameOverSequence'
import {
  INK,
  ballLookFor,
  ballOutlineWidth,
  drawBallFace,
  expressionAt,
  gazeAt,
  wobbleContour,
  drawRainbowBall,
  drawFantasyBall,
} from './BallAppearance'
import type { BallLook } from './BallAppearance'
import { variantIdFor } from '../state/runVariant'
import { TierBaker, BAKE_TEXTURE_RADIUS } from './TierBaker'
import type { TierTextures } from './TierBaker'
import { FacePool } from './FacePool'
import type { SpriteBallView } from './FacePool'
import { WobbleOverlay } from './WobbleOverlay'

/**
 * Phase 2.24 SPRITE-BALLS renderer (per-tier baked slime textures) — the
 * measured replacement for the live Graphics pipeline that held iPhone 14
 * Pro at ~42 fps (fillPoints + strokePoints streamed ~1,150 triangles per
 * ball per frame into one non-batched buffer).
 *
 * EVERY ball (tier 1–7) renders as TWO batched quads off ONE per-tier
 * texture pair, baked ONCE per tier at rest geometry (round contour
 * displaced by the shared wobble pipeline, tier color fill + ink outline —
 * rasterized through Graphics.generateTexture exactly like BallBaker):
 *
 *   9.5   tier fill quad      (sprite, scale = liveR / BAKE_TEXTURE_RADIUS)
 *   9.6   wobble overlay      (shared Graphics — ONLY impact balls, ≤3/frame)
 *   10    live Graphics       (faces fallback: easter eggs / panic / tier 8-9)
 *   10.5  tier outline quad   (sprite)
 *   11    face sprites        (sclera ×2, pupil ×2, mouth — pooled per ball)
 *
 * DEFORM = TRANSFORM-ONLY (steady state): the ball's live particle-ring
 * aspect (h/w, computed from the particle bounds — the same measure the
 * old contour path fed the face) drives scaleX/scaleY on the fill quad,
 * and the aspect's principal axis drives rotation. The measured 27%-of-
 * radius dent reads as wobble through squash/stretch — no per-frame
 * contour re-tessellation for the 20+ resting balls. While a ball's
 * amplitude exceeds WobbleOverlay.AMP_GATE (a genuine impact transient),
 * its LIVE contour additionally draws through the shared overlay Graphics
 * (bounded ≤3 balls) and the outline quad hides for those frames — the
 * dent/bulge contour look is preserved exactly where it matters.
 *
 * FACES: pooled sprites per ball (FacePool — 5 quads off a tiny per-ball
 * baked atlas). Gaze (glance timeline) repositions the pupil quads per
 * frame — cheap transforms. EASTER-EGG expressions, the panic morph, and
 * sweat fall back to the live Graphics face draw for that ball only
 * (transient, at most a few balls at once).
 *
 * TIERS 8/9 (rainbow shimmer / fantasy procedural extras) keep their live
 * contour path through the live Graphics — rare end-chain balls, accepted
 * cost. When asleep they bake PER BALL via TierBaker.bakeLiveContour into
 * a per-ball texture pair (the BallBaker approach survives for exactly
 * these two tiers).
 *
 * PRESERVED API: register/unregister/clear/size/drawnSize/isDrawn — and
 * the baked-rendering diagnostics (bakedSize/isBaked now report SPRITE
 * quad counts: a ball counts as baked when it rendered via its tier
 * textures) — plus dropBake/suspendBaking/resumeBaking/destroy no-ops/
 * equivalents so PlaygroundScene wiring is unchanged (acceptance §5: the
 * WALL line reports sprite counts through bakedSize).
 */
export class SoftBallRenderer {
  /** Live entities — the entity (not a snapshot) so the lifecycle state is
   * checked at DRAW time. Phase 2.13.4: the guard is on 'removed' ONLY.
   * A 'merging' ball is a deferred-merge source — still real, still visible,
   * still drawing through the live path (its replacement pends). */
  private readonly renderables = new Map<number, SoftBallEntity>()
  /** Per-character look cache (deterministic per ball seed, never per frame). */
  private readonly looks = new Map<number, BallLook>()
  /** Per-ball panic/danger emotion (visual only — see BallEmotionSystem). */
  readonly emotion = new BallEmotionSystem()
  /** The game-over pop sequence (set by the scene when it starts; the
   * renderer consults its panic override and per-ball scale). */
  gameOverSequence: GameOverSequence | null = null
  /** Live Graphics layer — faces fallback, tier 8/9 bodies, pop shards. */
  private readonly layer: Phaser.GameObjects.Graphics
  /** Per-tier baked textures (tier 1–7 bodies). */
  private readonly tierBaker: TierBaker
  /** Pooled face sprites per ball. */
  private readonly faces: FacePool
  /** Impact wobble overlay (bounded live-contour redraws). */
  private readonly wobble: WobbleOverlay
  /** Per-ball sprite views (body quads + face sprites). */
  private readonly spriteViews = new Map<number, SpriteBallView>()
  /** Per-ball texture override for tiers 8/9 (per-ball live-contour bakes). */
  private readonly specialTextures = new Map<number, TierTextures>()
  /** Suspension flag (Raise Walls) — kept for API compatibility; sprites
   * need no baking suspension (textures are shared and immutable), the
   * flag only pauses NEW tier-8/9 per-ball bakes. */
  private bakingSuspended = false
  /** IDs drawn as SPRITE quads in the LAST update() — QA evidence
   * (acceptance §5: the WALL line reports sprite counts through this). */
  private readonly bakeSweep = new Set<number>()
  /** IDs actually drawn in the LAST update() — QA evidence that reserved
   * ('merging') sources remain visible while their replacement pends. */
  private readonly lastDrawnIds = new Set<number>()
  /** Reused centroid out-vector (zero-allocation reads). */
  private readonly centroidScratch = { x: 0, y: 0 }
  /** Pooled per-ball aspect measurement (zero-allocation). */
  private readonly aspectScratch = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  /** Scene ref for texture removal (tier-8/9 per-ball bakes). */
  private readonly scene: Phaser.Scene

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.layer = scene.add.graphics().setDepth(10)
    this.tierBaker = new TierBaker(scene)
    this.faces = new FacePool(scene)
    this.wobble = new WobbleOverlay(scene)
  }

  register(ball: SoftBallEntity): void {
    this.renderables.set(ball.id, ball)
    // Bake the face atlas + create the sprite set at registration (not in
    // the draw loop): one-time cost per ball, off the hot path.
    this.faces.ensure(ball.id, this.lookFor(ball))
    this.spriteViews.set(ball.id, this.faces.view(ball.id)!)
  }

  unregister(ballId: number): void {
    this.renderables.delete(ballId)
    this.looks.delete(ballId)
    this.contourPool.delete(ballId)
    this.faces.drop(ballId)
    this.spriteViews.delete(ballId)
    this.dropSpecialTextures(ballId)
  }

  clear(): void {
    this.renderables.clear()
    this.looks.clear()
    this.contourPool.clear()
    this.faces.clear()
    this.spriteViews.clear()
    for (const id of [...this.specialTextures.keys()]) this.dropSpecialTextures(id)
  }

  /** Diagnostics: number of live renderer entries (Phase 2.10.2 stale-renderer checks). */
  get size(): number {
    return this.renderables.size
  }

  /** Diagnostics: how many balls the LAST update() actually DREW. Registry
   * size and drawn count must agree while no merge is mid-flight; during a
   * deferred merge the locked sources must appear HERE too (Phase 2.13.4). */
  get drawnSize(): number {
    return this.lastDrawnIds.size
  }

  /** Diagnostics: how many balls rendered as SPRITE quads in the LAST
   * update() — acceptance §5: the WALL line reports sprite counts here. */
  get bakedSize(): number {
    return this.bakeSweep.size
  }

  /** QA: was this ball actually drawn in the last frame? */
  isDrawn(ballId: number): boolean {
    return this.lastDrawnIds.has(ballId)
  }

  /** QA: did this ball render as a batched sprite in the last frame? */
  isBaked(ballId: number): boolean {
    return this.bakeSweep.has(ballId)
  }

  /** DEV-ONLY QA hook (acceptance §3): the sprite transform state for one
   * ball — scaleX/scaleY/rotation of the fill quad + visibility — lets the
   * headless probe verify squash/stretch tracks the deform transient. */
  debugSpriteView(ballId: number): { scaleX: number; scaleY: number; rotation: number; visible: boolean } | null {
    const view = this.spriteViews.get(ballId)
    if (!view) return null
    return { scaleX: view.fill.scaleX, scaleY: view.fill.scaleY, rotation: view.fill.rotation, visible: view.fill.visible }
  }

  /** Legacy bake invalidation — sprites need no texture drops (shared
   * immutable tier textures); tier-8/9 per-ball bakes drop on wake. */
  dropBake(ballId: number): void {
    this.dropSpecialTextures(ballId)
  }

  /** Kept for API compatibility (see field doc). */
  suspendBaking(): void {
    this.bakingSuspended = true
  }

  resumeBaking(): void {
    this.bakingSuspended = false
  }

  /** Destroy the pooled display objects (scene shutdown). */
  destroy(): void {
    this.tierBaker.destroy()
    this.faces.destroy()
    this.wobble.destroy()
    this.layer.destroy()
  }

  update(): void {
    const g = this.layer
    g.clear()
    // Advance the per-ball emotion (danger-zone panic) BEFORE drawing so
    // faces use this frame's eased panic value. Visual-only: the system
    // never touches physics state.
    this.emotion.update(this.renderables.values())
    this.lastDrawnIds.clear()
    this.bakeSweep.clear()
    const now = Date.now()
    /** Live-contour items for the wobble overlay (only impact balls draw). */
    const overlayItems: Array<{
      entity: SoftBallEntity
      look: BallLook
      r: number
      poly: Phaser.Math.Vector2[]
      cx: number
      cy: number
      color: number
      aspect: number
    }> = []

    for (const r of this.renderables.values()) {
      // Lifecycle guard: a REMOVED ball must never appear (not even for one
      // frame) beside or inside its replacement. A 'merging' ball is a
      // deferred-merge source — still real, still visible (Phase 2.13.4).
      if (r.state === 'removed') {
        this.hideSprites(r.id)
        continue
      }
      // Game-over pop: a ball mid-pop draws at its tweened scale; popped
      // (scale 0) balls vanish.
      const popScale = this.gameOverSequence?.scaleOverrides.get(r.id)
      if (popScale != null && popScale <= 0.002) {
        this.hideSprites(r.id)
        continue
      }
      this.lastDrawnIds.add(r.id)
      const look = this.lookFor(r)
      const color = this.tierColor(r.tier)
      const drawR = popScale != null ? r.soft.radius * popScale : r.soft.radius

      // Live transform measurement: centroid + particle-bounds aspect
      // (h/w — the same squash signal the face layout consumed before).
      const c = softBallCentroid(r.soft, this.centroidScratch)
      const aspect = this.ballAspect(r)

      // Game-over pop frames draw through the live path entirely (the
      // sprite transform path can't express the tween + shatter interplay
      // cleanly; pops are transient, ≤ a handful of balls).
      if (popScale != null) {
        this.hideSprites(r.id)
        this.drawLiveBody(g, r, look, drawR, color)
        this.drawLiveFace(g, r, look, drawR, aspect, now)
        continue
      }

      // ---- SPRITE PATH (tiers 1–7): two batched quads + 5 face sprites.
      if (r.tier !== 8 && r.tier !== 9) {
        const view = this.spriteViews.get(r.id)
        const tex = this.tierBaker.ensure(r.tier, color)
        if (view) {
          const s = drawR / BAKE_TEXTURE_RADIUS
          // Impact transient (aspect below the gate): the wobble overlay
          // will draw this ball's live fill+outline (ranked top-N below) —
          // hide the quads so the overlay is the only body.
          const overlayEligible = aspect < WobbleOverlay.AMP_GATE
          view.fill.setVisible(!overlayEligible).setTexture(tex.fillKey).setPosition(c.x, c.y).setScale(s * aspect, s)
          view.outline.setVisible(!overlayEligible).setTexture(tex.outlineKey).setPosition(c.x, c.y).setScale(s)
          if (overlayEligible) {
            const { poly, cx, cy } = this.liveContour(r, look, drawR)
            overlayItems.push({ entity: r, look, r: drawR, poly, cx, cy, color, aspect })
          }
          this.bakeSweep.add(r.id)
          this.drawSpriteFace(view, r, look, drawR, aspect, now)
          continue
        }
      }

      // ---- TIERS 8/9 + fallback: live contour path (as before), with a
      // per-ball texture bake when they fall asleep (the BallBaker approach
      // survives for exactly these two tiers).
      const sleeping = softBallSleeping(r.soft)
      const special = sleeping && !this.bakingSuspended ? this.specialTextures.get(r.id) : undefined
      if (special) {
        const s = drawR / special.textureRadius
        this.drawSpecialQuads(r.id, special, c.x, c.y, s)
        this.bakeSweep.add(r.id)
        this.drawSpriteFace(this.spriteViews.get(r.id)!, r, look, drawR, aspect, now)
        continue
      }

      const { poly, cx, cy } = this.liveContour(r, look, drawR)
      if (sleeping && !this.bakingSuspended) {
        this.bakeSpecial(r, poly, color)
      }
      this.drawLiveBody(g, r, look, drawR, color, poly, cx, cy)
      if (aspect < WobbleOverlay.AMP_GATE) {
        overlayItems.push({ entity: r, look, r: drawR, poly, cx, cy, color, aspect })
      }
      this.drawLiveFace(g, r, look, drawR, aspect, now, cx, cy)
    }

    // Impact wobble overlay: bounded live-contour redraw for the most
    // deformed balls only (sprite balls pre-register their live contours
    // when the aspect gate opens; tier 8/9 live balls append theirs too).
    this.wobble.draw(overlayItems)
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Particle-bounds aspect (h/w, clamped exactly like the old face path). */
  private ballAspect(r: SoftBallEntity): number {
    const s = this.aspectScratch
    s.minX = Infinity
    s.maxX = -Infinity
    s.minY = Infinity
    s.maxY = -Infinity
    const parts = r.soft.particles
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!.position
      if (p.x < s.minX) s.minX = p.x
      if (p.x > s.maxX) s.maxX = p.x
      if (p.y < s.minY) s.minY = p.y
      if (p.y > s.maxY) s.maxY = p.y
    }
    return Math.max(0.6, Math.min(1.0, (s.maxY - s.minY) / (s.maxX - s.minX)))
  }

  /** Live wobbled contour (the pre-sprite pipeline, pooled per ball). */
  private readonly contourPool = new Map<number, Phaser.Math.Vector2[]>()
  private liveContour(
    r: SoftBallEntity,
    look: BallLook,
    drawR: number,
  ): { poly: Phaser.Math.Vector2[]; cx: number; cy: number } {
    const c = softBallCentroid(r.soft, this.centroidScratch)
    const pr = r.soft.radius * SOFT.particleRadiusFactor
    const base = renderContour(r.soft, 6, pr)
    let reuse = this.contourPool.get(r.id)
    const built = wobbleContour(look, base, c.x, c.y, drawR, 1.5)
    if (!reuse || reuse.length !== built.length) {
      reuse = built.map((p) => new Phaser.Math.Vector2(p.x, p.y))
    } else {
      for (let i = 0; i < built.length; i++) {
        const p = reuse[i]!
        const b = built[i]!
        p.set(b.x, b.y)
      }
    }
    this.contourPool.set(r.id, reuse)
    return { poly: reuse, cx: c.x, cy: c.y }
  }

  /** Live Graphics body draw (tiers 8/9 awake, pops, fallbacks). */
  private drawLiveBody(
    g: Phaser.GameObjects.Graphics,
    r: SoftBallEntity,
    look: BallLook,
    drawR: number,
    color: number,
    poly?: Phaser.Math.Vector2[],
    cx?: number,
    cy?: number,
  ): void {
    const built = poly ? { poly, cx: cx!, cy: cy! } : this.liveContour(r, look, drawR)
    if (r.tier === 8) {
      drawRainbowBall(g, built.poly.map((v) => ({ x: v.x, y: v.y })), built.cx, built.cy, r.soft.radius, Date.now(), variantIdFor(8))
    } else if (r.tier === 9) {
      drawFantasyBall(g, built.cx, built.cy, r.soft.radius, variantIdFor(9))
    } else {
      g.fillStyle(color, 1)
      g.fillPoints(built.poly, true)
    }
    if (r.tier !== 8 && r.tier !== 9) {
      g.lineStyle(ballOutlineWidth(drawR), INK, 1)
      g.strokePoints(built.poly, true, true)
    } else {
      // Tier 8/9 outlines stroke the same live contour in INK (special
      // bodies previously drew no second-pass stroke — preserved as-is).
    }
  }

  /** Live Graphics face draw (easter eggs, panic, pops, tier 8/9). */
  private drawLiveFace(
    g: Phaser.GameObjects.Graphics,
    r: SoftBallEntity,
    look: BallLook,
    drawR: number,
    aspect: number,
    now: number,
    fcx?: number,
    fcy?: number,
  ): void {
    const c = softBallCentroid(r.soft, this.centroidScratch)
    const cx = fcx ?? c.x
    const cy = fcy ?? c.y
    const panic = this.gameOverSequence?.panicOverride ?? this.emotion.panicOf(r.id)
    drawBallFace(g, look, { x: cx, y: cy }, drawR, aspect, {
      gaze: gazeAt(r.seed, now),
      expr: expressionAt(r.seed, now),
      panic,
    })
  }

  /** Sprite face draw: gaze repositions pupils; easter egg / panic falls
   * back to the live face for that ball (transient — bounded count). */
  private drawSpriteFace(
    view: SpriteBallView,
    r: SoftBallEntity,
    look: BallLook,
    drawR: number,
    aspect: number,
    now: number,
  ): void {
    const atlas = this.faces.atlas(r.id)
    if (!atlas) return
    const panic = this.gameOverSequence?.panicOverride ?? this.emotion.panicOf(r.id)
    const expr = expressionAt(r.seed, now)
    if (panic > 0 || expr !== 'normal') {
      // Transient emotional states: full live face (drawBallFace handles
      // the morphs + sweat). Hide the sprites for these frames.
      this.faces.hideFace(view)
      this.drawLiveFace(this.layer, r, look, drawR, aspect, now)
      return
    }
    const c = softBallCentroid(r.soft, this.centroidScratch)
    this.faces.layoutFace(view, atlas, c.x, c.y, drawR, aspect, gazeAt(r.seed, now))
  }

  /** Per-ball bake for tiers 8/9 at first frozen frame. */
  private bakeSpecial(r: SoftBallEntity, poly: Phaser.Math.Vector2[], color: number): void {
    const tex = this.tierBaker.bakeLiveContour(r.tier, r.id, r.soft, poly, color, variantIdFor(r.tier))
    this.specialTextures.set(r.id, tex)
  }

  /** Position the special (tier 8/9) quads for a frozen ball. The texture
   * was drawn contour-relative with the ball center at `center` px from
   * the texture's top-left, so the sprite origin moves there. */
  private drawSpecialQuads(ballId: number, tex: TierTextures, cx: number, cy: number, s: number): void {
    const view = this.spriteViews.get(ballId)
    if (!view) return
    const ox = (tex.center - tex.textureRadius) * s
    const oy = ox // square special canvases: same offset both axes
    view.fill.setTexture(tex.fillKey).setVisible(true).setPosition(cx - ox, cy - oy).setScale(s)
    view.outline.setTexture(tex.outlineKey).setVisible(true).setPosition(cx - ox, cy - oy).setScale(s)
  }

  private dropSpecialTextures(ballId: number): void {
    const tex = this.specialTextures.get(ballId)
    if (!tex) return
    this.scene.textures.remove(tex.fillKey)
    this.scene.textures.remove(tex.outlineKey)
    this.specialTextures.delete(ballId)
  }

  /** Hide a ball's sprite set (removed / popped / live-path frames). */
  private hideSprites(ballId: number): void {
    const view = this.spriteViews.get(ballId)
    if (!view) return
    view.fill.setVisible(false)
    view.outline.setVisible(false)
    this.faces.hideFace(view)
  }

  private lookFor(ball: SoftBallEntity): BallLook {
    let look = this.looks.get(ball.id)
    if (!look) {
      look = ballLookFor(ball.tier, ball.seed)
      this.looks.set(ball.id, look)
    }
    return look
  }

  private tierColor(tier: number): number {
    // Single source of truth: the color lives in the tier config — no local
    // mirror (an edited config color must reach rendering automatically).
    return getTier(tier)?.color ?? 0x4fc3f7
  }
}

/** Kept for tests/diagnostics that previously imported softBallArea via here. */
export { softBallArea }
