/**
 * Container Skins Catalog — Server-authoritative cosmetic skins for the
 * gameplay U-container.
 *
 * Physics invariance: container skins ONLY affect visual rendering in
 * `ContainerView` (and preview thumbnails in Store / King's Wardrobe).
 * Matter.js colliders, wall thickness, slope, floor position, opening width,
 * spawn anchors, and Extend Walls animation distances remain 100% identical.
 */

export type ContainerSkinId = 'royal_keep' | 'og_container'

export const DEFAULT_CONTAINER_SKIN_ID: ContainerSkinId = 'royal_keep'

export const OG_CONTAINER_COST = 250

export interface ContainerSkinDefinition {
  id: ContainerSkinId
  name: string
  subtitle: string
  description: string
  benefitLabel: string
  cost: number
  isDefault: boolean
  accentColor: number
  themeStyle: 'medieval_bastion' | 'classic_hazard'
}

export const CONTAINER_SKIN_CATALOG: Readonly<Record<ContainerSkinId, ContainerSkinDefinition>> = {
  royal_keep: {
    id: 'royal_keep',
    name: 'Royal Keep',
    subtitle: 'FORTIFIED BASTION',
    description:
      'Carved ashlar castle stonework with golden inner trim, brass cog-rail guides, and telescoping bastion walls.',
    benefitLabel: 'DEFAULT ROYAL CONTAINER',
    cost: 0,
    isDefault: true,
    accentColor: 0xd89a18,
    themeStyle: 'medieval_bastion',
  },
  og_container: {
    id: 'og_container',
    name: 'OG Container',
    subtitle: 'CLASSIC ARCADE',
    description:
      'The original glossy royal-blue arcade container with cream-and-charcoal diagonal hazard stripes.',
    benefitLabel: 'CLASSIC HAZARD SKIN',
    cost: OG_CONTAINER_COST,
    isDefault: false,
    accentColor: 0x118cfb,
    themeStyle: 'classic_hazard',
  },
} as const

export const CONTAINER_SKIN_IDS: readonly ContainerSkinId[] = ['royal_keep', 'og_container'] as const

export function isValidContainerSkinId(value: unknown): value is ContainerSkinId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CONTAINER_SKIN_CATALOG, value.trim())
}

export function getContainerSkin(id: unknown): ContainerSkinDefinition {
  if (isValidContainerSkinId(id)) {
    return CONTAINER_SKIN_CATALOG[id.trim() as ContainerSkinId]
  }
  return CONTAINER_SKIN_CATALOG[DEFAULT_CONTAINER_SKIN_ID]
}

/**
 * Normalize an arbitrary owned-skins array so `'royal_keep'` is always owned,
 * only valid skin IDs are kept, and order is canonical and deduplicated.
 */
export function normalizeOwnedContainerSkins(raw: unknown): ContainerSkinId[] {
  const owned = new Set<ContainerSkinId>([DEFAULT_CONTAINER_SKIN_ID])
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        const trimmed = item.trim()
        if (isValidContainerSkinId(trimmed)) {
          owned.add(trimmed)
        }
      }
    }
  }
  return CONTAINER_SKIN_IDS.filter((id) => owned.has(id))
}

/**
 * Normalize an equipped skin ID. Falls back to `'royal_keep'` if the ID is
 * unknown or not present in `ownedSkins` (when provided).
 */
export function normalizeEquippedContainerSkin(
  raw: unknown,
  ownedSkins?: readonly ContainerSkinId[],
): ContainerSkinId {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (isValidContainerSkinId(trimmed)) {
      if (!ownedSkins || ownedSkins.includes(trimmed)) {
        return trimmed
      }
    }
  }
  return DEFAULT_CONTAINER_SKIN_ID
}
