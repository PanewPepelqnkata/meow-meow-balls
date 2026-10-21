/**
 * Phase 2.14.0 (spec §2) — per-run VARIANT identity for tiers 8–9.
 *
 * Design: the rainbow (T8) and fantasy (T9) balls randomize their look
 * EVERY RUN — all tier-8 balls in one run share one variant, the next run
 * rolls a different one — so players collect different variants over time
 * (recorded per variant in the save, displayed in the JOURNAL).
 *
 * The variant derives from a run seed generated once per run (boot AND
 * restart) — never from per-ball seeds, so a run is visually coherent.
 * Rendering reads these helpers everywhere a tier-8/9 ball is drawn
 * (world renderer, discovery overlay, crane, next-ball preview, menu).
 */

/** Distinct collectible variants per randomized tier. */
export const VARIANT_COUNT = 8

let runSeed = newRunSeed()

function newRunSeed(): number {
  return (Math.random() * 0x7fffffff) | 0
}

/** Called by PlaygroundScene at every run start (boot + restarts). */
export function setRunSeed(seed: number): void {
  runSeed = seed >>> 0
}

/** Roll and install a brand-new run seed (new variant roll for tiers 8-9). */
export function rollNewRunSeed(): number {
  runSeed = newRunSeed()
  return runSeed
}

export function currentRunSeed(): number {
  return runSeed
}

/** Stable small hash (xorshift-style mix) for seed+salt → uint. */
function hash(seed: number, salt: number): number {
  let h = (seed ^ (salt * 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0
  return (h ^ (h >>> 15)) >>> 0
}

/** The variant id (0..VARIANT_COUNT-1) a run rolled for `tier` (8/9). */
export function variantIdFor(tier: number): number {
  return hash(runSeed, tier) % VARIANT_COUNT
}

/** Variants only exist for the randomized high tiers.
 *  TIER 8 IS NOT ONE: it is the cycling RGB ball, whose look is a
 *  continuous colour cycle, not a per-run variant. */
export function isVariantTier(tier: number): boolean {
  return tier === 9
}

/**
 * The variant a run rolled for `tier`, or null for non-randomized tiers.
 * THE single call site helper for rendering + journal recording.
 */
export function runVariantFor(tier: number): number | null {
  return isVariantTier(tier) ? variantIdFor(tier) : null
}

// ---------------------------------------------------------------------------
// Variant VISUAL parameters. Kept here (not in BallAppearance) so the menu
// screens can render variant chips through the same descriptors the game
// renderer uses.
// ---------------------------------------------------------------------------

/** Rainbow (T8) variants: color-ring rotation + stripe count/width. */
export function rainbowVariant(id: number): { rotate: number; stripes: number; stripeWidth: number } {
  return {
    rotate: id % 7,
    stripes: 6 + (id % 3) * 2,
    stripeWidth: 0.5 + ((id * 3) % 4) * 0.14,
  }
}

// Fantasy (T9) variant palettes live WITH the draw code
// (BallAppearance.drawFantasyBall) — one source of truth for the visuals.
