import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Both modules under test import Phaser (via their own imports), and
// Phaser's ESM build touches `window` on load — but the vitest suite runs
// in plain node. The units exercised here never use Phaser, so a stub is
// enough; vi.mock hoists above the static imports.
vi.mock('phaser', () => ({ default: {} }))

import { bannerForcedByVariant, bannerRect, bannerStreaks, makeRng } from './DiscoveryBanner'

describe('the discovery banner geometry', () => {
  it('slopes DOWN to the right — the right end sits lower than the left', () => {
    const r = bannerRect(390, 844)
    // t=1 is the LEFT end (middle of the top edge, high); t=0 is the
    // RIGHT end (past the top-right corner, lower).
    const left = bandPoint2(r, 1)
    const right = bandPoint2(r, 0)
    // Right end strictly LOWER on screen (larger y) than the left end.
    expect(right.y).toBeGreaterThan(left.y)
    expect(right.x).toBeGreaterThan(left.x)
  })

  it('keeps the left end near the middle of the top edge', () => {
    const r = bannerRect(390, 844)
    const left = bandPoint2(r, 1)
    expect(left.x).toBeGreaterThan(390 * 0.38)
    expect(left.x).toBeLessThan(390 * 0.62)
    // LOW on screen: the left end sits ~13% of the viewport down.
    expect(left.y).toBeGreaterThan(844 * 0.1)
    expect(left.y).toBeLessThan(844 * 0.16)
  })

  it('stays a sane thickness on tiny and huge viewports', () => {
    const small = bannerRect(320, 568)
    const big = bannerRect(2560, 1440)
    expect(small.halfThick).toBeGreaterThanOrEqual(23) // the 46px floor / 2
    expect(big.halfThick).toBeLessThanOrEqual(38) // the 76px desktop cap / 2
  })
})

/** A point along the band's centre line, t in 0..1 (0 = right/corner end,
 * 1 = left/middle end) — mirrors the private bandPoint. */
function bandPoint2(rect: ReturnType<typeof bannerRect>, t: number): { x: number; y: number } {
  const len = rect.halfLen * 2
  return {
    x: rect.cx + Math.cos(rect.angle) * (t - 0.5) * len,
    y: rect.cy + Math.sin(rect.angle) * (t - 0.5) * len,
  }
}

describe('the banner wind streaks', () => {
  it('are deterministic per seed', () => {
    const r = bannerRect(390, 844)
    const a = bannerStreaks(r, 4242)
    const b = bannerStreaks(r, 4242)
    expect(a).toEqual(b)
  })

  it('FILL the box — lanes span the band thickness edge to edge', () => {
    const r = bannerRect(390, 844)
    const lanes = bannerStreaks(r, 4242)
    expect(lanes.length).toBeGreaterThanOrEqual(6)
    const vs = lanes.map((l) => l.v).sort((x, y) => x - y)
    // The outermost lanes reach within a stroke of the box edges.
    expect(vs[0]).toBeLessThan(-r.halfThick * 0.7)
    expect(vs[vs.length - 1]).toBeGreaterThan(r.halfThick * 0.7)
    // …and nothing reaches past the box (9px inset, centre-line).
    for (const lane of lanes) {
      expect(Math.abs(lane.v)).toBeLessThanOrEqual(r.halfThick - 9)
    }
  })

  it('are FAST — visible crossing flashes by in ~0.3–0.5s', () => {
    const r = bannerRect(390, 844)
    for (const lane of bannerStreaks(r, 4242)) {
      // speed is the fraction of the wrap per 9s clock loop: wrap time
      // = 9000/speed ms. The visible chord is ~half the wrap; require
      // the wrap under 1.2s.
      expect(9000 / lane.speed).toBeLessThan(1200)
      expect(9000 / lane.speed).toBeGreaterThan(500)
    }
  })

  it('are LONG — most of the box, so they read as lines passing', () => {
    const r = bannerRect(390, 844)
    for (const lane of bannerStreaks(r, 4242)) {
      expect(lane.len).toBeGreaterThan(r.halfLen * 0.5)
      expect(lane.len).toBeLessThanOrEqual(r.halfLen * 1.05)
    }
  })
})

describe('the banner RNG', () => {
  it('is a stable mulberry32 stream', () => {
    const a = makeRng(12345)
    const b = makeRng(12345)
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
    for (const v of seqA) expect(v).toBeGreaterThanOrEqual(0)
    for (const v of seqA) expect(v).toBeLessThan(1)
  })
})

describe('the wind-mode URL param', () => {
  let originalWindow: typeof window | undefined

  beforeEach(() => {
    originalWindow = globalThis.window
  })

  afterEach(() => {
    if (originalWindow === undefined) delete (globalThis as { window?: typeof window }).window
    else (globalThis as { window?: typeof window }).window = originalWindow
  })

  function withParam(value: string | null): void {
    const params = new URLSearchParams()
    if (value !== null) params.set('discovery', value)
    const url = `https://game.local/${params.size ? `?${params}` : ''}`
    ;(globalThis as { window?: unknown }).window = { location: new URL(url) }
  }

  it('is ON for ?discovery=wind', () => {
    withParam('wind')
    expect(bannerForcedByVariant()).toBe(true)
  })

  it('is OFF for the modal styles, old wind1-5, and no param', () => {
    for (const v of [null, 'card', 'gib', 'band', 'wind1', 'wind5']) {
      withParam(v)
      expect(bannerForcedByVariant()).toBe(false)
    }
  })
})
