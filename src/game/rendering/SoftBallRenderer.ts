import Phaser from 'phaser'
import { getTier } from '../../config/ballTiers'
import { renderContour, softBallArea, softBallCentroid, softBallSleeping } from '../systems/SoftBall'
import type { SoftBall } from '../systems/SoftBall'
import { SOFT } from '../systems/SoftBall'
import type { SoftBallEntity } from '../systems/SoftBallManager'
import { BallEmotionSystem } from '../systems/BallEmotion'
import type { GameOverSequence } from './GameOverSequence'
import { INK, ballLookFor, ballOutlineWidth, drawBallFace, expressionAt, gazeAt, wobbleContour, drawRainbowBall, drawFantasyBall } from './BallAppearance'
import { variantIdFor } from '../state/runVariant'
import type { BallLook } from './BallAppearance'
import { BallBaker } from './BallBaker'

/**
 * Phase 2.9 production renderer for soft-body balls, restyled in Phase
 * 2.10.2 as hand-drawn slime characters. Phase 2.11.0: the character look
 * and face drawing live in the SHARED `BallAppearance` module — preview and
 * crane draw the exact same character through the same functions; this
 * renderer only feeds them the live simulated contour.
 *
 * One shared Graphics layer, cleared and redrawn per frame. Two-pass
 * fill/stroke (Phase 2.9.3) keeps adjacent outlines clean.
 *
 * BAKED RENDERING (settled-state kill): a FULLY-sleeping ball's pixels are
 * frozen — its contour is cached and never rebuilt — so its body is baked
 * once into a fill texture + an outline texture (BallBaker) and displayed as
 * two textured quads layered around the live Graphics layer, reproducing the
 * two-pass draw order exactly:
 *
 *   9.5   baked FILL quads
 *   10    live Graphics: awake fills → awake strokes → ALL faces
 *   10.5  baked OUTLINE quads
 *
 * Faces stay LIVE for baked balls (gaze timeline, easter-egg expressions and
 * the emotion system's panic all keep animating) — the face pass below runs
 * for every drawn ball using the frozen centroid. A sleeping ball that WAKES
 * (any collision, auditStuckBalls, wall raise, merge displacement, partial
 * wake) is detected at draw time via softBallSleeping and its textures are
 * dropped the SAME frame — stale baked pixels can never reach the screen.
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
  private readonly layer: Phaser.GameObjects.Graphics
  /** Baked rendering for fully-sleeping balls (see class doc). */
  private readonly baker: BallBaker
  /**
   * Baked rendering budget: at most this many balls bake per update() call.
   * Baking rasterizes a small canvas + uploads two textures — a few ms. A
   * pile that settles all at once (a big drop landing on a settled pile)
   * would otherwise bake ~10 textures in a single frame and spike it; the
   * budget spreads the work at 2 balls/frame while EVERY ball still draws
   * through the (contour-cached) live path meanwhile — no visual difference,
   * just a deferred cost.
   */
  private bakeBudget = 0
  private static readonly BAKE_BUDGET_PER_FRAME = 2
  /**
   * Bake suspension (Raise Walls): while the walls ANIMATE (height changing
   * every frame), balls whose measured danger level is changing must re-render
   * their faces live — but their BODIES are still frozen. The suspension only
   * pauses NEW bakes; existing bakes keep displaying (bodies unchanged) and
   * the live face pass keeps drawing over them, so the panic face morphs
   * smoothly on top of the frozen body — identical to the pre-bake look.
   * The scene toggles this around WallAnimator's active animation.
   */
  private bakingSuspended = false
  /** Ball ids whose bake was actually USED in the last update() — QA
   * evidence that settled piles render as textured quads, and that a wake
   * drops the bake (the id must disappear from this set the same frame). */
  private readonly bakeSweep = new Set<number>()
  /** IDs actually drawn in the LAST update() — QA evidence that reserved
   * ('merging') sources remain visible while their replacement pends. */
  private readonly lastDrawnIds = new Set<number>()
  /**
   * Phase 2.20 — per-ball contour cache (PERFORMANCE): a sleeping ball's
   * particles are frozen, so its catmull-rom contour + wobble never
   * change. Rebuilding ~200-point geometry per frame per ball was the
   * dominant CPU cost in settled piles (the common state). The cache is
   * invalidated by any wake (positions moved), a pop scale (game over),
   * or registry removal. Drawn with the cached points; live balls
   * (moving/colliding) rebuild every frame as before. Under baked rendering
   * this cache also produces the bake SOURCE contour (first frozen frame).
   */
  private readonly contourCache = new Map<
    number,
    { poly: Phaser.Math.Vector2[]; centroid: { x: number; y: number } }
  >()
  /** Sleep state from the PREVIOUS frame, for wake-edge detection. */
  private readonly wasSleeping = new Map<number, boolean>()
  /** Reused centroid out-vector (zero-allocation reads). */
  private readonly centroidScratch = { x: 0, y: 0 }

  constructor(scene: Phaser.Scene) {
    this.layer = scene.add.graphics().setDepth(10)
    this.baker = new BallBaker(scene)
  }

  register(ball: SoftBallEntity): void {
    this.renderables.set(ball.id, ball)
  }

  unregister(ballId: number): void {
    this.renderables.delete(ballId)
    this.looks.delete(ballId)
    this.contourCache.delete(ballId)
    this.wasSleeping.delete(ballId)
    this.baker.drop(ballId)
  }

  clear(): void {
    this.renderables.clear()
    this.looks.clear()
    this.contourCache.clear()
    this.wasSleeping.clear()
    this.baker.clear()
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

  /** Diagnostics: how many balls rendered as baked quads in the LAST
   * update() — the settled-state pixel-savings evidence. */
  get bakedSize(): number {
    return this.bakeSweep.size
  }

  /** QA: was this ball actually drawn in the last frame? */
  isDrawn(ballId: number): boolean {
    return this.lastDrawnIds.has(ballId)
  }

  /** QA: did this ball render as a baked quad in the last frame? */
  isBaked(ballId: number): boolean {
    return this.bakeSweep.has(ballId)
  }

  /**
   * Drop one ball's baked textures (wake invalidation, fired from
   * SoftBallManager.onBallWake — every wake path funnels through there).
   * Idempotent; the ball keeps drawing through the live Graphics path until
   * it settles again (then it rebakes, budget permitting).
   */
  dropBake(ballId: number): void {
    this.baker.drop(ballId)
  }

  /** Pause NEW bakes (Raise Walls animation) — existing baked bodies keep
   * displaying; faces stay live on top. See the field doc. */
  suspendBaking(): void {
    this.bakingSuspended = true
  }

  resumeBaking(): void {
    this.bakingSuspended = false
  }

  /** Destroy the baker's display objects (scene shutdown). */
  destroy(): void {
    this.baker.destroy()
  }

  update(): void {
    const g = this.layer
    g.clear()
    // Advance the per-ball emotion (danger-zone panic) BEFORE drawing so
    // faces use this frame's eased panic value. Visual-only: the system
    // never touches physics state. (Array.from avoids a closure spread —
    // same list, no allocation churn.)
    this.emotion.update(this.renderables.values())
    // PHASE 2.9.3: two-pass draw. Pass 1 fills EVERY ball; pass 2 strokes
    // EVERY outline. Single-pass per-ball drawing let a later ball's stroke
    // cut into an earlier ball's fill at contact points — the main visible
    // "interpenetration" signal. With two passes, adjacent balls show BOTH
    // outlines cleanly at the junction. Baked balls participate through
    // their two quads (fill at depth 9.5, outline at depth 10.5) — the same
    // ordering, one frame of work amortized away.
    const polys: Array<{
      poly: Phaser.Math.Vector2[] | null;
      color: number;
      soft: SoftBall;
      look: BallLook;
      r: number;
      tier: number;
      entity: SoftBallEntity;
      cx: number;
      cy: number;
      baked: boolean;
    }> = []
    this.lastDrawnIds.clear()
    this.bakeSweep.clear()
    this.bakeBudget = SoftBallRenderer.BAKE_BUDGET_PER_FRAME

    for (const r of this.renderables.values()) {
      // Lifecycle guard: a REMOVED ball must never appear (not even for one
      // frame) beside or inside its replacement. A 'merging' ball is a
      // deferred-merge source — still real, still visible (Phase 2.13.4).
      if (r.state === 'removed') continue
      // Game-over pop: a ball mid-pop draws at its tweened scale; popped
      // (scale 0) balls vanish.
      const popScale = this.gameOverSequence?.scaleOverrides.get(r.id)
      if (popScale != null && popScale <= 0.002) continue
      this.lastDrawnIds.add(r.id)
      const look = this.lookFor(r)
      const color = this.tierColor(r.tier)
      const drawR = popScale != null ? r.soft.radius * popScale : r.soft.radius

      // Phase 2.20 contour cache: a fully-sleeping ball's geometry is
      // frozen — reuse the cached points (which also carry the centroid)
      // instead of rebuilding ~200-point catmull-rom + wobble every frame.
      // Any wake (positions changed), pop tween, or first frame rebuilds.
      const sleeping = softBallSleeping(r.soft)
      const wasSleeping = this.wasSleeping.get(r.id) ?? false
      // Tier 8's rainbow fill shimmers with Date.now() and tier 9 is fully
      // procedural — both keep streaming through the live path.
      const bakeEligible = sleeping && popScale == null && r.tier !== 8 && r.tier !== 9

      // ---- BAKED FAST PATH: a still-frozen ball with a live bake renders
      // as two textured quads and costs the frame nothing but a quad draw.
      // softBallSleeping is re-evaluated EVERY frame at draw time: the
      // instant ANY wake path touches the ball (collision, auditStuckBalls,
      // wall raise, merge displacement, partial-wake repair) this branch
      // stops matching and the bake is dropped below — stale pixels can
      // never reach the screen.
      const frozenBake = bakeEligible && wasSleeping ? this.baker.views().get(r.id) : undefined
      if (frozenBake) {
        this.bakeSweep.add(r.id)
        this.wasSleeping.set(r.id, true)
        polys.push({
          poly: null,
          color,
          soft: r.soft,
          look,
          r: drawR,
          tier: r.tier,
          entity: r,
          cx: frozenBake.cx,
          cy: frozenBake.cy,
          baked: true,
        })
        continue
      }
      // Not (yet) frozen-and-baked: any existing bake is invalid for this
      // state (wake, pop scale, tier, first frozen frame) — drop it.
      this.baker.drop(r.id)

      let poly: Phaser.Math.Vector2[]
      let cx: number
      let cy: number
      const cached = this.contourCache.get(r.id)
      if (bakeEligible && cached && wasSleeping) {
        poly = cached.poly
        cx = cached.centroid.x
        cy = cached.centroid.y
      } else {
        const pr = r.soft.radius * SOFT.particleRadiusFactor
        const base = renderContour(r.soft, 6, pr)
        const c = softBallCentroid(r.soft, this.centroidScratch)
        const built = wobbleContour(look, base, c.x, c.y, drawR, 1.5)
        if (bakeEligible) {
          // In-place Vector2 reuse: the cached array is mutated on the next
          // rebuild rather than reallocated.
          let reuse = cached?.poly
          if (!reuse || reuse.length !== built.length) {
            reuse = built.map((p) => new Phaser.Math.Vector2(p.x, p.y))
          }
          const pts = reuse
          for (let i = 0; i < built.length; i++) {
            const p = pts[i]
            const b = built[i]
            if (p && b) p.set(b.x, b.y)
          }
          poly = pts
          this.contourCache.set(r.id, { poly, centroid: { x: c.x, y: c.y } })
          cx = c.x
          cy = c.y
        } else {
          // PERF: pooled in-place reuse for AWAKE balls too — the
          // non-cacheable path previously allocated ~200 Vector2s per
          // ball per frame (~240k allocs/s at 10 awake balls).
          let reuse = cached?.poly
          if (!reuse || reuse.length !== built.length) {
            reuse = built.map((p) => new Phaser.Math.Vector2(p.x, p.y))
          } else {
            for (let i = 0; i < built.length; i++) {
              const p = reuse[i]
              const b = built[i]
              if (p && b) p.set(b.x, b.y)
            }
          }
          poly = reuse
          cx = c.x
          cy = c.y
          this.contourCache.delete(r.id)
        }
      }
      this.wasSleeping.set(r.id, sleeping)

      // ---- FIRST FROZEN FRAME: bake the body once (budgeted — see the
      // bakeBudget doc). This frame still draws the body live (one extra
      // raster behind the scenes); from the NEXT frame the quads take over.
      if (bakeEligible && !this.bakingSuspended && this.bakeBudget > 0) {
        this.bakeBudget--
        this.baker.bake(r, poly, color, cx, cy)
        this.bakeSweep.add(r.id)
        polys.push({ poly: null, color, soft: r.soft, look, r: drawR, tier: r.tier, entity: r, cx, cy, baked: true })
        continue
      }

      polys.push({ poly, color, soft: r.soft, look, r: drawR, tier: r.tier, entity: r, cx, cy, baked: false })

      // Phase 2.12.1: Special rendering for Tier 8 (rainbow) and Tier 9 (fantasy).
      // Phase 2.14.0: both take the PER-RUN variant (runVariant rolls tiers
      // 8-9 anew every run — see src/game/state/runVariant.ts).
      if (r.tier === 8) {
        // Tier 8: Rainbow gradient
        const pts = poly.map(v => ({ x: v.x, y: v.y }))
        drawRainbowBall(g, pts, cx, cy, r.soft.radius, Date.now(), variantIdFor(8))
      } else if (r.tier === 9) {
        // Tier 9: Fantasy/unicorn
        drawFantasyBall(g, cx, cy, r.soft.radius, variantIdFor(9))
      } else {
        // Normal tier: solid fill
        g.fillStyle(color, 1)
        g.fillPoints(poly, true)
      }
    }

    // Pass 2: Outlines for all balls (baked balls own theirs as quads).
    for (const item of polys) {
      if (item.baked || item.poly == null) continue
      g.lineStyle(ballOutlineWidth(item.r), INK, 1)
      g.strokePoints(item.poly, true, true)
    }

    // Pass 3: Faces for all balls — live GLANCE timeline (pupils dart every
    // ~4 s, de-synced per ball) + EASTER-EGG expressions (wink/grin/tongue
    // flashing every 10–30 s), both deterministic per ball seed + time.
    // Runs for BAKED balls too: their body is frozen but their face is not.
    for (const { soft, look, entity, cx: fcx, cy: fcy } of polys) {
      // Zero-allocation: aspect via direct min/max
      // walk (the old version built 2 arrays + 2 Math.max spreads per ball
      // per frame).
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      const parts = soft.particles
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]!.position
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
      const aspect = Math.max(0.6, Math.min(1.0, (maxY - minY) / (maxX - minX)))
      const now = Date.now()
      // Game-over override: every surviving ball wears the doomed face.
      const panic = this.gameOverSequence?.panicOverride ?? this.emotion.panicOf(entity.id)
      drawBallFace(g, look, { x: fcx, y: fcy }, soft.radius, aspect, {
        gaze: gazeAt(entity.seed, now),
        expr: expressionAt(entity.seed, now),
        panic,
      })
    }
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
