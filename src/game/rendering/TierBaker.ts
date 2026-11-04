import Phaser from 'phaser'
import { INK, ballOutlineWidth, wobbleContour, ballLookFor } from './BallAppearance'

/**
 * PER-TIER BAKED SLIME BODY (SpriteBalls, Phase 2.24) — the follow-up to
 * the per-ball bake experiment. Measured on device: per-ball bakes cost two
 * texture uploads per churn cycle and the live Graphics layer re-tessellated
 * every awake ball each frame.
 *
 * THIS module bakes ONE combined body texture PER TIER at the tier's own
 * rest radius (a circle displaced by the exact same `wobbleContour` pipeline
 * the live renderer applies), rasterized once through Graphics.generateTexture
 * and reused by EVERY ball of that tier as a single batched Image:
 *
 *   - body quad depth 9.5
 *
 * The combined texture keeps each ball's outline attached to its own fill;
 * y-sorted rendering then preserves contact ordering.
 *
 * TEXTURE SPACE: textures are baked at the tier's own radius and displayed at
 * liveRadius / tierRadius. That keeps the baked ink stroke width aligned with
 * the live path.
 *
 * MEMORY: 1 texture × 7 ordinary tiers, bounded, created lazily at first use,
 * kept for the scene's lifetime.
 *
 * Tier 8 keeps its live path (the clock colour cycles), and collectible tiers
 * keep their themed procedural live path.
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


  /** Drop everything (scene shutdown). Tier textures live for the scene. */
  destroy(): void {
    for (const [tier, tex] of this.baked) {
      this.scene.textures.remove(tex.fillKey)
      this.baked.delete(tier)
    }
    this.tempG.destroy()
  }
}

