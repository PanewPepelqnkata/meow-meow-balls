import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// save.ts guards every localStorage access (private mode, blocked
// storage), so a stub storage is enough — no jsdom needed. phaser is
// mocked because the module's import chain touches `window` on load; the
// units under test never use it.
vi.mock('phaser', () => ({ default: {} }))

import {
  getSaveOwnerId,
  hasDiscoveredTier,
  loadSave,
  normalizeSave,
  recordDiscovery,
  recordMerge,
  recordRunEnd,
  resetSave,
  savedBest,
  writeSave,
} from './save'

describe('hasDiscoveredTier (the repeat-discovery gate)', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = String(v)
      },
      removeItem: (k: string) => {
        delete store[k]
      },
      clear: () => {
        store = {}
      },
    }
    resetSave()
  })

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('reports pre-seeded tiers 1-3 as discovered', () => {
    expect(hasDiscoveredTier(1)).toBe(true)
    expect(hasDiscoveredTier(2)).toBe(true)
    expect(hasDiscoveredTier(3)).toBe(true)
  })

  it('reports tier 4+ as NOT discovered until recorded', () => {
    expect(hasDiscoveredTier(4)).toBe(false)
    expect(hasDiscoveredTier(5)).toBe(false)
    recordDiscovery(4, null)
    expect(hasDiscoveredTier(4)).toBe(true)
  })

  it('keeps reporting true after the discovery (lifetime, not per-run)', () => {
    recordDiscovery(7, null)
    expect(hasDiscoveredTier(7)).toBe(true)
    expect(hasDiscoveredTier(8)).toBe(false)
  })

  it('isolates account progression on logout and restores account save on login', () => {
    // 1. Guest earns progression and binds it to Account A on signup
    expect(getSaveOwnerId()).toBeNull()
    recordDiscovery(6, null)
    recordMerge(6)
    recordRunEnd(20512, 9)
    writeSave(loadSave(), { syncCloud: false, ownerId: 'account-a' })

    expect(getSaveOwnerId()).toBe('account-a')
    expect(savedBest()).toBe(20512)
    expect(hasDiscoveredTier(9)).toBe(true)

    // 2. Logging out wipes local save to 0 and clears account owner
    const ref = loadSave()
    resetSave({ syncCloud: false, clearOwner: true })
    expect(getSaveOwnerId()).toBeNull()
    expect(savedBest()).toBe(0)
    expect(ref.best).toBe(0)
    expect(ref.stats).toEqual({ runs: 0, merges: 0, bestTier: 0 })
    expect(hasDiscoveredTier(4)).toBe(false)
    expect(hasDiscoveredTier(9)).toBe(false)

    // 3. Logging into Account B with 0 progression keeps progression at 0
    writeSave(normalizeSave(null), { syncCloud: false, ownerId: 'account-b' })
    expect(getSaveOwnerId()).toBe('account-b')
    expect(savedBest()).toBe(0)
    expect(hasDiscoveredTier(4)).toBe(false)

    // 4. Logging back into Account A restores Account A's full progression
    writeSave(
      {
        version: 1,
        best: 20512,
        discovered: { 1: 100, 2: 100, 3: 100, 9: 200 },
        variants: { '9:1': 200 },
        stats: { runs: 2, merges: 481, bestTier: 9 },
      },
      { syncCloud: false, ownerId: 'account-a' },
    )
    expect(getSaveOwnerId()).toBe('account-a')
    expect(savedBest()).toBe(20512)
    expect(ref.best).toBe(20512)
    expect(ref.stats).toEqual({ runs: 2, merges: 481, bestTier: 9 })
    expect(hasDiscoveredTier(8)).toBe(true)
    expect(hasDiscoveredTier(9)).toBe(true)
    expect(ref.variants['9:1']).toBe(200)
  })
})
