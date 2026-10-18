/**
 * Jelly squash-and-stretch for BallRenderer (visual only — colliders are
 * never modified). Phase 2.3 model:
 *
 * - Impacts come from REAL collision events: contact normal + approach speed.
 *   Rolling, sliding and resting contacts never generate deformation.
 * - The spring is UNDERDAMPED (ζ ≈ 0.22): a quick compression at impact,
 *   a smooth rebound with overshoot, 3–5 progressively smaller oscillations,
 *   then an exact return to circular. No residual squash, no rest oscillation.
 * - Two coupled springs (primary impact axis + secondary cross-axis) give
 *   soft follow-through: subsequent collisions re-excite the springs while
 *   they are still recovering.
 * - Volume-preserving oval: squash 1−s along the impact axis, 1/(1−s·k)
 *   across it, so the ball reads as jelly, never as a shrinking circle.
 */

export interface DeformState {
  /**
   * Phase 2.6 model. `squash` is the amplitude of the LOCALIZED dent at the
   * contact point (primary visible effect); `cross` is the delayed bulge-ring
   * amplitude driven by the dent's motion (material displaced around the
   * shape). The global ellipse is demoted to a subtle volume-preserving base.
   */
  /** Dent spring: contact-region compression (positive = inward). */
  squash: number
  squashVel: number
  /** Bulge spring: outward ring around the dent (delayed → propagation). */
  cross: number
  crossVel: number
  /** Impact axis in the ball's LOCAL frame (body angle removed); dominant axis is 1. */
  axisX: number
  axisY: number
  /** Contact-point direction in the LOCAL frame (unit vector). */
  contactX: number
  contactY: number
  /** Last impact strength [0..1] — scales the localized dent + bulge. */
  lastStrength: number
}

export const DEFORM = {
  /** Max dent amplitude fraction on the hardest impacts (~28% contour dip
   * including the ellipse base — within the 20–25%+ visible target). */
  maxSquash: 0.17,
  /** Approach speed (px/step) mapping to full squash, scaled proportionally
   * with radius. Calibrated against REAL pre-collision approach speeds
   * (a full-height floor drop measures ≈19 px/step at tier-1 size). */
  fullImpactSpeed: 16,
  /** Approach speeds below this (px/step) are ignored (resting contacts). */
  minImpactSpeed: 1.2,
  /** Dent spring: ω² (rad/s)² — ω ≈ 13.8 rad/s (~4.5 Hz jelly frequency). */
  stiffness: 190,
  /** Dent spring damping: c = 2ζω with ζ ≈ 0.35 (c ≈ 9.6):
   * a deep compression, smooth rebound, 3–4 clearly visible shrinking
   * oscillations over ~0.6 s, then an exact return to circular. */
  damping: 9.6,
  /** Bulge spring: softer, slightly slower — lags the dent (propagation). */
  crossStiffness: 120,
  crossDamping: 7.2,
  /** Follower gain: how strongly the bulge chases the dent amplitude.
   * Equilibrium cross ≈ dent × gain/crossStiffness ≈ 0.46× with lag. */
  crossCoupling: 55,
  /** Localization width of the contact-point dent, in radians (Gaussian σ). */
  dentWidth: 1.0,
  /** Bulge ring: how far from the dent the outward bulge peaks (radians). */
  bulgeOffset: 1.6,
  /** Bulge strength relative to the dent depth. */
  bulgeStrength: 1.0,
  /** Global ellipse keeps only this fraction of the squash (localized is primary). */
  globalEllipseFraction: 0.3,
} as const

export function createDeformState(): DeformState {
  return {
    squash: 0,
    squashVel: 0,
    cross: 0,
    crossVel: 0,
    axisX: 0,
    axisY: 1,
    contactX: 0,
    contactY: 1,
    lastStrength: 0,
  }
}

/** Normalized impact strength [0, 1] from approach speed and ball radius. */
export function impactStrength(approachSpeed: number, radius: number): number {
  if (approachSpeed < DEFORM.minImpactSpeed) return 0
  return Math.min(1, approachSpeed / (DEFORM.fullImpactSpeed * (radius / 48)))
}

/**
 * Register an impact: excite the primary spring toward a speed-proportional
 * squash, set the squash axis (world normal rotated into the body's local
 * frame), and kick the cross spring for follow-through.
 */
export function registerImpact(
  state: DeformState,
  normalX: number,
  normalY: number,
  approachSpeed: number,
  radius: number,
  bodyAngle: number,
): void {
  const strength = impactStrength(approachSpeed, radius)
  if (strength <= 0) return
  // World normal -> body-local frame (counter-rotate by body angle)
  const cos = Math.cos(-bodyAngle)
  const sin = Math.sin(-bodyAngle)
  const lx = normalX * cos - normalY * sin
  const ly = normalX * sin + normalY * cos
  // Dominant axis only — deformation is a clean directional oval
  if (Math.abs(lx) >= Math.abs(ly)) {
    state.axisX = Math.sign(lx) || 1
    state.axisY = 0
  } else {
    state.axisX = 0
    state.axisY = Math.sign(ly) || 1
  }
  const target = strength * DEFORM.maxSquash
  // Attack: deep, immediate dent at the contact point (visible on frame 1)
  state.squashVel += (target - state.squash) * 42
  state.squash = Math.max(state.squash, target * 0.5)
  // The bulge does NOT jump — it is driven by the dent's motion in
  // stepDeform (crossCoupling), giving the spread-around-the-shape feel.
  // Sign convention: positive cross = outward bulge ring (displaced material).
  // Contact-point direction (unit, local frame) drives the localized dent
  const cl = Math.hypot(lx, ly) || 1
  state.contactX = lx / cl
  state.contactY = ly / cl
  state.lastStrength = Math.max(state.lastStrength * 0.4, strength)
}

/** Advance both springs one frame. Stable for any dt up to a frame stall. */
export function stepDeform(state: DeformState, deltaMs: number): void {
  const dt = Math.min(deltaMs, 50) / 1000
  // Dent spring (semi-implicit Euler; stable for dt ≤ 50 ms at ω≈13.8)
  state.squashVel += (-DEFORM.stiffness * state.squash - DEFORM.damping * state.squashVel) * dt
  state.squash += state.squashVel * dt
  // Bulge spring CHASES the dent amplitude with a lag — the material pushed
  // away from the contact arrives slightly later (propagation), and its
  // equilibrium scales with the dent automatically. Re-excitation works
  // without resets because the chase target is the live dent value.
  state.crossVel +=
    (state.squash - state.cross) * DEFORM.crossCoupling * dt +
    (-DEFORM.crossStiffness * state.cross - DEFORM.crossDamping * state.crossVel) * dt
  state.cross += state.crossVel * dt
  // Hard clamps: never flatten beyond maxSquash, never invert the silhouette
  const max = DEFORM.maxSquash
  const min = -max * 0.55
  if (state.squash > max) {
    state.squash = max
    state.squashVel = Math.min(state.squashVel, 0)
  } else if (state.squash < min) {
    state.squash = min
    state.squashVel = Math.max(state.squashVel, 0)
  }
  const cMax = max * 0.55
  if (state.cross > cMax) {
    state.cross = cMax
    state.crossVel = Math.min(state.crossVel, 0)
  } else if (state.cross < -cMax) {
    state.cross = -cMax
    state.crossVel = Math.max(state.crossVel, 0)
  }
  // Snap to exact rest below visual threshold: perfect circle at rest
  if (Math.abs(state.squash) < 0.0004 && Math.abs(state.squashVel) < 0.004) {
    state.squash = 0
    state.squashVel = 0
    state.lastStrength = 0
  }
  if (Math.abs(state.cross) < 0.0004 && Math.abs(state.crossVel) < 0.004) {
    state.cross = 0
    state.crossVel = 0
  }
}

/**
 * LOCALIZED contour displacement: the radius multiplier at local angle `a`
 * for the current deformation state. Produces a slime-like response rather
 * than a plain ellipse:
 *  - a Gaussian dent at the contact point (compresses where it was hit),
 *  - an outward bulge ring on the opposite/far side (volume pushed away),
 *  - the global axis squash/rebound from the damped spring.
 * Pure function — tests verify the actual rendered geometry.
 */
export function contourPoint(
  state: DeformState,
  angle: number,
  radius: number,
): number {
  // Subtle global base ellipse (volume-preserving hint of the impact axis)
  const g = state.squash * DEFORM.globalEllipseFraction
  const along = 1 - g
  const across = 1 / Math.max(0.8, along)
  const radialX = state.axisX !== 0 ? along : across
  const radialY = state.axisX !== 0 ? across : along
  const c = Math.cos(angle)
  const sn = Math.sin(angle)
  const base = radius / Math.sqrt((c / radialX) ** 2 + (sn / radialY) ** 2)

  if (state.lastStrength <= 0.001) return base

  // PRIMARY effect: localized dent + bulge around the contact point
  const cx = Math.cos(angle)
  const cy = Math.sin(angle)
  const dot = cx * state.contactX + cy * state.contactY
  const dist = Math.acos(Math.max(-1, Math.min(1, dot)))
  const sigma = DEFORM.dentWidth
  // Dent: Gaussian compression centered on the contact direction.
  // `state.squash` IS the dent amplitude — no double maxSquash multiplier.
  const dent = Math.exp(-(dist * dist) / (2 * sigma * sigma)) * state.squash * 1.3 * radius
  // Bulge: outward ring at ~90° from the contact (displaced material),
  // amplitude from its own delayed spring.
  const bulgeDist = Math.abs(dist - DEFORM.bulgeOffset)
  const bulgeSigma = sigma * 1.5
  const bulge =
    Math.exp(-(bulgeDist * bulgeDist) / (2 * bulgeSigma * bulgeSigma)) *
    state.cross * DEFORM.bulgeStrength * 2.2 * radius
  return base - dent + bulge
}

/** Full contour radii (kept for compatibility with existing tests/callers). */
export function contourRadii(
  state: DeformState,
  radius: number,
  segments: number,
): number[] {
  const pts: number[] = []
  for (let i = 0; i < segments; i++) {
    pts.push(contourPoint(state, (i / segments) * Math.PI * 2, radius))
  }
  return pts
}

/**
 * Final scale factors: volume-preserving oval along the impact axis plus the
 * secondary cross sway. Face, outline and highlights scale WITH the image, so
 * they can never drift apart.
 */
export function scaleFromState(state: DeformState): { x: number; y: number } {
  const s = state.squash + state.cross * 0.5 // cross sways the same axis gently
  const along = 1 - s
  const across = 1 / Math.max(0.72, along)
  if (state.axisX !== 0) {
    return { x: along, y: across }
  }
  return { x: across, y: along }
}

