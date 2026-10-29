import { CONTAINER, containerBounds, wallTopYAt } from './container'

/**
 * Ball spawn/drop configuration — the SINGLE SOURCE for everything about
 * where and how new balls enter the game. Units are design pixels of the
 * logical 720×1280 stage (docs/STAGE_SIZE.md).
 *
 * Phase 2.10.1 (spec §2): the spawn point is anchored to the FULLY RAISED
 * wall tops, not the normal (lowered) rim:
 *
 *   spawnCenterY = raisedWallTopY − currentBallRadius − clearanceAboveRaisedWall
 *
 * so the BOTTOM of every spawned ball starts `clearanceAboveRaisedWall`
 * above the resolved raised rim (desktop y=510, portrait phone y=565).
 * Every drop stays above the walls and caps; per-tier radii come from the tier
 * config (single source of truth, spec §5), so all tiers spawn fully above them.
 * The horizontal range is computed from the
 * extrapolated slanted wall lines at the actual spawn height (the wall
 * lines extend above any wall top by construction), and the aim clamp,
 * ghost preview and actual spawn all use the same helpers — the preview
 * never lies about where the ball will appear.
 */
export const SPAWN = {
  /**
   * Vertical clearance (design px) between the spawned ball's BOTTOM edge
   * and the top of the FULLY RAISED walls. `spawnY()` applies this clearance
   * to the resolved raised rim on desktop and portrait phone, keeping every
   * tier above the caps throughout the ability cycle.
   * The score/NEXT HUD blocks sit at the left/right corners, outside the drop
   * x-range.
   */
  clearanceAboveRaisedWall: 50,
  /**
   * Extra horizontal safety margin (px) between the ball's collision
   * envelope and the (extrapolated) wall lines at spawn height.
   */
  clampMargin: 1,
  /** Min ms between drops (spec §5: one second). */
  cooldownMs: 1000,
} as const

/**
 * Spawn center y for a new ball of `radius` (the CURRENT tier's configured
 * radius): the ball's BOTTOM sits `clearanceAboveRaisedWall` above the
 * fully raised wall tops.
 */
export function spawnY(radius: number): number {
  return wallTopYAt(CONTAINER.raisedHeight) - radius - SPAWN.clearanceAboveRaisedWall
}

/**
 * Clamp a spawn/aim x so a ball of `radius` fits, with the configured
 * margin, between the (extrapolated) slanted wall lines at the ACTUAL spawn
 * height. The spawn height is above every wall top (normal or raised), but
 * the wall lines continue upward (same slope), so this keeps the falling
 * ball's envelope clear of the wall tops it is about to pass — for both
 * normal and raised walls.
 */
export function clampSpawnX(x: number, radius: number): number {
  const b = containerBounds()
  const y = spawnY(radius)
  const left = b.innerLeftAt(y) + radius + SPAWN.clampMargin
  const right = b.innerRightAt(y) - radius - SPAWN.clampMargin
  return Math.min(Math.max(x, left), Math.max(left, right))
}

/**
 * Phase 2.13.1 (spec §5) — WEIGHTED random-tier spawning.
 *
 * The single editable table of spawn probabilities for the crane/preview
 * queue. Keys are ball tiers, values are RELATIVE weights (any scale —
 * they are normalized by `normalizedSpawnWeights`). Current tuned values
 * (user-adjusted 2026-10-15):
 *
 *   tier 1: 40%   tier 2: 30%   tier 3: 20%   tier 4: 10%
 *
 * Tier 1 stays the most common, each next tier rarer, and tier 4 is the
 * rarest drop. Tiers 5–10 are NOT in the table and therefore never appear
 * from ordinary random spawning — they only ever exist as merge results
 * (add a key here to explicitly enable one).
 */
export const SPAWN_WEIGHTS: Readonly<Record<number, number>> = {
  1: 40,
  2: 30,
  3: 20,
  4: 10,
}

/**
 * Validated + normalized spawn weights: `{ tier: probability }` with the
 * probabilities summing to 1. Throws on an unusable table (all-zero, or any
 * non-finite/negative weight) so a bad edit fails loudly at boot, not as a
 * silent bias in gameplay.
 */
export function normalizedSpawnWeights(weights: Readonly<Record<number, number>> = SPAWN_WEIGHTS): Map<number, number> {
  const entries = Object.entries(weights).map(([k, v]) => ({ tier: Number(k), w: v }))
  if (entries.length === 0) throw new Error('normalizedSpawnWeights: empty weight table')
  for (const { tier, w } of entries) {
    if (!Number.isFinite(tier) || !Number.isInteger(tier) || tier < 1) {
      throw new Error(`normalizedSpawnWeights: invalid tier key ${String(tier)}`)
    }
    if (!Number.isFinite(w) || w < 0) {
      throw new Error(`normalizedSpawnWeights: tier ${tier} has invalid weight ${w}`)
    }
  }
  const total = entries.reduce((s, e) => s + e.w, 0)
  if (total <= 0) throw new Error('normalizedSpawnWeights: weights sum to zero')
  return new Map(entries.map((e) => [e.tier, e.w / total]))
}

/**
 * Weighted random tier selection (inverse-CDF sampling over the normalized
 * weights). NOT uniform: `rng` is consumed once per call, tier boundaries
 * follow the weight table order (ascending tier).
 */
export function pickWeightedTier(rng: () => number = Math.random, weights: Readonly<Record<number, number>> = SPAWN_WEIGHTS): number {
  const norm = normalizedSpawnWeights(weights)
  let r = rng()
  // Tolerate a sloppy rng: values outside [0,1) are pulled to the nearest
  // in-range edge (NaN/negative → 0 = first bucket, ≥1 → just inside the
  // last bucket) — deterministic, never crashes, never skips a tier.
  if (!(r > 0)) r = 0
  if (r >= 1) r = 1 - 1e-9
  for (const [tier, p] of norm) {
    if (r < p) return tier
    r -= p
  }
  // Floating-point dust: return the last (highest-probability-order) tier.
  const last = [...norm.keys()].pop()
  return last ?? 1
}
