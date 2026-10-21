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
import {
  createDeformState,
  registerImpact,
  stepDeform,
  contourDisplacement,
  impactStrength,
} from './deform'
import type { DeformState } from './deform'
import { variantIdFor } from '../state/runVariant'
import { TierBaker } from './TierBaker'
import type { TierTextures } from './TierBaker'
import { FacePool } from './FacePool'
import type { SpriteBallView } from './FacePool'

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
  /** Overlay gate hysteresis: enter below 0.955, exit above 0.975 — the
   * damped deform oscillates across a single threshold 2-4×/impact and
   * the two render modes have different silhouettes (baked circle vs
   * wobbled poly) = the 'squished↔normal' flicker. */
  private readonly overlayOn = new Map<number, boolean>()
  /** Per-ball jelly deform spring (dent + bulge, fed by collision events). */
  private readonly deforms = new Map<number, DeformState>()
  /** Per-ball ACCUMULATED impact for the current frame: the strength-weighted
   * normal sum, the peak approach speed, and the peak strength. A soft body
   * is 16 particles, so one landing yields several collision events in the
   * same frame — they are summed here and applied ONCE per ball per frame
   * (flushImpacts) so the dent points at the real contact side and its
   * strength scales with the approach speed instead of the event count. */
  private readonly pendingImpacts = new Map<
    number,
    { x: number; y: number; speed: number }
  >()
  /** Scene ref for texture removal (tier-8/9 per-ball bakes). */
  private readonly scene: Phaser.Scene

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.layer = scene.add.graphics().setDepth(10)
    this.tierBaker = new TierBaker(scene)
    this.faces = new FacePool(scene)
  }

  register(ball: SoftBallEntity): void {
    this.renderables.set(ball.id, ball)
    // Bake the face atlas + create the sprite set at registration (not in
    // the draw loop): one-time cost per ball, off the hot path.
    this.faces.ensure(ball.id, this.lookFor(ball))
    this.spriteViews.set(ball.id, this.faces.view(ball.id)!)
  }

  /** PERF (iOS): pre-bake the NEXT ball's face atlas off the drop
   * frame (see FacePool.prewarm). */
  prewarmFace(tier: number, seed: number): void {
    this.faces.prewarm(tier, seed)
  }

  /** Feed a collision event into the ball's jelly deform spring.
   * Called from PlaygroundScene's per-frame collision drain.
   *
   * AGGREGATION: a soft body is 16 particles, so ONE landing produces
   * several particle-pair collision events in the same frame, each with a
   * slightly different normal. Exciting the spring per event would (a)
   * point the dent at whichever particle contacted LAST — a random side of
   * the ring, not the impact side — and (b) add a squash kick per event,
   * slamming the spring to max strength regardless of the approach speed
   * and destroying the gentle-vs-hard scaling. So the events are ACCUMULATED
   * per ball here and applied ONCE per ball per frame, in update().
   */
  registerBallImpact(
    r: SoftBallEntity,
    contactNormal: { x: number; y: number },
    approachSpeed: number,
  ): void {
    const strength = impactStrength(approachSpeed, r.soft.radius)
    if (strength <= 0) return
    let p = this.pendingImpacts.get(r.id)
    if (!p) {
      p = { x: 0, y: 0, speed: 0 }
      this.pendingImpacts.set(r.id, p)
    }
    // Strength-weighted normal sum: the dominant contact direction wins,
    // and the mean speed is the representative approach speed.
    p.x += contactNormal.x * strength
    p.y += contactNormal.y * strength
    p.speed = Math.max(p.speed, approachSpeed)
  }

  /** Apply the frame's accumulated impacts to the deform springs. */
  private flushImpacts(): void {
    if (this.pendingImpacts.size === 0) return
    for (const [id, p] of this.pendingImpacts) {
      const r = this.renderables.get(id)
      if (!r) continue
      const len = Math.hypot(p.x, p.y)
      if (len < 1e-6) continue
      let d = this.deforms.get(id)
      if (!d) {
        d = createDeformState()
        this.deforms.set(id, d)
      }
      const bodyAngle = r.soft.center.angle ?? 0
      registerImpact(d, p.x / len, p.y / len, p.speed, r.soft.radius, bodyAngle)
    }
    this.pendingImpacts.clear()
  }

  unregister(ballId: number): void {
    this.renderables.delete(ballId)
    this.looks.delete(ballId)
    this.contourPool.delete(ballId)
    this.overlayOn.delete(ballId)
    this.deforms.delete(ballId)
    this.pendingImpacts.delete(ballId)
    this.faces.drop(ballId)
    this.spriteViews.delete(ballId)
    this.dropSpecialTextures(ballId)
  }

  clear(): void {
    this.renderables.clear()
    this.looks.clear()
    this.contourPool.clear()
    this.overlayOn.clear()
    this.deforms.clear()
    this.pendingImpacts.clear()
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
    this.layer.destroy()
  }

  update(deltaMs = 16): void {
    const g = this.layer
    g.clear()
    // Advance the per-ball emotion (danger-zone panic) BEFORE drawing so
    // faces use this frame's eased panic value. Visual-only: the system
    // never touches physics state.
    this.emotion.update(this.renderables.values())
    // Step the jelly deform springs (visual only). The frame's accumulated
    // impacts are applied FIRST (one excitation per ball per frame), then
    // the springs advance.
    this.flushImpacts()
    for (const d of this.deforms.values()) stepDeform(d, deltaMs)
    this.lastDrawnIds.clear()
    this.bakeSweep.clear()
    const now = Date.now()
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
        this.faces.hideFace(this.spriteViews.get(r.id)!)
        this.drawLiveBody(g, r, look, drawR, color)
        this.drawLiveFace(g, r, look, drawR, aspect, now)
        continue
      }

      // ---- LIVE CONTOUR PATH (tiers 1–7): EVERY ball draws the live
      // particle-ring contour, awake or asleep — one render path, so
      // there is no sleep/wake mode switch and no sticker/contour snap.
      // (The contour is rebuilt from the physics every frame; the vertex
      // arrays are pooled, not cached.)
      if (r.tier !== 8 && r.tier !== 9) {
        const view = this.spriteViews.get(r.id)
        if (view) {
          const { poly } = this.liveContour(r, look, drawR)
          g.fillStyle(color, 1)
          g.fillPoints(poly, true)
          g.lineStyle(ballOutlineWidth(drawR), INK, 1)
          g.strokePoints(poly, true, true)
          this.bakeSweep.add(r.id)
          this.drawSpriteFace(view, r, drawR, aspect, now)
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
        this.drawSpriteFace(this.spriteViews.get(r.id)!, r, drawR, aspect, now)
        continue
      }

      const { poly, cx, cy } = this.liveContour(r, look, drawR)
      if (sleeping && !this.bakingSuspended) {
        this.bakeSpecial(r, poly, color)
      }
      this.drawLiveBody(g, r, look, drawR, color, poly, cx, cy)
      this.drawLiveFace(g, r, look, drawR, aspect, now, cx, cy)
    }
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
    // JELLY DENT: the deform spring's LOCALIZED contact dent (Gaussian
    // dip at the contact point + delayed bulge ring) is applied ON TOP of
    // the live physics contour. This is what makes a hit ball read as
    // jelly instead of a rigid body that silently changes shape. The
    // spring is stepped in update() and fed from real collision events
    // (registerBallImpact) — see PlaygroundScene's collision drain.
    const d = this.deforms.get(r.id)
    if (d && d.lastStrength > 0.001) {
      // The bulge is clamped per vertex against the particle collision
      // discs (the Phase 2.9.8 envelope invariant, pinned by
      // softball.test.ts) — the rendered surface can never cut into a
      // neighbour's.
      this.applyDent(reuse, d, c.x, c.y, r.soft.particles)
    }
    return { poly: reuse, cx: c.x, cy: c.y }
  }

  /**
   * Apply the deform spring's LOCALIZED displacement to a contour polygon.
   *
   * The contour is the LIVE physics-derived shape — this MODIFIES it by the
   * dent profile (a multiplicative factor on each vertex's radius from the
   * centroid), it does not replace it with a synthetic oval. The live
   * physics contour is what makes the ball read as a soft body; the dent is
   * the impact accent on top of it.
   *
   * The profile lives in the ball's LOCAL frame (the deform state stores
   * the contact direction rotated into that frame), so each vertex's world
   * angle is converted back to local before sampling.
   *
   * OUTWARD CLAMP: the rendered contour may never extend past the ball's
   * particle collision discs (the Phase 2.9.8 envelope invariant, pinned
   * by softball.test.ts) — a ball's visible surface must never cut into a
   * neighbour's.
   *
   * The rule is PER VERTEX and applies to the dent too, not just the
   * bulge: a vertex near the mid-edge between two particles, moved inward
   * toward the centroid, moves AWAY from both particles, so the dent can
   * breach the envelope as well. So each candidate position is TESTED
   * against the particle discs, and a vertex that would breach falls back
   * to its base position. The invariant then holds by construction: every
   * vertex is either the base point or a point proven inside the envelope.
   */
  private applyDent(
    poly: Phaser.Math.Vector2[],
    d: DeformState,
    cx: number,
    cy: number,
    particles: Matter.Body[],
  ): void {
    const n = poly.length
    const bodyR = particles.length ? (particles[0]!.circleRadius ?? 0) : 0
    for (let i = 0; i < n; i++) {
      const p = poly[i]!
      const dx = p.x - cx
      const dy = p.y - cy
      const dist = Math.hypot(dx, dy)
      if (dist < 1e-4) continue
      // World angle -> ball-local angle (counter-rotate by the body angle)
      const localAngle = Math.atan2(dy, dx) - d.bodyAngle
      const frac = contourDisplacement(d, localAngle)
      if (frac === 0) continue
      const scale = 1 + frac
      const nx = cx + dx * scale
      const ny = cy + dy * scale
      // The candidate must stay within every particle disc.
      let inside = true
      for (const part of particles) {
        if (Math.hypot(nx - part.position.x, ny - part.position.y) > bodyR) {
          inside = false
          break
        }
      }
      if (!inside) continue // keep the base position
      p.set(nx, ny)
    }
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
    drawR: number,
    aspect: number,
    now: number,
  ): void {
    const atlas = this.faces.atlas(r.id)
    if (!atlas) return
    // PERF/UX: the face sprites stay visible in ALL states — the
    // previous fallback (hide sprites + drawBallFace on the shared
    // layer during easter eggs/panic) made the face vanish for the
    // morph's duration on iOS (the shared layer's per-frame clear
    // races the sprite visibility on overlay-eligible frames). The
    // atlas face is the neutral expression; the impact window shows
    // it instead of a vanishing scared face.
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
    view.outline.setVisible(false)
  }

  private dropSpecialTextures(ballId: number): void {
    const tex = this.specialTextures.get(ballId)
    if (!tex) return
    this.scene.textures.remove(tex.fillKey)
    this.scene.textures.remove(tex.outlineKey)
    this.specialTextures.delete(ballId)
  }

  /** Hide a ball's sprite set (removed / popped / live-path frames). */
  /** Hide only the body quads — face sprites stay visible in BOTH
   * render modes (hiding them for overlay members made faces vanish
   * for the overlay's duration: the sprite face draw ran before this
   * post-pass and nothing redrew them). */
  private hideSprites(ballId: number): void {
    const view = this.spriteViews.get(ballId)
    if (!view) return
    view.fill.setVisible(false)
    view.outline.setVisible(false)
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
