/**
 * The TIER 8 ball: a SOLID WHITE ball. The old five-colour clock cycle
 * (green/blue/cyan/red/white) is retired — the user asked for white. The
 * helpers keep their names/signatures so every consumer (gameplay
 * renderer, claw, previews, progression strip, title, discovery) reads
 * the same constant without touching their call sites.
 */

/** Kept for call-site compatibility — no longer drives anything. */
export const CYCLE_HOLD_MS = 420

/** Kept for call-site compatibility. */
export const CYCLE_BLEND_MS = 330

/** Kept for call-site compatibility. */
export const CYCLE_STEP_MS = CYCLE_HOLD_MS + CYCLE_BLEND_MS

/** The tier-8 ball colour: solid white. */
export const TIER8_COLOR = 0xffffff

/**
 * The tier-8 colour at `timeMs` — constant white now; the clock argument
 * is accepted (and ignored) so call sites don't change.
 */
export function cycleColor(_timeMs?: number): number {
  void _timeMs
  return TIER8_COLOR
}
