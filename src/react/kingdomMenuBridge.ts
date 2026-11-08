import {
  COLLECTIBLE_SLOT_COUNT, COLLECTIBLE_TIERS, collectionDiscovery, collectionSlotsFor,
} from '../config/collectibleCollection'
import type { SaveDataV1 } from '../game/state/save'
import type { KingdomMenuLayout, KingdomNavAction, KingdomRect } from '../ui/KingdomMenuLayout'

export interface KingdomMenuStats {
  best: number
  coins: number
  discovered: number
  total: number
}
export interface KingdomMenuArtwork {
  stats: string
  buttons: Partial<Record<KingdomNavAction, string>>
  icons: { best: string; collection: string; coins: string }
}
export interface KingdomMenuSnapshot {
  visible: boolean
  layout: KingdomMenuLayout | null
  artwork: KingdomMenuArtwork | null
  stats: KingdomMenuStats
  accountName: string | null
}
export interface KingdomMenuButtonRect extends KingdomRect { label: string; screen: 'menu' }

const hidden: KingdomMenuSnapshot = {
  visible: false, layout: null, artwork: null,
  stats: { best: 0, coins: 0, discovered: 0, total: 40 }, accountName: null,
}
let snapshot = hidden
let navigate: ((action: KingdomNavAction) => void) | null = null
const listeners = new Set<() => void>()

/** Retained snapshot makes React mounting order independent of Phaser scene creation. */
export const kingdomMenuBridge = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  getSnapshot(): KingdomMenuSnapshot { return snapshot },
  publish(next: KingdomMenuSnapshot): void {
    snapshot = next
    for (const listener of listeners) listener()
  },
  connect(handler: (action: KingdomNavAction) => void): () => void {
    navigate = handler
    return () => {
      if (navigate !== handler) return
      navigate = null
      snapshot = hidden
      for (const listener of listeners) listener()
    }
  },
  navigate(action: KingdomNavAction): void {
    if (!snapshot.visible || !snapshot.layout?.buttons.some((button) => button.action === action)) return
    navigate?.(action)
  },
  getButtonRects(): KingdomMenuButtonRect[] {
    if (!snapshot.visible || typeof document === 'undefined') return []
    const root = document.querySelector<HTMLElement>('.kingdom-home')
    if (!root) return []
    const origin = root.getBoundingClientRect()
    return Array.from(root.querySelectorAll<HTMLButtonElement>('[data-kingdom-action]'), (button) => {
      const rect = button.getBoundingClientRect()
      return { label: button.textContent ?? '', x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height, screen: 'menu' as const }
    })
  }
}

export function kingdomStatsFromSave(save: SaveDataV1): KingdomMenuStats {
  let discovered = 0
  for (const key of Object.keys(save.discovered)) {
    const tier = Number(key)
    if (tier >= 1 && tier <= 8) discovered++
  }
  for (const tier of COLLECTIBLE_TIERS) {
    for (const slot of collectionSlotsFor(tier)) {
      if (slot.theme && collectionDiscovery(save.variants, tier, slot.theme)) discovered++
    }
  }
  return { best: save.best, coins: save.coins, discovered, total: 8 + COLLECTIBLE_TIERS.length * COLLECTIBLE_SLOT_COUNT }
}
