import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Both modules under test import Phaser (via their own imports), and
// Phaser's ESM build touches `window` on load — but the vitest suite runs
// in plain node. The units exercised here never use Phaser, so a stub is
// enough; vi.mock hoists above the static imports.
vi.mock('phaser', () => ({ default: {} }))

import { bannerArtworkBounds, bannerForcedByVariant, bannerRect, makeRng } from './DiscoveryBanner'

describe('the discovery banner geometry', () => {
  it('positions the complete asymmetric artwork in the top-right area', () => {
    const phoneBounds = bannerArtworkBounds(bannerRect(390, 844))
    expect(phoneBounds.left).toBeGreaterThan(0)
    expect(phoneBounds.right).toBeCloseTo(390 - 390 * 0.04, 0)
    expect(phoneBounds.top).toBeGreaterThanOrEqual(132)

    const desktopBounds = bannerArtworkBounds(bannerRect(1280, 720))
    expect(desktopBounds.left).toBeGreaterThan(1280 * 0.65)
    expect(desktopBounds.right).toBeCloseTo(1280 - 1280 * 0.056, 0)
    expect(desktopBounds.top).toBeLessThan(720 * 0.1)
  })

  it('tilts upward toward the tier wedge like the reference', () => {
    const rect = bannerRect(1280, 720)
    expect(rect.angle).toBeLessThan(0)
    expect(rect.angle).toBeGreaterThan(-0.2)
  })

  it('scales appropriately on different viewports', () => {
    const phone = bannerRect(390, 844)
    const desktop = bannerRect(1280, 720)
    // Phone should be narrower
    expect(phone.halfLen).toBeLessThan(desktop.halfLen)
    // Both remain readable at the smaller approved scale.
    expect(phone.halfThick).toBeGreaterThan(15)
    expect(desktop.halfThick).toBeGreaterThan(20)
  })

  it('matches the current compact footprint at the 1671x770 gameplay viewport', () => {
    const rect = bannerRect(1671, 770)
    const bounds = bannerArtworkBounds(rect)

    expect(bounds.right - bounds.left).toBeGreaterThan(300)
    expect(bounds.right - bounds.left).toBeLessThan(330)
    expect(bounds.bottom - bounds.top).toBeGreaterThan(150)
    expect(bounds.bottom - bounds.top).toBeLessThan(175)
    expect(bounds.right).toBeCloseTo(1671 - 1671 * 0.056, 0)
    expect(bounds.top).toBeCloseTo(770 * 0.04, 0)
  })

  it('uses a readable dedicated portrait footprint at 390 and 320 widths', () => {
    const phone = bannerArtworkBounds(bannerRect(390, 844))
    expect(phone.right - phone.left).toBeGreaterThan(190)
    expect(phone.right - phone.left).toBeLessThan(205)
    expect(phone.bottom - phone.top).toBeGreaterThan(90)
    expect(phone.bottom - phone.top).toBeLessThan(100)
    expect(phone.left).toBeGreaterThan(0)
    expect(phone.right).toBeLessThanOrEqual(390 - 390 * 0.04)
    expect(phone.top).toBeGreaterThanOrEqual(132)

    const compact = bannerArtworkBounds(bannerRect(320, 844))
    expect(compact.right - compact.left).toBeGreaterThan(155)
    expect(compact.right - compact.left).toBeLessThan(170)
    expect(compact.left).toBeGreaterThan(0)
    expect(compact.right).toBeLessThanOrEqual(320 - 14)
  })
})

describe('the banner RNG', () => {
  it('is deterministic per seed', () => {
    const rng1 = makeRng(12345)
    const rng2 = makeRng(12345)
    const vals1 = [rng1(), rng1(), rng1()]
    const vals2 = [rng2(), rng2(), rng2()]
    expect(vals1).toEqual(vals2)
  })

  it('produces different sequences for different seeds', () => {
    const rng1 = makeRng(12345)
    const rng2 = makeRng(54321)
    const vals1 = [rng1(), rng1(), rng1()]
    const vals2 = [rng2(), rng2(), rng2()]
    expect(vals1).not.toEqual(vals2)
  })

  it('produces values in [0, 1)', () => {
    const rng = makeRng(99999)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('the wind-mode URL param', () => {
  const originalWindow = globalThis.window

  beforeEach(() => {
    // @ts-expect-error - mocking window for tests
    globalThis.window = { location: { search: '' } }
  })

  afterEach(() => {
    globalThis.window = originalWindow
  })

  it('returns false when no discovery param', () => {
    globalThis.window.location.search = ''
    expect(bannerForcedByVariant()).toBe(false)
  })

  it('returns false for other discovery values', () => {
    globalThis.window.location.search = '?discovery=card'
    expect(bannerForcedByVariant()).toBe(false)
  })

  it('returns true for discovery=wind', () => {
    globalThis.window.location.search = '?discovery=wind'
    expect(bannerForcedByVariant()).toBe(true)
  })

  it('returns false when window is undefined', () => {
    // @ts-expect-error - removing window
    delete globalThis.window
    expect(bannerForcedByVariant()).toBe(false)
  })
})
