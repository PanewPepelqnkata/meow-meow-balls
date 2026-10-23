import Phaser from 'phaser'
import { INK, ballOutlineWidth, wobbleContour, ballLookFor, drawSharkBall } from './BallAppearance'
import { isSpecialBakeTier, specialBakeExtent, specialBakeGeometry } from './bakeGeometry'

/**
 * PER-TIER BAKED SLIME TEXTURES (SpriteBalls, Phase 2.24) — the follow-up
 * to the per-ball bake experiment. Measured on device: per-ball bakes cost
 * two texture uploads per bake churn cycle and the live Graphics layer
 * still re-tessellated every awake ball each frame (fillPoints + strokePoints
 * streams ~1,150 triangles per ball straight into the main WebGL buffer at
 * 60 Hz — the iPhone 14 Pro's 42 fps bottleneck).
 *
 * THIS module bakes ONE fill+outline texture pair PER TIER at rest geometry
 * (a circle displaced by the exact same `wobbleContour` pipeline the live
 * renderer applies — identical character silhouette), rasterized once
 * through Graphics.generateTexture and reused by EVERY ball of that tier as
 * a single batched Image each:
 *
 *   - fill quad  depth 9.5 (pass 1, alongside other fills)
 *   - outline quad depth 10.5 (pass 2, above every fill incl. awake)
 *
 * The two-quad split reproduces the two-pass draw-order guarantee: adjacent
 * balls' outlines both stay visible at contact points.
 *
 * TEXTURE SPACE: textures are baked at a generous fixed radius
 * (BAKE_TEXTURE_RADIUS px, stage units) and DISPLAYED scaled by
 * liveRadius / BAKE_TEXTURE_RADIUS. Baking big-and-downscaling beats
 * baking per-radius: one texture serves every ball of the tier (there are
 * only 7 real tiers), downscale filtering smooths the ink edge, and the
 * on-screen texel density at gameplay sizes (radius 44..165) stays ≥ the
 * live Graphics antialiasing quality.
 *
 * MEMORY: 2 textures × 12 tiers ≤ ~1 MB total on device — bounded, created
 * lazily at first use, kept for the scene's lifetime.
 *
 * TIERS 8/9 keep their live path (rainbow shimmers with Date.now(); the
 * shark ball.s dorsal fin and tail extend beyond the contour). Their steady-
 * state cost is accepted: they are rare end-chain balls.
 */

/** Radius (stage px) at which tier textures are rasterized. */
export const BAKE_TEXTURE_RADIUS = 256

/** Depth of the per-tier fill quads (pass 1, beside the live fills). */
export const SPRITE_FILL_DEPTH = 9.5
/** Depth of the per-tier outline quads (pass 2, above every fill). */
export const SPRITE_OUTLINE_DEPTH = 10.5

export interface TierTextures {
  /** Texture key of the baked fill (round rest contour, tier color). */
  fillKey: string
  /** Texture key of the baked ink outline (same contour). */
  outlineKey: string
  /** Width/height of each texture in px. */
  size: number
  /** Distance from the texture's top-left to the ball's center (px). */
  center: number
  /** Ball radius the texture was baked for (scale = liveR / this). */
  textureRadius: number
}

export class TierBaker {
  private readonly baked = new Map<number, TierTextures>()
  /** Offline command-buffer scratch — never visible, cleared per bake. */
  private readonly tempG: Phaser.GameObjects.Graphics

  constructor(private readonly scene: Phaser.Scene) {
    this.tempG = scene.add.graphics().setVisible(false)
  }

  has(tier: number): boolean {
    return this.baked.has(tier)
  }

  get(tier: number): TierTextures | undefined {
    return this.baked.get(tier)
  }

  /**
   * Rasterize the tier's fill + outline at rest geometry (round contour,
   * radius = tier radius, ink outline) into two shared textures. The rest
   * silhouette goes through the SAME wobbleContour pipeline as live balls
   * (amp1/amp2 wobble baked into the texture, not animated per frame — the
   * measured rest wobble is ≤1.8% of R, invisible as motion but visible as
   * character). Deterministic per tier.
   */
  ensure(tier: number, color: number, tierRadius: number): TierTextures {
    const existing = this.baked.get(tier)
    if (existing) return existing

    // PERF/correctness: bake at the TIER's own radius (not a fixed 256
    // px): the sprite then displays at ~1:1 and the baked stroke width
    // (ballOutlineWidth(tierRadius)) matches the live path's
    // ballOutlineWidth(liveR) exactly — the impact 'thick then thin'
    // outline glitch was the 256-bake's clamped-7px stroke displayed at
    // 0.12× (hairline) vs the live path's 4.8px.
    const r = tierRadius
    const pad = ballOutlineWidth(r) / 2 + 3
    const size = Math.ceil(r * 2 + pad * 2)
    const center = r + pad

    // Rest contour: a circle displaced by the same wobble pipeline the live
    // renderer applies at rest (`restContour` semantics via renderContour on
    // a synthetic round SoftBall is overkill — wobbleContour on a sampled
    // circle reproduces the identical silhouette shape function).
    // 128 samples (was 48): the bake upscales onto big balls where
    // 48-pt facets were visible as straight edges (user report). The
    // wobble displacement stays — only the sampling density rises.
    const steps = 128
    const base: Array<{ x: number; y: number }> = []
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      base.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
    }
    const look = ballLookFor(tier, tier * 0x9e3779b9)
    const poly = wobbleContour(look, base, 0, 0, r, 1.5)

    // ONE combined texture (fill + ink outline baked together): the ball
    // is a single 'sticker' — y-sorted rendering keeps each ball's
    // outline attached to its own body (separate fill/outline quads let
    // a back ball's outline draw over a front ball's fill — the
    // interpenetration the user reported). Suika-class standard.
    const bodyKey = `br-tier-body-${tier}`
    // The old texture is NOT removed: generateTexture overwrites the key
    // in place, so any sprite still bound to it keeps a valid texture.
    // Removing it would null the source of a live sprite and kill the
    // render pass (see FaultContainment.ts for the full mechanism).

    this.tempG.clear()
    this.tempG.setPosition(center, center)
    this.tempG.fillStyle(color, 1)
    this.tempG.fillPoints(poly as unknown as Phaser.Math.Vector2[], true)
    this.tempG.lineStyle(ballOutlineWidth(r), INK, 1)
    this.tempG.strokePoints(poly as unknown as Phaser.Math.Vector2[], true, true)
    this.tempG.generateTexture(bodyKey, size, size)
    this.tempG.clear()

    const tex: TierTextures = { fillKey: bodyKey, outlineKey: bodyKey, size, center, textureRadius: r }
    this.baked.set(tier, tex)
    return tex
  }

  /**
   * Bake a LIVE ball's current wobbled contour into the tier texture set.
   * Called ONCE per (tier, ball) when a tier-8/9 ball first freezes: those
   * tiers' fills are procedural (rainbow wedges / fantasy body+extras), so
   * they cannot share the round per-tier texture. The result REPLACES the
   * tier pair for that ball id only (per-ball override texture keys).
   */
  bakeLiveContour(
    tier: number,
    ballId: number,
    soft: { radius: number },
    poly: Phaser.Math.Vector2[],
    color: number,
    variant: number,
  ): TierTextures {
    const fillKey = `br-ball-fill-${ballId}`
    const outlineKey = `br-ball-out-${ballId}`
    // The old textures are NOT removed here. A sprite may still reference
    // them (the ball's body quad is bound to `fillKey`): Phaser's
    // TextureManager.remove() destroys the texture and nulls its source,
    // and the next WebGL render of that sprite throws
    // "Cannot read properties of null (reading 'resolution')" — which
    // kills the whole Phaser game loop, so the entire UI vanishes with
    // it. generateTexture() OVERWRITES an existing key in place, so the
    // old texture does not need to be removed at all: the sprite keeps a
    // valid texture and simply displays the new bake. The stale texture
    // is released in dropSpecialTextures() when the ball is gone.
    void fillKey
    void outlineKey

    const r = soft.radius
    const isSpecial = isSpecialBakeTier(tier)
    const specialGeo = isSpecial ? specialBakeGeometry(tier, r) : null
    const pad = specialGeo ? specialGeo.pad : ballOutlineWidth(r) / 2 + 3
    // TWO coordinate spaces, and mixing them is what broke the tier 8/9
    // bake (the ball vanished):
    //
    //  - The tier 8/9 procedural fills (drawRainbowInto / drawFantasyInto)
    //    are drawn in LOCAL space, centred on (0,0) with the ball radius r.
    //  - The contour polygon is in WORLD space.
    //
    // The old code sized the texture from the WORLD contour but drew the
    // fill at LOCAL (0,0) while tempG was offset to (-originX, -originY) —
    // so the body was rasterized at texture coordinates far outside the
    // canvas and clipped away (an EMPTY texture, measured: 0 painted
    // pixels), and `center: -originX` returned a negated world coordinate
    // instead of the ball centre's offset inside the texture. The sprite
    // was then placed ~350px away from the ball (measured: tier 8 at ball
    // x=355, sprite at x=707 — off the 720-wide stage).
    //
    // For tiers 8/9 the whole bake is therefore done in LOCAL space: the
    // texture is sized from the local drawing's extents and the ball centre
    // sits at the middle of it.
    let minX: number
    let maxX: number
    let minY: number
    let maxY: number
    if (specialGeo) {
      // Local extents of the procedural drawing. They are SYMMETRIC about
      // the ball centre so the ball lands at the texture's middle (the
      // sprite is origin-centred, so it is placed at the ball's centroid).
      const ex = specialBakeExtent(tier, r)
      minX = -ex
      maxX = ex
      minY = -ex
      maxY = ex
    } else {
      minX = Infinity
      maxX = -Infinity
      minY = Infinity
      maxY = -Infinity
      for (const p of poly) {
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
    }
    const originX = minX - pad
    const originY = minY - pad
    const w = specialGeo ? specialGeo.w : Math.ceil(maxX - minX) + pad * 2
    const h = specialGeo ? specialGeo.h : Math.ceil(maxY - minY) + pad * 2

    // Draw contour-relative (contour is absolute world coords; the temp
    // Graphics is positioned at −origin so world (originX, originY) → (0,0)).
    // `import` of draw functions happens in the renderer (passed via bake
    // callbacks) — here we only need fill/stroke of the given poly; the
    // renderer draws tier-8/9 specials into a Graphics and we rasterize it.
    this.tempG.clear()
    const g = this.tempG
    if (isSpecial) {
      // LOCAL space: the procedural fill is centred on the texture.
      // TIER 9 ONLY: the tier 8 cycling RGB ball is a plain ball that
      // animates its colour, so it is never baked (a baked texture would
      // freeze one colour) — it draws through the live Graphics path.
      g.setPosition(pad, pad)
      drawFantasyInto(g, 0, 0, r, variant)
      g.generateTexture(fillKey, w, h)
      this.tempG.clear()
      // The ink outline: the tier 9 fantasy body strokes its own horn and
      // mane, so the outline is a circle of the ball's radius in local
      // space.
      g.setPosition(pad, pad)
      g.lineStyle(ballOutlineWidth(r), INK, 1)
      g.strokeCircle(0, 0, r)
      g.generateTexture(outlineKey, w, h)
    } else {
      g.setPosition(-originX, -originY)
      g.fillStyle(color, 1)
      g.fillPoints(poly, true)
      g.generateTexture(fillKey, w, h)
      this.tempG.clear()
      g.setPosition(-originX, -originY)
      g.lineStyle(ballOutlineWidth(r), INK, 1)
      g.strokePoints(poly, true, true)
      g.generateTexture(outlineKey, w, h)
    }
    this.tempG.clear()

    return {
      fillKey,
      outlineKey,
      size: Math.max(w, h),
      // The ball centre's offset FROM THE TEXTURE TOP-LEFT. For the local
      // (tier 8/9) bake that is the texture's own middle; for the
      // world-space bake it is the ball centre's position inside it.
      center: specialGeo ? specialGeo.center : -originX,
      textureRadius: r,
    }
  }

  /** Drop everything (scene shutdown). Tier textures live for the scene. */
  destroy(): void {
    for (const [tier, tex] of this.baked) {
      this.scene.textures.remove(tex.fillKey)
      this.scene.textures.remove(tex.outlineKey)
      this.baked.delete(tier)
    }
    this.tempG.destroy()
  }
}

// ---------------------------------------------------------------------------
// Tier-9 procedural fill, re-rasterizable into the offline Graphics.
// Mirrors BallAppearance.drawSharkBall but anchored at (0,0) and
// parameterized so the baker can reuse it verbatim (kept in sync by test:
// same variant math — see TierBaker placement of extras).
// ---------------------------------------------------------------------------

function drawFantasyInto(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, variant: number): void {
  // DELEGATES to the live renderer: the bake is a sleeping ball, and a
  // sleeping ball draws as the plain circle fallback (no contour) — the
  // exact same code path as the live shark ball with poly omitted, so
  // the bake and the live ball can never diverge again.
  drawSharkBall(g, cx, cy, r, variant)
}
