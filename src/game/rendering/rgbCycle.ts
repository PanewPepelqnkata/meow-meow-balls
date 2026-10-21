/**
 * The TIER 8 ball: a solid RGB ball whose colour cycles continuously.
 *
 * The user asked for a plain colour-cycling ball — NOT a rainbow: the
 * body is ONE solid colour at any moment, and that colour steps through
 * red -> blue -> red -> ... every CYCLE_STEP_MS (0.25s). The whole ball
 * changes at once, so the character reads as one object changing colour
 * rather than a multicolour pinwheel.
 *
 * The cycle is derived from the CLOCK (not a frame counter), so every
 * consumer — the gameplay renderer, the drop-claw preview and the
 * next-ball preview — shows the SAME colour at the same moment.
 */

/** How long each colour holds, in milliseconds. */
export const CYCLE_STEP_MS = 250

/** The two colours of the cycle. */
export const CYCLE_COLORS = [0xf44336, 0x2196f3] as const

/**
 * The colour of the cycle at a given time.
 *
 * @param timeMs the current clock in milliseconds
 */
export function cycleColor(timeMs: number): number {
  const step = Math.floor(timeMs / CYCLE_STEP_MS)
  return CYCLE_COLORS[step % CYCLE_COLORS.length]!
}
