import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type * as SaveModule from './save'
import type { SaveDataV1 } from './save'

const SAVE_KEY = 'ballrush.save.v1'
const OWNER_KEY = 'ballrush.save.owner'
const GUEST_KEY = 'ballrush.guest.id'
const GUEST_ID = '11111111-1111-4111-8111-111111111111'
const NOW = 1_800_000_000_000

function existingSave(): SaveDataV1 {
  return {
    version: 1,
    best: 1200,
    coins: 0,
    coinRevision: 0,
    upgrades: { wallDuration: 0, shakeDuration: 0, shakeIntensity: 0 },
    leaderboard: [{ score: 1200, bestTier: 5, at: 1000 }],
    discovered: { 1: 100, 2: 100, 3: 100, 4: 200, 5: 300 },
    variants: {},
    settings: { theme: 'space' },
    stats: { runs: 3, merges: 7, bestTier: 5 },
  }
}

describe('/drunko save isolation', () => {
  let save: typeof SaveModule
  let store: Map<string, string>
  let pathname: string
  let setItem: Mock<(key: string, value: string) => Map<string, string>>
  let removeItem: Mock<(key: string) => boolean>
  let cloudSync: Mock<(data: SaveDataV1, immediate: boolean) => void>

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    pathname = '/'
    store = new Map([
      [SAVE_KEY, JSON.stringify(existingSave())],
      [OWNER_KEY, 'account-a'],
      [GUEST_KEY, GUEST_ID],
      ['unrelated.preference', 'unchanged'],
    ])
    setItem = vi.fn((key: string, value: string) => store.set(key, String(value)))
    removeItem = vi.fn((key: string) => store.delete(key))
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem,
      removeItem,
    })
    vi.stubGlobal('window', {
      location: {
        get pathname() { return pathname },
        search: '',
      },
      addEventListener: vi.fn(),
    })
    // A fresh module is required to exercise uncached storage/identity reads
    // and module-load lifecycle listeners with the stubbed browser globals.
    save = await import('./save')
    cloudSync = vi.fn<(data: SaveDataV1, immediate: boolean) => void>()
    save.setCloudSyncHandler(cloudSync)
  })

  afterEach(() => {
    save.setCloudSyncHandler(null)
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each(['/drunko', '/drunko/', '/preview/drunko//'])(
    'leaves both cached progress and all local storage unchanged on %s',
    (route) => {
      pathname = route
      const beforeStorage = [...store]
      const cached = save.loadSave()
      const beforeSave = structuredClone(cached)

      save.recordDiscovery(9, 3, 'drunko')
      save.recordRunStart()
      save.recordMerge(10, 5000)
      expect(save.recordRunEnd(5000, 10, 1)).toBe(1200)
      vi.runAllTimers()

      expect(save.loadSave()).toBe(cached)
      expect(cached).toEqual(beforeSave)
      expect(save.hasDiscoveredTier(9)).toBe(false)
      expect([...store]).toEqual(beforeStorage)
      expect(setItem).not.toHaveBeenCalled()
      expect(removeItem).not.toHaveBeenCalled()
      expect(cloudSync).not.toHaveBeenCalled()
    },
  )

  it('also blocks full save, settings, owner and guest identity mutations', () => {
    pathname = '/drunko'
    const beforeStorage = [...store]
    const beforeSave = structuredClone(save.loadSave())
    expect(save.getSaveOwnerId()).toBe('account-a')
    expect(save.getOrCreateGuestId()).toBe(GUEST_ID)

    save.writeSave({ best: 99999 }, { syncCloud: true, ownerId: 'account-b' })
    save.resetSave({ syncCloud: true, clearOwner: true })
    save.resetProgress()
    save.setThemeSetting('fantasy')
    save.setSaveOwnerId('account-b')
    expect(save.resetGuestId()).toBe(GUEST_ID)
    vi.runAllTimers()

    expect(save.loadSave()).toEqual(beforeSave)
    expect(save.getSaveOwnerId()).toBe('account-a')
    expect(save.getOrCreateGuestId()).toBe(GUEST_ID)
    expect([...store]).toEqual(beforeStorage)
    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
    expect(cloudSync).not.toHaveBeenCalled()
  })

  it('does not create a persisted or cached guest identity while browsing the sandbox', () => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn()
        .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
        .mockReturnValueOnce('33333333-3333-4333-8333-333333333333'),
    })
    store.delete(GUEST_KEY)
    pathname = '/drunko'
    const sandboxId = save.getOrCreateGuestId()
    expect(sandboxId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(store.has(GUEST_KEY)).toBe(false)
    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()

    pathname = '/'
    const productionId = save.getOrCreateGuestId()
    expect(productionId).not.toBe(sandboxId)
    expect(store.get(GUEST_KEY)).toBe(productionId)
  })

  it('suppresses a production write and cloud callback deferred until after entering /drunko', () => {
    save.loadSave()
    save.recordMerge(6, 1500)
    const beforeSave = structuredClone(save.loadSave())
    const beforeStorage = [...store]
    setItem.mockClear()
    removeItem.mockClear()
    pathname = '/drunko'
    vi.runAllTimers()

    expect(save.loadSave()).toEqual(beforeSave)
    expect([...store]).toEqual(beforeStorage)
    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
    expect(cloudSync).not.toHaveBeenCalled()
  })

  it.each(['/', '/drunkos', '/drunko/play'])(
    'preserves discovery, run, merge and leaderboard persistence on production path %s',
    (route) => {
      pathname = route
      save.loadSave()
      setItem.mockClear()
      removeItem.mockClear()
      save.recordDiscovery(9, 3, 'drunko')
      save.recordRunStart()
      save.recordMerge(10, 5000)
      expect(save.recordRunEnd(5000, 10, 1)).toBe(5000)
      vi.runAllTimers()

      const current = save.loadSave()
      expect(current.stats).toEqual({ runs: 4, merges: 8, bestTier: 10 })
      expect(current.discovered['9']).toBe(NOW)
      expect(current.discovered['10']).toBe(NOW)
      expect(current.variants['9:drunko:3']).toBe(NOW)
      expect(current.leaderboard[0]).toEqual({ score: 5000, bestTier: 10, at: NOW })
      expect(JSON.parse(store.get(SAVE_KEY)!)).toEqual(current)
      expect(store.get(OWNER_KEY)).toBe('account-a')
      expect(store.get(GUEST_KEY)).toBe(GUEST_ID)
      expect(cloudSync).toHaveBeenCalledTimes(1)
      expect(cloudSync).toHaveBeenLastCalledWith(current, true)
    },
  )

  it('keeps production discovery and merge writes deferred and coalesced', () => {
    save.loadSave()
    setItem.mockClear()
    removeItem.mockClear()
    save.recordDiscovery(9, 3, 'drunko')
    save.recordMerge(10, 5000)
    expect(setItem).not.toHaveBeenCalled()
    expect(cloudSync).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    const current = save.loadSave()
    expect(JSON.parse(store.get(SAVE_KEY)!)).toEqual(current)
    expect(setItem.mock.calls.filter(([key]) => key === SAVE_KEY)).toHaveLength(1)
    // cloneSave normalizes (back-fills discovered up to bestTier), so the
    // cloud payload may have more discovered tiers than the raw cache.
    expect(cloudSync).toHaveBeenCalledExactlyOnceWith(save.cloneSave(current), false)
  })
})
