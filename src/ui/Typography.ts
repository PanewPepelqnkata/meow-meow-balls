import Phaser from 'phaser'

/**
 * Phase 2.11.0 typography (spec §4): ONE display family — Lilita One, a
 * heavy rounded comic font that matches the reference's thick-outlined,
 * playful lettering — used by every HUD element, button, counter and the
 * game-over overlay. Loaded via @font-face in index.css; game creation is
 * gated on `document.fonts.load` (GameCanvas) so the first painted frame
 * already uses it (no FOUT inside canvas).
 *
 * Outline: canvas text stroke (the canvas equivalent of -webkit-text-stroke)
 * with a soft drop shadow for lift. Small labels 1.5–2px @ mobile scale,
 * large text 2.5–4px — scaled by the layout's fontScale.
 */

export const FONT_FAMILY = '"Lilita One", "Arial Black", sans-serif'

export interface TextOptions {
  /** Fill color (hex string). */
  color: string
  /** Outline thickness in px BEFORE fontScale (design px). */
  stroke?: number
  /** Font size in px BEFORE fontScale (design px). */
  size: number
  origin?: [number, number]
  /** Soft drop shadow (default true for large text). */
  shadow?: boolean
  /** Extra canvas padding (px) — needed when a large ink stroke would
   * otherwise spill past the measured text canvas and get clipped. */
  pad?: number
}

/** Cartoon text with the display font + ink outline, scaled by fontScale.
 * Phase 2.21: the Text canvas is baked at devicePixelRatio resolution
 * (`resolution` scales the internal canvas and frame so the GPU samples
 * 1:1 texture px on high-DPI screens — default 1 renders 1× and upscales,
 * which is the blurry-text cause on phones). */
export function hudText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  initial: string,
  fontScale: number,
  opts: TextOptions,
): Phaser.GameObjects.Text {
  const stroke = opts.stroke ?? 3
  const t = scene.add
    .text(x, y, initial, {
      fontFamily: FONT_FAMILY,
      fontSize: `${Math.max(10, Math.round(opts.size * fontScale))}px`,
      color: opts.color,
      stroke: '#111111',
      strokeThickness: Math.max(1, stroke * fontScale),
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    })
    .setOrigin(opts.origin?.[0] ?? 0, opts.origin?.[1] ?? 0)
  if (opts.pad) t.setPadding(opts.pad, opts.pad, opts.pad, opts.pad)
  if (opts.shadow !== false) {
    t.setShadow(0, Math.max(1, 3 * fontScale), '#00000055', 0, false, true)
  }
  return t
}

/** Numerals: white fill with ink outline (Best/Global/quantities). */
export const WHITE = '#ffffff'
/** Score green from the reference. */
export const SCORE_GREEN = '#00e83b'
