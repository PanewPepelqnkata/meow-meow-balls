/**
 * COLLECTIBLE TIER THEMES (spec: tiers 9–12 are the collectible tiers).
 *
 * Each run rolls ONE theme per collectible tier, and the theme is fixed
 * for the whole run: if tier 9 rolls "shark", every tier-9 ball this run
 * is a shark and two sharks merge into that run's themed tier 10. The
 * next run rolls again — players collect the themed balls they discover
 * for the first time.
 *
 * This config is the SINGLE SOURCE OF TRUTH for which themes exist per
 * tier and how the roll is weighted. Adding a new theme for a tier:
 * append it to `themes` with a `weight`; the roll in runVariant.ts picks
 * from this table automatically. No renderer changes needed — renderers
 * switch on the theme NAME.
 */

/** One collectible theme for a tier. `name` is what renderers switch on;
 *  `weight` is relative (a theme with weight 1 among total 2 = 50%). */
export interface CollectibleTheme {
  name: string
  weight: number
}

/** Per-tier collectible theme tables. Tier 9 has two equally likely
 *  themes (shark / pig); tiers 10–12 will grow their own tables here as
 *  their designs land. */
export const COLLECTIBLE_THEMES: Record<number, readonly CollectibleTheme[]> = {
  9: [
    { name: 'shark', weight: 1 },
    { name: 'pig', weight: 1 },
  ],
  10: [
    { name: 'crab', weight: 1 },
  ],
}

/**
 * Roll the collectible theme for a tier from a run seed — weighted by
 * the config's `weight` fields. Pure and deterministic per (seed, tier).
 *
 * @param tier the collectible tier (9–12)
 * @param seed the run seed (stable for the whole run)
 * @param hash the run-variant hash function (injected to keep this
 *        config dependency-free)
 * @returns the theme NAME the run rolled, or null when the tier has no
 *          collectible themes configured
 */
export function rollCollectibleTheme(
  tier: number,
  seed: number,
  hash: (seed: number, salt: number) => number,
): string | null {
  const themes = COLLECTIBLE_THEMES[tier]
  if (!themes || themes.length === 0) return null
  const total = themes.reduce((a, t) => a + t.weight, 0)
  const roll = hash(seed, tier * 7919 + 13) % total
  let acc = 0
  for (const t of themes) {
    acc += t.weight
    if (roll < acc) return t.name
  }
  return themes[themes.length - 1]!.name
}
