import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Both modules under test import Phaser (via their own imports), and
// Phaser's ESM build touches `window` on load — but the vitest suite runs
// in plain node. The units exercised here never use Phaser, so a stub is
// enough; vi.mock hoists above the static imports.
vi.mock('phaser', () => ({ default: {} }))

import { bannerForcedByVariant, bannerRect, makeRng } from './DiscoveryBanner'

describe('the discovery banner geometry', () => {
  it('positions the banner in the top-right area', () => {
    // Phone portrait
    const phone = bannerRect(390, 844)
    expect(phone.cx).toBeGreaterThan(390 * 0.5)
    expect(phone.cy).toBeLessThan(844 * 0.3)

    // Desktop landscape
    const desktop = bannerRect(1280, 720)
    expect(desktop.cx).toBeGreaterThan(1280 * 0.5)
    expect(desktop.cy).toBeLessThan(720 * 0.2)
  })

  it('has a slight tilt for dynamic feel', () => {
    const rect = bannerRect(1280, 720)
    expect(rect.angle).toBeGreaterThan(0)
    expect(rect.angle).toBeLessThan(0.2) // Less than ~11 degrees
  })

  it('scales appropriately on different viewports', () => {
    const phone = bannerRect(390, 844)
    const desktop = bannerRect(1280, 720)
    // Phone should be narrower
    expect(phone.halfLen).toBeLessThan(desktop.halfLen)
    // Both should have reasonable thickness
    expect(phone.halfThick).toBeGreaterThan(30)
    expect(desktop.halfThick).toBeGreaterThan(30)
  })

  it('matches the approved 1380x1140 reference footprint and right anchor', () => {
    const rect = bannerRect(1380, 1140)
    const xExtent = Math.cos(rect.angle) * rect.halfLen + Math.sin(rect.angle) * rect.halfThick
    const yExtent = Math.sin(rect.angle) * rect.halfLen + Math.cos(rect.angle) * rect.halfThick

    expect(rect.halfLen * 2).toBeCloseTo(720, 0)
    expect(rect.halfThick * 2).toBeCloseTo(136, 0)
    expect(rect.cx + xExtent).toBeCloseTo(1380 - 1380 * 0.018, 0)
    expect(rect.cy - yExtent).toBeCloseTo(1140 * 0.07, 0)
  })

  it('keeps the portrait banner compact and below the top-right HUD', () => {
    const rect = bannerRect(390, 844)
    const xExtent = Math.cos(rect.angle) * rect.halfLen + Math.sin(rect.angle) * rect.halfThick
    const yExtent = Math.sin(rect.angle) * rect.halfLen + Math.cos(rect.angle) * rect.halfThick

    expect(rect.halfLen * 2).toBeLessThan(300)
    expect(rect.cx + xExtent).toBeLessThanOrEqual(390 - 14)
    expect(rect.cy - yExtent).toBeGreaterThanOrEqual(142)
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
