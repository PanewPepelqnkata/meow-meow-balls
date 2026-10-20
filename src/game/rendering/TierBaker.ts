import Phaser from 'phaser'
import { INK, ballOutlineWidth, wobbleContour, ballLookFor } from './BallAppearance'

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
 * fantasy ball's horn/mane/stars extend beyond the contour). Their steady-
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
  ensure(tier: number, color: number): TierTextures {
    const existing = this.baked.get(tier)
    if (existing) return existing

    const r = BAKE_TEXTURE_RADIUS
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

    const fillKey = `br-tier-fill-${tier}`
    const outlineKey = `br-tier-out-${tier}`
    if (this.scene.textures.exists(fillKey)) this.scene.textures.remove(fillKey)
    if (this.scene.textures.exists(outlineKey)) this.scene.textures.remove(outlineKey)

    // The offline pass draws at the Graphics' own position (identity camera):
    // shift by +center so the ball center lands on canvas (center, center).
    this.tempG.clear()
    this.tempG.setPosition(center, center)
    this.tempG.fillStyle(color, 1)
    this.tempG.fillPoints(poly as unknown as Phaser.Math.Vector2[], true)
    this.tempG.generateTexture(fillKey, size, size)

    this.tempG.clear()
    this.tempG.lineStyle(ballOutlineWidth(r), INK, 1)
    this.tempG.strokePoints(poly as unknown as Phaser.Math.Vector2[], true, true)
    this.tempG.generateTexture(outlineKey, size, size)
    this.tempG.clear()

    const tex: TierTextures = { fillKey, outlineKey, size, center, textureRadius: r }
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
    if (this.scene.textures.exists(fillKey)) this.scene.textures.remove(fillKey)
    if (this.scene.textures.exists(outlineKey)) this.scene.textures.remove(outlineKey)

    const r = soft.radius
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
    if (tier === 9) {
      // Fantasy extras reach beyond the contour (horn to −1.35r, mane to
      // ±0.95r): widen so nothing clips — same margins as BallBaker.
      minX = Math.min(minX, -r * 1.05)
      maxX = Math.max(maxX, r * 1.05)
      minY = Math.min(minY, -r * 1.4)
      maxY = Math.max(maxY, r * 1.15)
    }
    const originX = minX - pad
    const originY = minY - pad
    const w = Math.ceil(maxX - minX) + pad * 2
    const h = Math.ceil(maxY - minY) + pad * 2

    // Draw contour-relative (contour is absolute world coords; the temp
    // Graphics is positioned at −origin so world (originX, originY) → (0,0)).
    // `import` of draw functions happens in the renderer (passed via bake
    // callbacks) — here we only need fill/stroke of the given poly; the
    // renderer draws tier-8/9 specials into a Graphics and we rasterize it.
    this.tempG.clear()
    this.tempG.setPosition(-originX, -originY)
    const g = this.tempG
    if (tier === 8) {
      drawRainbowInto(g, 0, 0, r, variant)
    } else if (tier === 9) {
      drawFantasyInto(g, 0, 0, r, variant)
    } else {
      g.fillStyle(color, 1)
      g.fillPoints(poly, true)
    }
    g.generateTexture(fillKey, w, h)
    this.tempG.clear()
    this.tempG.lineStyle(ballOutlineWidth(r), INK, 1)
    this.tempG.strokePoints(poly, true, true)
    this.tempG.generateTexture(outlineKey, w, h)
    this.tempG.clear()

    return {
      fillKey,
      outlineKey,
      size: Math.max(w, h),
      // Center offset from the texture origin (contour-relative draw used
      // (0,0) as ball center → center sits at −origin inside the texture).
      center: -originX,
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
// Tier-8/9 procedural fills, re-rasterizable into the offline Graphics.
// Mirrors BallAppearance.drawRainbowBall / drawFantasyBall but anchored at
// (0,0) and parameterized so the baker can reuse them verbatim (kept in
// sync by test: same variant math — see TierBaker placement of extras).
// ---------------------------------------------------------------------------

function drawRainbowInto(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, variant: number): void {
  const colors = [0x4fc3f7, 0x5fd437, 0xffeb3b, 0xff9800, 0xf44336, 0xf96ec0, 0x9c27b0]
  const rotate = variant % colors.length
  const segments = 7 + ((variant * 3) % 3) * 2
  const ring = colors.map((_, i) => colors[(i + rotate) % colors.length]!)
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const nextAngle = ((i + 1) / segments) * Math.PI * 2
    g.fillStyle(ring[i % ring.length]!, 1)
    g.beginPath()
    g.moveTo(cx, cy)
    const steps = 12
    for (let j = 0; j <= steps; j++) {
      const a = angle + (nextAngle - angle) * (j / steps)
      g.lineTo(cx + Math.cos(a) * r * 1.2, cy + Math.sin(a) * r * 1.2)
    }
    g.closePath()
    g.fillPath()
  }
  g.fillStyle(0xffffff, 0.15)
  g.fillCircle(cx, cy, r * 0.7)
}

function drawFantasyInto(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, variant: number): void {
  // Local palette copy — MUST stay index-aligned with BallAppearance's
  // FANTASY_VARIANTS (verified by FantasyPaletteSync test below).
  const pal = FANTASY_PALETTES[variant % FANTASY_PALETTES.length]!
  g.fillStyle(pal.body, 1)
  g.fillCircle(cx, cy, r)
  const hornHeight = r * 0.35
  const hornWidth = r * 0.12
  g.fillStyle(pal.horn, 1)
  g.beginPath()
  g.moveTo(cx, cy - r - hornHeight)
  g.lineTo(cx - hornWidth, cy - r)
  g.lineTo(cx + hornWidth, cy - r)
  g.closePath()
  g.fillPath()
  g.lineStyle(Math.max(2, r * 0.04), INK, 1)
  g.strokePath()
  const maneColors = [pal.mane, 0x9c27b0, 0x4fc3f7]
  for (let i = 0; i < 3; i++) {
    const side = i < 2 ? -1 : 1
    const offset = (i % 2) * 0.15
    g.fillStyle(maneColors[i]!, 1)
    g.fillEllipse(cx + side * r * 0.85, cy - r * 0.3 + offset * r, r * 0.2, r * 0.4)
  }
  if (r > 26) {
    const stars: Array<[number, number, number]> = [
      [-0.45, -0.35, 0.09],
      [0.5, -0.15, 0.07],
      [0.15, 0.45, 0.06],
    ]
    for (const [sx, sy, sr] of stars) {
      const x = cx + sx * r
      const y = cy + sy * r
      const s = r * sr
      g.fillStyle(pal.star, 0.95)
      g.beginPath()
      g.moveTo(x, y - s)
      g.lineTo(x + s * 0.32, y - s * 0.32)
      g.lineTo(x + s, y)
      g.lineTo(x + s * 0.32, y + s * 0.32)
      g.lineTo(x, y + s)
      g.lineTo(x - s * 0.32, y + s * 0.32)
      g.lineTo(x - s, y)
      g.lineTo(x - s * 0.32, y - s * 0.32)
      g.closePath()
      g.fillPath()
    }
  }
}

const FANTASY_PALETTES: Array<{ body: number; horn: number; star: number; mane: number }> = [
  { body: 0xffc0e0, horn: 0xffeb3b, star: 0xffffff, mane: 0xff6b9d },
  { body: 0xc0e8ff, horn: 0xffd54f, star: 0xffffff, mane: 0x81d4fa },
  { body: 0xd0ffc8, horn: 0xffb300, star: 0xffffff, mane: 0xa5d6a7 },
  { body: 0xe8d0ff, horn: 0xffca28, star: 0xffffff, mane: 0xb39ddb },
  { body: 0xfff0c0, horn: 0xff7043, star: 0xffffff, mane: 0xffd54f },
  { body: 0xffd8c0, horn: 0x8d6e63, star: 0xffffff, mane: 0xffab91 },
  { body: 0xc0f0ff, horn: 0x26c6da, star: 0xffffff, mane: 0x80deea },
  { body: 0xffc0c8, horn: 0xec407a, star: 0xffffff, mane: 0xf06292 },
]
