import { describe, expect, it } from 'vitest'
import { STAGE } from '../config/stage'
import { computeFitScale } from './fit'

describe('computeFitScale', () => {
  it('fills a viewport with a near-identical aspect ratio', () => {
    // 320x568 (0.5634) vs stage 0.5625: height-limited, ~0.5px side letterbox
    const r = computeFitScale(720, 1280, 320, 568)
    expect(r.scale).toBeCloseTo(0.44375, 4)
    expect(r.width).toBeCloseTo(319.5, 1)
    expect(r.height).toBeCloseTo(568, 0)
    expect(r.letterboxY).toBeCloseTo(0, 0)
    expect(r.letterboxX).toBeCloseTo(0.5, 1)
  })

  it('is width-limited on tall modern phones and leaves vertical HUD bands', () => {
    const r = computeFitScale(720, 1280, 390, 844)
    expect(r.scale).toBeCloseTo(390 / 720, 6)
    expect(r.height).toBeCloseTo(693.3, 1)
    expect(r.letterboxX).toBeCloseTo(0, 0)
    expect(r.letterboxY).toBeCloseTo(844 - 693.33, 1)
  })

  it('is height-limited on desktop, leaving wide side margins', () => {
    const r = computeFitScale(720, 1280, 1440, 900)
    expect(r.scale).toBeCloseTo(900 / 1280, 6)
    expect(r.width).toBeCloseTo(506.25, 1)
    expect(r.letterboxY).toBeCloseTo(0, 0)
    expect(r.letterboxX).toBeCloseTo(1440 - 506.25, 1)
  })

  it('never crops: rendered size never exceeds the viewport', () => {
    const views: Array<[number, number]> = [
      [320, 568],
      [390, 844],
      [430, 932],
      [1440, 900],
    ]
    for (const [vw, vh] of views) {
      const r = computeFitScale(STAGE.width, STAGE.height, vw, vh)
      expect(r.width).toBeLessThanOrEqual(vw)
      expect(r.height).toBeLessThanOrEqual(vh)
      expect(r.letterboxX).toBeGreaterThanOrEqual(0)
      expect(r.letterboxY).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('STAGE config', () => {
  it('is a portrait, positive integer stage', () => {
    expect(Number.isInteger(STAGE.width)).toBe(true)
    expect(Number.isInteger(STAGE.height)).toBe(true)
    expect(STAGE.width).toBeGreaterThan(0)
    expect(STAGE.height).toBeGreaterThan(STAGE.width)
  })
})
