import { PHYSICS } from './physics'
import { SPAWN_WEIGHTS, pickWeightedTier } from './spawn'

/**
 * ============================================================================
 * BALL TIER SIZE CONFIGURATION — THE SINGLE SOURCE OF TRUTH (tiers 1–12)
 * ============================================================================
 *
 * HOW TO EDIT BALL SIZES:
 * Change the `radius` value of a tier below. EVERYTHING size-dependent derives
 * from this one table — soft-body particle ring layout, particle collision
 * radii and mass normalization, constraint rest lengths, rendered contour and
 * outline, facial feature scale, merge destination size, spawn clearance and
 * placement, the next-ball preview (scaled to fit its UI frame), and the
 * container safety checks. There are no other size tables: do not introduce
 * hardcoded radii in physics, renderer, or merge code.
 *
 * UNIT OF MEASUREMENT: `radius` is in DESIGN PIXELS of the logical 720×1280
 * stage (docs/STAGE_SIZE.md) — the same units every other config file uses.
 * It is the ball's REST radius: the rendered contour and the collision
 * envelope both sit at this radius (the collision envelope adds a 2px
 * contact skin, see SOFT.contactSkin). Tier 6's diameter (252px) is 62% of
 * the container floor width (405px) for scale reference.
 *
 * VALUES 1–7 are the established gameplay sizes — do not change them without
 * a verified gameplay reason. VALUES 10–12 are PROVISIONAL (marked below):
 * they exist only as count/s-size reservations — NOT yet reachable in
 * gameplay (playable: false) and their designs are not yet made, so tune
 * freely when those tiers are specified. Tier 7 (164) was already
 * established and is kept.
 *
 * Score values, colors, faces and merge rules are independent of radius:
 * edit `score` / `color` / `face` separately. `playable: false` tiers exist
 * only as size/color reservations — they never spawn and never merge INTO
 * (two tier-7 balls are held as-is until tiers 8+ are enabled).
 */
export interface BallTier {
  tier: number
  /** Ball rest radius in design pixels (720×1280 logical stage) — see above. */
  radius: number
  color: number
  shade: number
  score: number
  face: 'dot' | 'smile' | 'grin' | 'happy' | 'cheeky' | 'calm' | 'sleepy'
  playable: boolean
  physics?: Partial<typeof PHYSICS.ball>
}

const basePhysics = { ...PHYSICS.ball }

export const BALL_TIERS: readonly BallTier[] = [
  // Phase 2.11.2 radii (spec §4): the tier table is the single source for
  // size; the world→screen scale at the 1648×936 desktop reference is
  // ~0.8514 (see ResponsiveLayout), so these radii render the target
  // screen diameters: 75/89/106/130/153/181/222 px.
  { tier: 1, radius: 44, color: 0x4fc3f7, shade: 0x2196c9, score: 2, face: 'dot', playable: true, physics: basePhysics },
  { tier: 2, radius: 52, color: 0x5fd437, shade: 0x3fa021, score: 4, face: 'smile', playable: true, physics: basePhysics },
  { tier: 3, radius: 62, color: 0xf96ec0, shade: 0xd2438f, score: 8, face: 'grin', playable: true, physics: basePhysics },
  { tier: 4, radius: 76, color: 0xf44336, shade: 0xc22f24, score: 16, face: 'happy', playable: true, physics: basePhysics },
  { tier: 5, radius: 90, color: 0xff9800, shade: 0xd47a00, score: 32, face: 'cheeky', playable: true, physics: basePhysics },
  { tier: 6, radius: 106, color: 0xffeb3b, shade: 0xe0c200, score: 64, face: 'calm', playable: true, physics: basePhysics },
  { tier: 7, radius: 130, color: 0xff8c2e, shade: 0xd65f0a, score: 128, face: 'sleepy', playable: true },
  // Phase 2.13.0 (spec §10): tiers 8 and 9 are REAL merge destinations now —
  // the rainbow slime and the fantasy unicorn slime. `playable: true` lets a
  // T7 pair merge into T8 and a T8 pair into T9 (drops spawn tiers 1–4 via
  // the weighted SPAWN_WEIGHTS table in config/spawn.ts, so gameplay entry
  // is unchanged apart from the rare tier-4 drop). Tier 10 stays a reserved
  // placeholder until its final design is specified.
  { tier: 8, radius: 165, color: 0x9c27b0, shade: 0x7b1fa2, score: 256, face: 'calm', playable: true },
  { tier: 9, radius: 205, color: 0x795548, shade: 0x5d4037, score: 512, face: 'calm', playable: true },
  // Tiers 10–12: RESERVED placeholders (the user's spec: 12 tiers total;
  // designs beyond tier 9 are not yet made). They never spawn and never
  // merge INTO — the merge chain ends at tier 9 until they are specified.
  { tier: 10, radius: 250, color: 0x212121, shade: 0x000000, score: 1024, face: 'calm', playable: false },
  { tier: 11, radius: 305, color: 0x212121, shade: 0x000000, score: 2048, face: 'calm', playable: false },
  { tier: 12, radius: 370, color: 0x212121, shade: 0x000000, score: 4096, face: 'calm', playable: false },
]

export function getTier(tier: number): BallTier | undefined {
  return BALL_TIERS.find((t) => t.tier === tier)
}

export function isTransitionDefined(nextTier: number): boolean {
  const target = getTier(nextTier)
  return target != null && target.playable
}

/**
 * Tiers that can appear in the crane/preview queue from RANDOM spawning —
 * exactly the keys of the weighted probability table in `config/spawn.ts`
 * (Phase 2.13.1: 1–4, with tier 4 at 1%). Tiers 5–12 never spawn randomly;
 * they only ever exist as merge results.
 */
export const SPAWNABLE_TIERS: readonly number[] = Object.keys(SPAWN_WEIGHTS).map(Number)

/**
 * Weighted random tier for the crane/preview queue (Phase 2.13.1 spec §5):
 * inverse-CDF sampling over the normalized SPAWN_WEIGHTS — tier 1 is the
 * most common, each next tier rarer, tier 4 the rarest drop.
 */
export function randomSpawnTier(rng: () => number = Math.random): number {
  return pickWeightedTier(rng)
}

/**
 * Validate the tier table at startup (dev builds) and in tests. Throws a
 * descriptive Error on the first invalid entry: wrong count/order, missing
 * or non-positive/non-finite radius, unplayable-looking colors on playable
 * tiers. Keeps an edited config from silently breaking physics (a radius of
 * 0 or NaN would otherwise propagate into particle layout and constraints).
 */
export function validateBallTiers(): void {
  if (BALL_TIERS.length !== 12) {
    throw new Error(`BALL_TIERS must define exactly 12 tiers (found ${BALL_TIERS.length})`)
  }
  BALL_TIERS.forEach((t, i) => {
    if (t.tier !== i + 1) {
      throw new Error(`BALL_TIERS must be sequential starting at 1: entry ${i} has tier ${t.tier}`)
    }
    if (!Number.isFinite(t.radius) || t.radius <= 0) {
      throw new Error(`Tier ${t.tier} has an invalid radius: ${t.radius} (must be a positive finite number of design px)`)
    }
    if (t.playable) {
      // Playable tiers need a real appearance; reserved tiers may be 0x000000
      if (t.color === 0x000000 || t.score <= 0) {
        throw new Error(`Playable tier ${t.tier} needs a color and a positive score`)
      }
    }
    if (i > 0 && t.radius <= BALL_TIERS[i - 1]!.radius) {
      throw new Error(`Tier ${t.tier} radius ${t.radius} must be larger than tier ${t.tier - 1} radius ${BALL_TIERS[i - 1]!.radius}`)
    }
  })
}
