/**
 * Per-run collectible metadata stored on score and guest-score rows.
 *
 * This is deliberately separate from the lifetime collection (`variants` in
 * SaveDataV1): a run snapshot records identities actually merged in that run,
 * including identities the player had already found in an earlier run.
 */
export interface RunCollectibleDiscovery {
  tier: number
  theme: string
  variant: number
  discoveredAt: number
}

export type RunCollectibles = RunCollectibleDiscovery[]

const MIN_COLLECTIBLE_TIER = 9
const MAX_COLLECTIBLE_TIER = 12
const MAX_VARIANT = 7

function isValidDiscovery(value: unknown): value is RunCollectibleDiscovery {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const discovery = value as Partial<RunCollectibleDiscovery>
  return (
    typeof discovery.tier === 'number' &&
    Number.isInteger(discovery.tier) &&
    discovery.tier >= MIN_COLLECTIBLE_TIER &&
    discovery.tier <= MAX_COLLECTIBLE_TIER &&
    typeof discovery.theme === 'string' &&
    discovery.theme.trim().length > 0 &&
    typeof discovery.variant === 'number' &&
    Number.isInteger(discovery.variant) &&
    discovery.variant >= 0 &&
    discovery.variant <= MAX_VARIANT &&
    typeof discovery.discoveredAt === 'number' &&
    Number.isFinite(discovery.discoveredAt) &&
    discovery.discoveredAt > 0
  )
}

export function runCollectibleKey(discovery: Pick<RunCollectibleDiscovery, 'tier' | 'theme' | 'variant'>): string {
  return `${discovery.tier}:${discovery.theme}:${discovery.variant}`
}

/**
 * Normalize the nullable JSON column while retaining its legacy distinction:
 * null means no metadata was recorded; [] means a recorded run with no finds.
 * Invalid entries are discarded, duplicate identities retain their earliest
 * timestamp, and the result is ordered by first discovery time.
 */
export function normalizeRunCollectibles(value: unknown): RunCollectibles | null {
  if (value == null) return null
  if (!Array.isArray(value)) return null

  const byIdentity = new Map<string, RunCollectibleDiscovery>()
  for (const item of value) {
    if (!isValidDiscovery(item)) continue
    const discovery: RunCollectibleDiscovery = {
      tier: item.tier,
      theme: item.theme.trim(),
      variant: item.variant,
      discoveredAt: item.discoveredAt,
    }
    const key = runCollectibleKey(discovery)
    const prior = byIdentity.get(key)
    if (!prior || discovery.discoveredAt < prior.discoveredAt) byIdentity.set(key, discovery)
  }

  return [...byIdentity.values()].sort((a, b) => a.discoveredAt - b.discoveredAt || runCollectibleKey(a).localeCompare(runCollectibleKey(b)))
}

/** Add one observed identity to a run snapshot, preserving first-observed time. */
export function addRunCollectible(
  current: Readonly<RunCollectibles>,
  discovery: RunCollectibleDiscovery,
): RunCollectibles {
  const normalized = normalizeRunCollectibles([...current, discovery])
  return normalized ?? []
}
