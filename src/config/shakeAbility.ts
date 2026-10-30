/**
 * Shake ability configuration: Chill Earthquake Feel.
 *
 * Modeled after the reference clip but tuned down for comfort:
 * - 10-second active duration.
 * - Gentle continuous seismic rumble (subtle screen shake + slight rotational tilt).
 * - Periodic bounce pulses that nudge balls upward and sideways into contacts.
 * - Falling ceiling rubble / debris particles and dust puffs along walls and floor.
 * - Side-only invisible retention walls so balls cannot escape left/right, but the
 *   top stays open for normal drops (no teleport glitch).
 */
export const SHAKE_ABILITY = {
  /** Total ability duration in milliseconds. */
  durationMs: 10_000,
  /** Repetition period between seismic bounce pulses in milliseconds. */
  cyclePeriodMs: 1_600,
  /** Duration of each bounce pulse impulse window in milliseconds. */
  pulseDurationMs: 450,
  /** Upward bounce impulse velocity applied to balls (px / physics frame). */
  bounceVelocityY: -8.5,
  /** Lateral chaotic agitation velocity (px / physics frame). */
  bounceJitterX: 3.0,
  /** Camera rumble translation amplitude in stage/world pixels (chill). */
  rumbleIntensity: 3.0,
  /** Camera rotational rumble amplitude (~0.5 degrees in radians). */
  rumbleRotation: 0.009,
  /** Maximum active debris particles falling during the earthquake. */
  maxDebrisParticles: 24,
  /** Maximum active smoke / dust puffs along boundaries. */
  maxDustPuffs: 16,
} as const
