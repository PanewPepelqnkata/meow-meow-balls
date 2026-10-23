import Phaser from 'phaser'
import { INK, ballOutlineWidth, drawBallFace, ballLookFor, type BallLook } from './BallAppearance'

/**
 * THE SPECIAL-BALL SKIN API — make a themed top-tier ball in ONE object.
 *
 * A theme declares HOW to colour a round slime (palette + glow) and HOW
 * to draw its extra props (horns, fins, hats, …) relative to the ball.
 * The framework handles everything else, identically for every theme:
 *
 *   - body fill from the LIVE CONTOUR (wobbled silhouette)
 *   - belly/highlight shading
 *   - standard eye pair (panic morph, wink easter egg) at eyeY/eyeDx
 *   - ink outline over the contour
 *   - an optional glow aura behind everything
 *
 * Consumers (gameplay renderer, banner, card, claw, preview, progression,
 * baker) call `drawThemedBall(g, cx, cy, r, theme, opts)` — one call, any
 * theme. Adding a new themed ball = adding one SHARK_PALETTES-style entry
 * + a props painter, nothing else.
 */

/** One soft glow circle behind the ball. */
export interface GlowSpec {
  /** Colour of the halo. */
  color: number
  /** Orbit radius as a fraction of r (1 = at the rim). */
  reach: number
  /** Halo circle radius as a fraction of r. */
  size: number
  /** Alpha at pulse peak. */
  alpha: number
  /** Per-puff phase offset (stagger the shimmer). */
  phase: number
  /** How many puffs to draw around the orbit (puffs mode only). */
  count?: number
  /** 'ring' = one big circle; 'puffs' = `count` clouds around the orbit. */
  mode: 'ring' | 'puffs'
}

/** A prop drawn on/around the body: one painter + placement. */
export interface PropSpec {
  /**
   * Painter: receives (g, x, y, r, palette) and draws ONE prop anchored
   * at (x, y) — usually the anchor point on the contour (top, left…).
   * Called BEFORE the body for `behind: true` (fins, wings) and AFTER
   * the outline otherwise (hats, horns).
   */
  paint: (g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, palette: Record<string, number>) => void
  /** Where on the ball this prop anchors. */
  anchor: 'top' | 'left' | 'right' | 'bottom' | 'centre'
  /** Extra offset from the anchor, as fractions of r. */
  offsetX?: number
  offsetY?: number
  /** Draw behind the body fill (fins, tails, wings). */
  behind?: boolean
}

/** A complete themed-ball skin. */
export interface SpecialBallSkin<Palette extends Record<string, number> = Record<string, number>> {
  /** Palette variants (per-run variant picks one). Every painter receives
   * the active entry. */
  palettes: readonly Palette[]
  /** Skin family name (QA + journal). */
  name: string
  /** Optional glow aura behind the ball. */
  glow?: GlowSpec
  /** Props painted behind the body fill (fins, tails). */
  behindProps?: PropSpec[]
  /** Props painted over the body (horns, hats, marks). */
  frontProps?: PropSpec[]
  /**
   * The face: pass undefined for the STANDARD slime face (panic morph,
   * wink, sweat — the whole emotion system), or a painter for a custom
   * one (the shark's nictitating-membrane eyes).
   */
  face?: (g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, palette: Palette, opts: { panic: number; gaze?: { x: number; y: number }; expr: 'normal' | 'wink' | 'grin' | 'tongue'; look: BallLook }) => void
  /** Optional body shading (defaults: soft belly light). */
  shade?: (g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, palette: Palette) => void
}

/** The anchor point on the contour for a prop. */
function anchorPoint(anchor: PropSpec['anchor'], cx: number, cy: number, r: number, poly?: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (!poly || poly.length < 8) {
    const fallback: Record<PropSpec['anchor'], { x: number; y: number }> = {
      top: { x: cx, y: cy - r },
      left: { x: cx - r, y: cy },
      right: { x: cx + r, y: cy },
      bottom: { x: cx, y: cy + r },
      centre: { x: cx, y: cy },
    }
    return fallback[anchor]
  }
  // Contour-aware: scan the poly for the extreme point in the anchor's
  // direction (so horns sit ON the wobbled silhouette, not inside it).
  let best = poly[0]!
  for (const p of poly) {
    if (anchor === 'top' && p.y < best.y) best = p
    else if (anchor === 'bottom' && p.y > best.y) best = p
    else if (anchor === 'left' && p.x < best.x) best = p
    else if (anchor === 'right' && p.x > best.x) best = p
  }
  if (anchor === 'centre') return { x: cx, y: cy }
  return { x: best.x, y: best.y }
}

/** Render one themed ball. The single entry point for every consumer. */
export function drawThemedBall(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  skin: SpecialBallSkin,
  variant: number,
  opts: {
    /** The live contour (world space) — the body follows the wobble. */
    poly?: Array<{ x: number; y: number }>
    /** Eased panic 0..1 (fear morphs + gas shimmer). */
    panic?: number
    /** Easter-egg gaze for the standard face. */
    gaze?: { x: number; y: number }
    /** Easter-egg expression. */
    expr?: 'normal' | 'wink' | 'grin' | 'tongue'
    /** Deterministic seed (expression timeline). */
    seed?: number
    /** Clock ms (glow breathing, tremble). */
    now?: number
  } = {},
): void {
  const palette = skin.palettes[variant % skin.palettes.length] as unknown as Record<string, number>
  const now = opts.now ?? Date.now()
  const panic = opts.panic ?? 0
  const hasContour = !!opts.poly && opts.poly.length >= 3

  // ---- GLOW — behind everything. ----
  if (skin.glow) {
    const glow = skin.glow
    if (glow.mode === 'ring') {
      const rr = r * glow.reach * (1 + Math.sin(now * 0.0019) * 0.06)
      g.fillStyle(glow.color, glow.alpha)
      g.fillCircle(cx, cy, rr)
    } else {
      const count = glow.count ?? 12
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2
        const dist = r * glow.reach * (1 + ((i * 37) % 11) / 11 * 0.28)
        const size = r * glow.size * (0.8 + 0.3 * Math.sin(now * 0.0021 + glow.phase * Math.PI * 2 + i))
        const px = cx + Math.cos(a + now * 0.00021) * dist
        const py = cy + Math.sin(a + now * 0.00021) * dist
        g.fillStyle(glow.color, glow.alpha * (0.55 + 0.45 * Math.sin(now * 0.0021 + glow.phase * Math.PI * 2 + i)))
        g.fillCircle(px, py, size)
      }
      g.fillStyle(glow.color, glow.alpha * 0.55)
      g.fillCircle(cx, cy, r * 1.12)
    }
  }

  // ---- BEHIND PROPS (fins, tails) — anchored on the contour. ----
  for (const prop of skin.behindProps ?? []) {
    const a = anchorPoint(prop.anchor, cx, cy, r, opts.poly)
    prop.paint(g, a.x + (prop.offsetX ?? 0) * r, a.y + (prop.offsetY ?? 0) * r, r, palette as unknown as Record<string, number>)
  }

  // ---- BODY — the live contour. ----
  g.fillStyle(palette.body ?? 0xffffff, 1)
  if (hasContour) g.fillPoints(opts.poly as unknown as Phaser.Math.Vector2[], true)
  else g.fillCircle(cx, cy, r)

  // ---- SHADING — theme-specific or the soft default. ----
  if (skin.shade) {
    skin.shade(g, cx, cy, r, palette as unknown as Record<string, number>)
  } else {
    g.fillStyle(0xffffff, 0.45)
    g.beginPath()
    g.fillEllipse(cx, cy + r * 0.4, r * 1.1, r * 0.55)
    g.fillPath()
  }

  // ---- FACE — custom painter or the standard pair. ----
  if (skin.face) {
    skin.face(g, cx, cy, r, skin.palettes[variant % skin.palettes.length] as unknown as Record<string, number>, {
      panic,
      gaze: opts.gaze,
      expr: opts.expr ?? 'normal',
      look: ballLookFor(9, opts.seed ?? 9),
    })
  } else {
    const look = ballLookFor(9, opts.seed ?? 9)
    const poly = hasContour ? opts.poly : undefined
    drawBallFace(g, look, { x: cx, y: cy }, r, 1, {
      gaze: opts.gaze,
      expr: opts.expr,
      panic,
    })
    // Ink outline for the standard-face path (the custom painter owns it).
    g.lineStyle(ballOutlineWidth(r), INK, 1)
    if (hasContour) g.strokePoints(poly as unknown as Phaser.Math.Vector2[], true, true)
    else g.strokeCircle(cx, cy, r)
    return
  }

  // ---- INK OUTLINE over everything. ----
  g.lineStyle(ballOutlineWidth(r), INK, 1)
  if (hasContour) g.strokePoints(opts.poly as unknown as Phaser.Math.Vector2[], true, true)
  else g.strokeCircle(cx, cy, r)
}
