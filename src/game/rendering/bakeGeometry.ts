import { ballOutlineWidth } from './BallAppearance'

/**
 * The GEOMETRY of the tier 8/9 per-ball bake, as a pure function.
 *
 * The tier 8/9 procedural bodies (rainbow wedges, fantasy unicorn) are
 * drawn in LOCAL space — centred on (0,0) with the ball's radius r —
 * while the ball's contour is in WORLD space. The bake must size the
 * texture from the LOCAL drawing and place the ball at the texture's
 * middle, otherwise:
 *
 *  - the body is rasterized outside the canvas and clipped away (an
 *    EMPTY texture — the ball vanishes), and
 *  - the sprite is placed at a wrong offset from the ball (measured:
 *    ~350px away, i.e. off the 720-wide stage).
 *
 * Keeping this pure (no Phaser import) makes it directly testable.
 */

export interface BakeGeometry {
  /** Texture width in px. */
  w: number
  /** Texture height in px. */
  h: number
  /** The ball centre's offset from the texture's top-left, in px. */
  center: number
  /** The padding around the drawing, in px. */
  pad: number
}

/**
 * The local extents of a tier 8/9 procedural body, as multiples of the
 * ball radius. They are SYMMETRIC about the ball centre so the ball lands
 * at the texture's middle (the sprite is origin-centred).
 *   tier 8: the rainbow wedges reach 1.2r in every direction.
 *   tier 9: the body is r, the horn reaches -1.35r, the mane ±0.95r —
 *            1.4r covers both sides.
 */
export function specialBakeExtent(tier: number, radius: number): number {
  // Tier 9: the dorsal fin peaks at ~1.82r above centre and the soft
  // aura stack reaches ~1.75r (1.72r × the 1.03 breath peak) — 1.9r
  // covers both with real margin.
  if (tier === 9) return radius * 1.9
  return radius
}

/**
 * The texture geometry for a tier 8/9 bake: a square texture sized from
 * the LOCAL drawing's extents, with the ball at its middle.
 */
export function specialBakeGeometry(tier: number, radius: number): BakeGeometry {
  const pad = ballOutlineWidth(radius) / 2 + 3
  const ex = specialBakeExtent(tier, radius)
  const size = Math.ceil(ex * 2) + pad * 2
  return { w: size, h: size, center: size / 2, pad }
}

/** True for the tiers that use the procedural local-space bake.
 *  NOW NONE: the tier 9 shark was baked when asleep, but with several
 *  sharks on screen the baked-sprite ↔ live-Graphics alternation (sleep
 *  flags oscillating around Matter's threshold, plus sprite-vs-graphics
 *  depth ordering) read as disappearing, glitching sharks. Tier 9 is
 *  rare — it always draws through the live Graphics path, exactly like
 *  every other tier. Tier 8 was already never baked (animated colour). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isSpecialBakeTier(_tier: number): boolean {
  return false
}
