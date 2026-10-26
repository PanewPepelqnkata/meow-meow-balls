import { describe, expect, it } from 'vitest'
import { TIER8_COLOR, cycleColor } from './rgbCycle'

/**
 * The TIER 8 ball's colour — now a SOLID WHITE (the user retired the old
 * five-colour clock cycle). Every consumer gets the same constant at any
 * timestamp: the gameplay renderer, the drop claw, the next-ball preview,
 * the tier progression strip, the title screen, the discovery overlay.
 */
describe('rgbCycle: the tier 8 colour', () => {
  it('is solid WHITE at any time', () => {
    for (const t of [0, 50, 1234, 1e9, -500, -1, 1e12]) {
      expect(cycleColor(t)).toBe(TIER8_COLOR)
    }
  })

  it('never changes between timestamps (no cycle left)', () => {
    const a = cycleColor(0)
    const b = cycleColor(Date.now())
    const c = cycleColor(987654321)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('is true white (0xffffff)', () => {
    expect(TIER8_COLOR).toBe(0xffffff)
    expect((TIER8_COLOR >> 16) & 0xff).toBe(255)
    expect((TIER8_COLOR >> 8) & 0xff).toBe(255)
    expect(TIER8_COLOR & 0xff).toBe(255)
  })
})
