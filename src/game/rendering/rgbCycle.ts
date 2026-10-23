/**
 * The TIER 8 ball: a solid-colour ball that cycles through FIVE colours —
 * red, blue, cyan, green, white — with a smooth GRADIENT between each:
 * the whole ball morphs from one colour into the next (e.g. red gradually
 * becomes blue), it never snaps.
 *
 * The cycle is derived from the CLOCK (not a frame counter), so every
 * consumer — the gameplay renderer, the drop-claw preview, the next-ball
 * preview, the tier progression strip, the title screen and the discovery
 * overlay/banner — shows the SAME colour at the same moment.
 */

/** How long each colour holds at its full intensity, in milliseconds. */
export const CYCLE_HOLD_MS = 420

/** How long the gradient from one colour to the next takes, in ms. */
export const CYCLE_BLEND_MS = 330

/** The total period of one colour slot (hold + blend into the next). */
export const CYCLE_STEP_MS = CYCLE_HOLD_MS + CYCLE_BLEND_MS

/**
 * The FIVE colours of the cycle, in order: red → blue → cyan → green →
 * white → red. Fresh hexes — none of these appear anywhere else in the
 * game (tier colours, combo grades, effect colours are all different), so
 * the cycling ball is instantly recognisable as THE colour-shifting one.
 */
export const CYCLE_COLORS = [
  0xe94040, // red — a warm signal red (distinct from tier 4's 0xf44336)
  0x3d5afe, // blue — a deep indigo-leaning blue (distinct from tier 1's cyan-blue)
  0x00e5c7, // cyan — a turquoise-leaning cyan
  0x69e04b, // green — a bright leaf green (distinct from tier 2's 0x5fd437)
  0xf4f6ff, // white — a cool near-white
] as const

/** Linear interpolation between two 0xRRGGBB colours, channel by channel. */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const br = (b >> 16) & 0xff
  const bg = (b >> 8) & 0xff
  const bb = b & 0xff
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return (r << 16) | (g << 8) | bl
}

/**
 * The colour of the cycle at a given time — a SOLID colour that morphs
 * smoothly between the five: hold for CYCLE_HOLD_MS, then blend into the
 * next colour over CYCLE_BLEND_MS, forever.
 *
 * @param timeMs the current clock in milliseconds
 */
export function cycleColor(timeMs: number): number {
  const count = CYCLE_COLORS.length
  const total = CYCLE_STEP_MS * count
  // A negative clock (clock skew) wraps into range; huge clocks fold too.
  const t = ((timeMs % total) + total) % total
  const slot = Math.floor(t / CYCLE_STEP_MS)
  const slotT = t - slot * CYCLE_STEP_MS
  const from = CYCLE_COLORS[slot % count]!
  // Blending into the NEXT colour during the tail of the slot.
  const to = CYCLE_COLORS[(slot + 1) % count]!
  if (slotT <= CYCLE_HOLD_MS) return from
  const blendT = (slotT - CYCLE_HOLD_MS) / CYCLE_BLEND_MS
  return lerpColor(from, to, blendT)
}
