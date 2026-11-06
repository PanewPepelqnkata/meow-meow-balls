/**
 * Persistent ability upgrades shared by the store, save normalisation and the
 * gameplay runtime.  Levels are zero-based: a fresh account has level 0 and
 * the first purchase raises it to level 1.
 */

export type UpgradeId = 'wallDuration' | 'shakeDuration' | 'shakeIntensity'

export type UpgradeLevels = Record<UpgradeId, number>

export interface UpgradeDefinition {
  readonly id: UpgradeId
  readonly name: string
  readonly label: string
  readonly description: string
  readonly maxLevel: number
  /** Cost of the first purchase, in coins. */
  readonly baseCost: number
  /** Flat cost increase for each already-owned level. */
  readonly costStep: number
}

/**
 * Store metadata and gameplay progression limits.  Keep this object as the
 * only source of upgrade limits; runtime helpers below intentionally clamp
 * malformed/old saves to these values.
 */
export const UPGRADE_CATALOG = {
  wallDuration: {
    id: 'wallDuration',
    name: 'Wall Duration',
    label: 'Wall Duration',
    description: 'Raise Walls lasts one second longer per level.',
    maxLevel: 10,
    baseCost: 10,
    costStep: 10,
  },
  shakeDuration: {
    id: 'shakeDuration',
    name: 'Shake Duration',
    label: 'Shake Duration',
    description: 'Shake lasts half a second longer per level.',
    maxLevel: 10,
    baseCost: 10,
    costStep: 10,
  },
  shakeIntensity: {
    id: 'shakeIntensity',
    name: 'Shake Intensity',
    label: 'Shake Intensity',
    description: 'Shake bounce and jitter impulses increase by ten percent per level.',
    maxLevel: 5,
    baseCost: 20,
    costStep: 20,
  },
} as const satisfies Record<UpgradeId, UpgradeDefinition>

const UPGRADE_IDS: readonly UpgradeId[] = ['wallDuration', 'shakeDuration', 'shakeIntensity']

/** A fresh account/run's persisted upgrade levels. */
export function freshUpgradeLevels(): UpgradeLevels {
  return { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 }
}

/**
 * Validate and clamp upgrade levels from local/cloud data.  Unknown keys are
 * ignored, fractional/negative values become zero, and values above a
 * catalog's cap are capped.  This accepts unknown input deliberately because
 * save hydration crosses a JSON/cloud boundary.
 */
export function normalizeUpgradeLevels(raw?: unknown): UpgradeLevels {
  const fresh = freshUpgradeLevels()
  if (!raw || typeof raw !== 'object') return fresh
  const source = raw as Record<string, unknown>
  for (const id of UPGRADE_IDS) {
    const value = source[id]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    fresh[id] = Math.min(UPGRADE_CATALOG[id].maxLevel, Math.max(0, Math.floor(value)))
  }
  return fresh
}

/**
 * Price of the next purchase at `currentLevel` (zero means the first
 * purchase).  Capped levels have no next purchase and return zero.
 */
export function upgradeCost(id: UpgradeId, currentLevel: number): number {
  const definition = UPGRADE_CATALOG[id]
  if (!definition) return 0
  const level = Number.isFinite(currentLevel) ? Math.max(0, Math.floor(currentLevel)) : 0
  if (level >= definition.maxLevel) return 0
  return definition.baseCost + definition.costStep * level
}

function readLevel(levelsOrLevel: UpgradeLevels | Partial<UpgradeLevels> | number | null | undefined, id: UpgradeId): number {
  if (typeof levelsOrLevel === 'number') {
    return normalizeUpgradeLevels({ [id]: levelsOrLevel })[id]
  }
  return normalizeUpgradeLevels(levelsOrLevel)[id]
}

/** Active Raise Walls duration, including the supplied persisted level. */
export function wallDurationMs(levelsOrLevel?: UpgradeLevels | Partial<UpgradeLevels> | number | null): number {
  return 15_000 + readLevel(levelsOrLevel, 'wallDuration') * 1_000
}

/** Active Shake duration, including the supplied persisted level. */
export function shakeDurationMs(levelsOrLevel?: UpgradeLevels | Partial<UpgradeLevels> | number | null): number {
  return 5_000 + readLevel(levelsOrLevel, 'shakeDuration') * 500
}

/**
 * Physical Shake impulse/jitter multiplier.  This intentionally does not
 * affect camera rumble, debris, or dust visuals.
 */
export function shakeImpulseMultiplier(levelsOrLevel?: UpgradeLevels | Partial<UpgradeLevels> | number | null): number {
  return 1 + readLevel(levelsOrLevel, 'shakeIntensity') * 0.1
}
