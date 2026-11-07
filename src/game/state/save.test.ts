import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// save.ts guards every localStorage access (private mode, blocked
// storage), so a stub storage is enough — no jsdom needed. phaser is
// mocked because the module's import chain touches `window` on load; the
// units under test never use it.
vi.mock('phaser', () => ({ default: {} }))

import {
  cloneSave,
  freshSave,
  getOrCreateGuestId,
  getSaveOwnerId,
  hasDiscoveredCollectible,
  hasDiscoveredTier,
  loadSave,
  normalizeSave,
  recordDiscovery,
  recordMerge,
  recordRunEnd,
  resetProgress,
  resetSave,
  savedBest,
  setCloudSyncHandler,
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
    setCloudSyncHandler(null)
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

  it('stores every tier-nine character separately across runs and save roundtrips', () => {
    for (const theme of ['pig', 'shark', 'drunko', 'robo', 'pirate']) recordDiscovery(9, 3, theme)
    const saved = normalizeSave(loadSave())
    expect(saved.variants['9:pig:3']).toBeGreaterThan(0)
    expect(saved.variants['9:shark:3']).toBeGreaterThan(0)
    expect(saved.variants['9:drunko:3']).toBeGreaterThan(0)
    expect(saved.variants['9:robo:3']).toBeGreaterThan(0)
    expect(saved.variants['9:pirate:3']).toBeGreaterThan(0)
    expect(saved.variants['9:3']).toBeUndefined()
    resetSave()
    writeSave(saved, { syncCloud: false })
    expect(loadSave().variants).toEqual(saved.variants)
  })

  it('reports a new collectible identity as undiscovered even when the tier is known', () => {
    recordDiscovery(9, 3, 'shark')
    expect(hasDiscoveredCollectible(9, 'shark')).toBe(true)
    expect(hasDiscoveredCollectible(9, 'pig')).toBe(false)
    expect(hasDiscoveredCollectible(9, 'drunko')).toBe(false)
    expect(hasDiscoveredCollectible(9, 'robo')).toBe(false)
    expect(hasDiscoveredCollectible(9, 'pirate')).toBe(false)
    expect(hasDiscoveredCollectible(10, 'crab')).toBe(false)
  })

  it('uses the same verified identity lookup for banners and the collection book', () => {
    writeSave({ variants: { '10:0': 100, '9:pig:8': 100, '9:shark:': 100 } }, { syncCloud: false })
    expect(hasDiscoveredCollectible(10, 'crab')).toBe(false)
    expect(hasDiscoveredCollectible(9, 'pig')).toBe(false)
    expect(hasDiscoveredCollectible(9, 'shark')).toBe(false)
    recordDiscovery(10, 4, 'crab')
    recordDiscovery(9, 3, 'pig')
    expect(hasDiscoveredCollectible(10, 'crab')).toBe(true)
    expect(hasDiscoveredCollectible(9, 'pig')).toBe(true)
  })

  it('returns false for collectible tiers when theme is null', () => {
    recordDiscovery(9, 3, 'shark')
    expect(hasDiscoveredCollectible(9, null)).toBe(false)
    expect(hasDiscoveredCollectible(10, null)).toBe(false)
    expect(hasDiscoveredCollectible(11, null)).toBe(false)
    expect(hasDiscoveredCollectible(12, null)).toBe(false)
  })

  it('does not change a character’s first-discovery date when found again', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      recordDiscovery(9, 1, 'pig')
      vi.mocked(Date.now).mockReturnValue(2000)
      recordDiscovery(9, 1, 'pig')
      expect(loadSave().variants['9:pig:1']).toBe(1000)
    } finally {
      vi.mocked(Date.now).mockRestore()
    }
  })

  it('starts a new guest identity when Settings resets progression', () => {
    const previousGuestId = getOrCreateGuestId()
    recordDiscovery(9, 2, 'pig')
    resetProgress()
    expect(getOrCreateGuestId()).not.toBe(previousGuestId)
    expect(getSaveOwnerId()).toBeNull()
    expect(loadSave().variants).toEqual({})
  })

  it('keeps the account owner and unrelated guest identity when Settings resets an account', () => {
    const guestId = getOrCreateGuestId()
    writeSave({ variants: { '9:pig:2': 100 } }, { syncCloud: false, ownerId: 'account-a' })
    resetProgress()
    expect(getSaveOwnerId()).toBe('account-a')
    expect(getOrCreateGuestId()).toBe(guestId)
    expect(loadSave().variants).toEqual({})
  })

  it('keeps account coins and bought upgrades when Settings resets progress', () => {
    writeSave({
      best: 1200,
      coins: 24.5,
      coinRevision: 8,
      upgrades: { wallDuration: 2, shakeDuration: 3, shakeIntensity: 1 },
      variants: { '9:pig:2': 100 },
    }, { syncCloud: false, ownerId: 'account-a' })
    const sync = vi.fn()
    setCloudSyncHandler(sync)

    resetProgress()

    expect(getSaveOwnerId()).toBe('account-a')
    expect(loadSave()).toEqual(expect.objectContaining({
      best: 0,
      coins: 24.5,
      coinRevision: 8,
      upgrades: { wallDuration: 2, shakeDuration: 3, shakeIntensity: 1 },
      variants: {},
    }))
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ coins: 24.5, coinRevision: 8 }), true)
    expect(JSON.parse(store['ballrush.save.v1']!)).toEqual(expect.objectContaining({
      coins: 24.5,
      coinRevision: 8,
      upgrades: { wallDuration: 2, shakeDuration: 3, shakeIntensity: 1 },
    }))
  })

  it('clears account economy and upgrades on logout without leaking them to the next player', () => {
    writeSave({
      coins: 24.5,
      coinRevision: 8,
      upgrades: { wallDuration: 2, shakeDuration: 3, shakeIntensity: 1 },
    }, { syncCloud: false, ownerId: 'account-a' })
    resetSave({ syncCloud: false, clearOwner: true })
    expect(getSaveOwnerId()).toBeNull()
    expect(loadSave()).toEqual(expect.objectContaining({
      coins: 0,
      coinRevision: 0,
      upgrades: { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 },
    }))
    expect(store['ballrush.save.v1']).toBeUndefined()
  })

  it('normalizes legacy saves to zero upgrades', () => {
    expect(normalizeSave({ coins: 7.5 })).toEqual(expect.objectContaining({
      coins: 7.5,
      upgrades: { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 },
    }))
    expect(normalizeSave({
      upgrades: { wallDuration: -1, shakeDuration: 200, shakeIntensity: Number.NaN },
    })).toEqual(expect.objectContaining({
      upgrades: { wallDuration: 0, shakeDuration: 10, shakeIntensity: 0 },
    }))
  })

  it('copies economy snapshots while loadSave keeps its stable live reference', () => {
    const first = freshSave()
    const second = freshSave()
    first.upgrades.wallDuration = 4
    expect(second.upgrades.wallDuration).toBe(0)

    writeSave({ ...first, coins: 10, coinRevision: 2 }, { syncCloud: false, ownerId: 'account-a' })
    const live = loadSave()
    const snapshot = cloneSave(live)
    recordRunEnd(1000, 3, 1)
    live.upgrades.wallDuration = 5
    expect(snapshot).toEqual(expect.objectContaining({
      coins: 10, coinRevision: 2, upgrades: { wallDuration: 4, shakeDuration: 0, shakeIntensity: 0 },
    }))
    expect(loadSave()).toBe(live)
    // Account rewards are credited only from finalized server score receipts.
    expect(live.coins).toBe(10)
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
        coins: 0,
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

  it('awards coins as score / 1000 rounded to 1 decimal', () => {
    // 15849 score → 15.8 coins
    recordRunEnd(15849, 5, 10)
    expect(loadSave().coins).toBe(15.8)

    // 10000 score → 10.0 coins (total 25.8)
    recordRunEnd(10000, 4, 5)
    expect(loadSave().coins).toBe(25.8)

    // 500 score → 0.5 coins (total 26.3)
    recordRunEnd(500, 2, 1)
    expect(loadSave().coins).toBe(26.3)
    expect(JSON.parse(store['ballrush.save.v1']!).coins).toBe(26.3)
  })

  it('does not award coins for invalid runs (0 score AND 0 merges)', () => {
    recordRunEnd(0, 1, 0)
    expect(loadSave().coins).toBe(0)
  })

  it('deduplicates and caps leaderboard entries before clamping stats.runs', () => {
    const repeated = Array.from({ length: 25 }, (_, i) => ({
      score: 3436,
      bestTier: 6,
      at: 1793967600100 + (i % 2) * 100,
    }))
    const normalized = normalizeSave({
      version: 1,
      best: 3436,
      leaderboard: repeated,
      stats: { runs: 1, merges: 45, bestTier: 6 },
    })
    expect(normalized.leaderboard).toHaveLength(1)
    expect(normalized.stats.runs).toBe(1)
  })
})
