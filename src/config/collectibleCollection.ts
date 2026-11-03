import { COLLECTIBLE_THEMES } from './collectibleThemes'

/** Character slots, not palette variants. Unimplemented art stays locked. */
export const COLLECTIBLE_SLOT_COUNT = 8
export const COLLECTIBLE_TIERS = [9, 10, 11, 12] as const

export interface CollectibleSlot {
  slot: number
  theme: string | null
  label: string | null
}

export function collectionSlotsFor(tier: number): CollectibleSlot[] {
  const themes = COLLECTIBLE_THEMES[tier] ?? []
  return Array.from({ length: COLLECTIBLE_SLOT_COUNT }, (_, slot) => {
    const theme = themes[slot]?.name ?? null
    return { slot, theme, label: theme ? theme.toUpperCase() : null }
  })
}

/** Keep the original discovery palette without confusing it with character identity. */
export function collectibleDiscoveryKey(tier: number, theme: string, variant: number): string {
  return `${tier}:${theme}:${variant}`
}

export interface CollectibleDiscovery {
  at: number
  variant: number
}

export function collectionDiscovery(
  variants: Readonly<Record<string, number>>,
  tier: number,
  theme: string,
): CollectibleDiscovery | null {
  let first: CollectibleDiscovery | null = null
  const prefix = `${tier}:${theme}:`
  for (const [key, at] of Object.entries(variants)) {
    if (!key.startsWith(prefix)) continue
    const variant = Number(key.slice(prefix.length))
    if (!Number.isInteger(variant) || variant < 0 || variant >= 8) continue
    if (!first || at < first.at) first = { at, variant }
  }
  // Historical tier-10 records are unambiguous: crab was its only character.
  // Tier-9 numeric keys did not record pig/shark; never guess their identity.
  if (!first && tier === 10 && theme === 'crab') {
    for (const [key, at] of Object.entries(variants)) {
      if (!/^10:\d+$/.test(key)) continue
      const variant = Number(key.slice(3))
      if (variant >= 0 && variant < 8 && (!first || at < first.at)) first = { at, variant }
    }
  }
  return first
}

export function hasUnidentifiedCollectionFinds(variants: Readonly<Record<string, number>>, tier: number): boolean {
  return tier === 9 && Object.keys(variants).some((key) => /^9:\d+$/.test(key))
}
