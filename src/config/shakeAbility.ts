/**
 * Shake ability configuration: Full Earthquake Feel.
 *
 * Modeled after the reference clip:
 * - 10-second active duration.
 * - Continuous high-frequency seismic rumble (chaotic screen shake + rotational camera vibration).
 * - Frequent periodic bounce pulses that launch balls upward and sideways into chaotic contacts.
 * - Falling ceiling rubble / debris particles and dust puffs along walls and floor.
 * - Physical top retention lid so bouncing balls stay securely inside the container.
 */
export const SHAKE_ABILITY = {
  /** Total ability duration in milliseconds. */
  durationMs: 10_000,
  /** Repetition period between explosive seismic bounce pulses in milliseconds. */
  cyclePeriodMs: 1_600,
  /** Duration of each bounce pulse impulse window in milliseconds. */
  pulseDurationMs: 450,
  /** Upward explosive impulse velocity applied to balls (px / physics frame). */
  bounceVelocityY: -10.5,
  /** Lateral chaotic agitation velocity (px / physics frame). */
  bounceJitterX: 4.0,
  /** Camera seismic rumble translation amplitude in stage/world pixels. */
  rumbleIntensity: 7.5,
  /** Camera seismic rotational rumble amplitude (~1.5 degrees in radians). */
  rumbleRotation: 0.026,
  /** Maximum active debris particles falling during the earthquake. */
  maxDebrisParticles: 32,
  /** Maximum active smoke / dust puffs along boundaries. */
  maxDustPuffs: 24,
} as const
