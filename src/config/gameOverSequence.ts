/** End-of-run reaction and overlay presentation tuning; the finished pile stays intact. */

export const GAME_OVER_SEQUENCE = {
  /** Brief panic reaction before the overlay appears (ms). */
  panicMs: 300,

  /** One subtle camera shake, skipped entirely for reduced motion. */
  shakeStrength: 0.003,
  shakeDurationMs: 120,

  /** Overlay score count-up duration (ms). */
  scoreCountMs: 620,
} as const
