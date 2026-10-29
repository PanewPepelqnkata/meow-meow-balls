/**
 * SHAKE ABILITY CONFIGURATION
 *
 * When active (10s duration):
 * - Shakes the container with an earthquake tremor effect.
 * - Balls CANNOT fall out of the container at all (rigid collision lid/barrier + clamp containment + game-over suppression).
 */
export const SHAKE_ABILITY = {
  /** Active duration in milliseconds (10 seconds). */
  durationMs: 10_000,
  /** Visual earthquake tremor frequency in Hz. */
  tremorFreqHz: 22,
  /** Horizontal earthquake offset amplitude in design px. */
  ampX: 6.5,
  /** Vertical earthquake offset amplitude in design px. */
  ampY: 3.5,
  /** Micro-rotational earthquake wobble in radians. */
  ampAngle: 0.012,
  /** Physics impulses injected to balls during earthquake to cause physical agitation. */
  physicsJitterImpulse: 0.0035,
} as const
