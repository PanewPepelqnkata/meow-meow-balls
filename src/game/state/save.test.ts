import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// save.ts guards every localStorage access (private mode, blocked
// storage), so a stub storage is enough — no jsdom needed. phaser is
// mocked because the module's import chain touches `window` on load; the
// units under test never use it.
vi.mock('phaser', () => ({ default: {} }))

import { hasDiscoveredTier, recordDiscovery, resetSave } from './save'

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

  it('reports pre-seeded tiers 1-4 as discovered', () => {
    expect(hasDiscoveredTier(1)).toBe(true)
    expect(hasDiscoveredTier(4)).toBe(true)
  })

  it('reports tier 5+ as NOT discovered until recorded', () => {
    expect(hasDiscoveredTier(5)).toBe(false)
    recordDiscovery(5, null)
    expect(hasDiscoveredTier(5)).toBe(true)
  })

  it('keeps reporting true after the discovery (lifetime, not per-run)', () => {
    recordDiscovery(7, null)
    expect(hasDiscoveredTier(7)).toBe(true)
    expect(hasDiscoveredTier(8)).toBe(false)
  })
})
