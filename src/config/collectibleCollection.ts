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

export function isCollectibleTier(tier: number): boolean {
  return (COLLECTIBLE_TIERS as readonly number[]).includes(tier)
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
    if (!key.startsWith(prefix) || !Number.isFinite(at) || at <= 0) continue
    const palette = key.slice(prefix.length)
    if (!/^[0-7]$/.test(palette)) continue
    const variant = Number(palette)
    if (!first || at < first.at) first = { at, variant }
  }
  return first
}

/** Numeric palette records do not identify a character; older score backfills also generated them. */
export function hasUnidentifiedCollectionFinds(variants: Readonly<Record<string, number>>, tier: number): boolean {
  if (!isCollectibleTier(tier)) return false
  const prefix = `${tier}:`
  return Object.entries(variants).some(([key, at]) =>
    key.startsWith(prefix) && /^[0-7]$/.test(key.slice(prefix.length)) && Number.isFinite(at) && at > 0,
  )
}
